---
description: |
  Audits frontmatter quality across a docs corpus on a rotating slice each run.
  Applies self-contained required-field and description-quality rules, with
  targeted Elastic docs MCP checks for published authoring guidance. Opens a
  single labeled fix-issue with structured YAML findings consumable by a future
  fix-agent.

inlined-imports: true
imports:
  - gh-aw-fragments/formatting.md
  - gh-aw-fragments/rigor.md
  - gh-aw-fragments/mcp-pagination.md
engine:
  id: copilot
  model: gpt-5-mini
  concurrency:
    group: "gh-aw-copilot-docs-frontmatter-sweep-${{ github.run_id }}"
    cancel-in-progress: false
on:
  workflow_call:
    inputs:
      source-repo:
        description: "Repository to scan (owner/repo). Defaults to the calling repo. Set this when the workflow runs in an internal triage repo but should audit a public docs repo."
        type: string
        required: false
        default: ""
      docs-root:
        description: "Root directory to sweep (relative to repo root)"
        type: string
        required: false
        default: "docs/"
      target-path:
        description: "Optional docs-root-relative directory to sweep recursively. Accepts a leading slash."
        type: string
        required: false
        default: ""
      scope-mode:
        description: "How to scope matched markdown files: auto preserves the default behavior, full scans every matched file, and shard applies rotating shard selection within the matched set."
        type: string
        required: false
        default: "auto"
      target-batch-size:
        description: "Approximate pages per Tier 2 rotating slice; controls shard count N = ceil(total/batch-size)"
        type: string
        required: false
        default: "100"
      max-per-fix-issue:
        description: "Cap on findings per fix-issue; overflow is noted and surfaces in next sweep"
        type: string
        required: false
        default: "20"
      additional-instructions:
        description: "Repo-specific instructions appended to the agent prompt"
        type: string
        required: false
        default: ""
      setup-commands:
        description: "Shell commands to run before the agent starts"
        type: string
        required: false
        default: ""
    secrets:
      COPILOT_GITHUB_TOKEN:
        required: true
concurrency:
  group: gh-aw-docs-frontmatter-sweep-${{ github.run_id }}
  cancel-in-progress: false
permissions:
  contents: read
  issues: read
strict: false
tools:
  github:
    toolsets: [issues, repos]
  bash:
    - "cat *"
    - "ls *"
    - "find *"
    - "wc *"
    - "git log *"
    - "yq *"
    - "jq *"
mcp-servers:
  elastic-docs:
    type: http
    url: "https://www.elastic.co/docs/_mcp/"
    allowed: ["*"]
network:
  allowed:
    - defaults
    - github
    - "www.elastic.co"
safe-outputs:
  noop:
  create-issue:
    title-prefix: "Docs fix — frontmatter: "
    labels:
      - docs-quality-sweep
      - "docs-fix:frontmatter"
    max: 1
    close-older-issues: true
timeout-minutes: 30
steps:
  - name: Checkout source docs repo
    uses: actions/checkout@v6
    with:
      repository: ${{ inputs.source-repo || github.repository }}
      fetch-depth: 30
      persist-credentials: false
  - name: Compute sweep targets
    env:
      DOCS_ROOT: ${{ inputs.docs-root }}
      TARGET_PATH: ${{ inputs.target-path }}
      SCOPE_MODE: ${{ inputs.scope-mode }}
      TARGET_BATCH: ${{ inputs.target-batch-size }}
    run: |
      set -eu
      mkdir -p /tmp/gh-aw/sweep-data/scope

      TARGET_PATH_CLEAN=${TARGET_PATH#/}
      TARGET_PATH_CLEAN=${TARGET_PATH_CLEAN%/}
      DOCS_ROOT_CLEAN=${DOCS_ROOT%/}
      SCOPE_ROOT="$DOCS_ROOT"
      REQUESTED_SCOPE_MODE="$SCOPE_MODE"
      SELECTION_MODE="shard"

      case "$REQUESTED_SCOPE_MODE" in
        auto|full|shard) ;;
        *)
          echo "scope-mode '$REQUESTED_SCOPE_MODE' must be one of: auto, full, shard"
          exit 1
          ;;
      esac

      if [ -n "$TARGET_PATH_CLEAN" ]; then
        if [ "$DOCS_ROOT_CLEAN" = "." ] || [ -z "$DOCS_ROOT_CLEAN" ]; then
          SCOPE_ROOT="$TARGET_PATH_CLEAN"
        else
          SCOPE_ROOT="$DOCS_ROOT_CLEAN/$TARGET_PATH_CLEAN"
        fi
      fi

      if [ "$REQUESTED_SCOPE_MODE" = "auto" ]; then
        if [ -n "$TARGET_PATH_CLEAN" ]; then
          SELECTION_MODE="full"
        else
          SELECTION_MODE="shard"
        fi
      else
        SELECTION_MODE="$REQUESTED_SCOPE_MODE"
      fi

      if [ ! -d "$SCOPE_ROOT" ]; then
        echo "scope root '$SCOPE_ROOT' does not exist; producing empty scope"
        : > /tmp/gh-aw/sweep-data/all.txt
        : > /tmp/gh-aw/sweep-data/shard.txt
        : > /tmp/gh-aw/sweep-data/recent.txt
        : > /tmp/gh-aw/sweep-data/in-scope.txt
        echo '{"total":0,"shard_n":1,"shard_slot":0,"shard_count":0,"recent_count":0,"in_scope_count":0,"iso_week":"'"$(date +%G-W%V)"'","docs_root":"'"$DOCS_ROOT"'","scope_mode":"'"$REQUESTED_SCOPE_MODE"'","selection_mode":"'"$SELECTION_MODE"'","target_path":"'"$TARGET_PATH_CLEAN"'","scope_root":"'"$SCOPE_ROOT"'"}' > /tmp/gh-aw/sweep-data/stats.json
        exit 0
      fi

      find "$SCOPE_ROOT" -type f -name '*.md' \
        -not -path '*/node_modules/*' \
        -not -path '*/.git/*' \
        | sort > /tmp/gh-aw/sweep-data/all.txt

      TOTAL=$(wc -l < /tmp/gh-aw/sweep-data/all.txt | tr -d ' ')
      if [ "$SELECTION_MODE" = "full" ]; then
        N=1
        SLOT=0
        cp /tmp/gh-aw/sweep-data/all.txt /tmp/gh-aw/sweep-data/shard.txt
        : > /tmp/gh-aw/sweep-data/recent.txt
      else
        if [ "$TOTAL" -eq 0 ]; then
          N=1
        else
          N=$(( (TOTAL + TARGET_BATCH - 1) / TARGET_BATCH ))
        fi
        ISO_WEEK_NUM=$(date +%V | sed 's/^0//')
        SLOT=$(( ISO_WEEK_NUM % N ))

        : > /tmp/gh-aw/sweep-data/shard.txt
        while IFS= read -r f; do
          [ -z "$f" ] && continue
          HEX=$(printf '%s' "$f" | shasum -a 256 | cut -c1-4)
          HASH_NUM=$(( 16#$HEX ))
          if [ $((HASH_NUM % N)) -eq "$SLOT" ]; then
            echo "$f" >> /tmp/gh-aw/sweep-data/shard.txt
          fi
        done < /tmp/gh-aw/sweep-data/all.txt

        git log --since='2 days ago' --name-only --pretty=format: -- "$DOCS_ROOT/*.md" "$DOCS_ROOT/**/*.md" 2>/dev/null \
          | grep -E '\.md$' \
          | sort -u > /tmp/gh-aw/sweep-data/recent.txt || true

        # Cap the recently-changed pass: if a corpus-wide rebase or migration
        # touched far more pages than one slice, fall back to slice-only so
        # rotation actually rotates.
        RECENT_RAW=$(wc -l < /tmp/gh-aw/sweep-data/recent.txt | tr -d ' ')
        RECENT_LIMIT=$(( TARGET_BATCH * 2 ))
        if [ "$RECENT_RAW" -gt "$RECENT_LIMIT" ]; then
          echo "recently-changed pass produced $RECENT_RAW pages (>2x target batch $TARGET_BATCH); disabling for this run"
          : > /tmp/gh-aw/sweep-data/recent.txt
        fi
      fi

      if [ "$SELECTION_MODE" = "full" ]; then
        cp /tmp/gh-aw/sweep-data/all.txt /tmp/gh-aw/sweep-data/in-scope.txt
      else
        sort -u /tmp/gh-aw/sweep-data/shard.txt /tmp/gh-aw/sweep-data/recent.txt \
          | grep -v '^$' > /tmp/gh-aw/sweep-data/in-scope.txt || true
      fi

      while IFS= read -r f; do
        [ -z "$f" ] && continue
        [ ! -f "$f" ] && continue
        mkdir -p "/tmp/gh-aw/sweep-data/scope/$(dirname "$f")"
        cp "$f" "/tmp/gh-aw/sweep-data/scope/$f"
      done < /tmp/gh-aw/sweep-data/in-scope.txt

      SHARD_COUNT=$(wc -l < /tmp/gh-aw/sweep-data/shard.txt | tr -d ' ')
      RECENT_COUNT=$(wc -l < /tmp/gh-aw/sweep-data/recent.txt | tr -d ' ')
      IN_SCOPE_COUNT=$(wc -l < /tmp/gh-aw/sweep-data/in-scope.txt | tr -d ' ')

      cat > /tmp/gh-aw/sweep-data/stats.json <<EOF
      {
        "total": $TOTAL,
        "shard_n": $N,
        "shard_slot": $SLOT,
        "shard_count": $SHARD_COUNT,
        "recent_count": $RECENT_COUNT,
        "in_scope_count": $IN_SCOPE_COUNT,
        "iso_week": "$(date +%G-W%V)",
        "docs_root": "$DOCS_ROOT",
        "scope_mode": "$REQUESTED_SCOPE_MODE",
        "selection_mode": "$SELECTION_MODE",
        "target_path": "$TARGET_PATH_CLEAN",
        "scope_root": "$SCOPE_ROOT"
      }
      EOF

      echo "Sweep targets: scope_mode=$REQUESTED_SCOPE_MODE mode=$SELECTION_MODE scope_root=$SCOPE_ROOT total=$TOTAL N=$N slot=$SLOT shard=$SHARD_COUNT recent=$RECENT_COUNT in_scope=$IN_SCOPE_COUNT"

  - name: Repo-specific setup
    if: ${{ inputs.setup-commands != '' }}
    env:
      SETUP_COMMANDS: ${{ inputs.setup-commands }}
    run: eval "$SETUP_COMMANDS"
---

# Docs frontmatter sweep agent

You are a frontmatter quality reviewer for an Elastic documentation repository. Your job is to audit the frontmatter (`---` block at the top of each `.md` file) of a deterministically-selected slice of pages, and emit a single labeled fix-issue with structured findings that a human (and later, a fix-agent) can act on.

## Pre-fetched data

A pre-step has computed the in-scope file list for this run:

- `/tmp/gh-aw/sweep-data/in-scope.txt` — newline-delimited list of repository-relative file paths to audit. May be empty.
- `/tmp/gh-aw/sweep-data/scope/` — copies of the same files, mirroring their original paths under this prefix. Audit these copies and map findings back to the repo originals.
- `/tmp/gh-aw/sweep-data/stats.json` — `total`, `shard_n`, `shard_slot`, `in_scope_count`, `iso_week`, `docs_root`, `scope_mode`, `selection_mode`, `target_path`, `scope_root`.

Read these with `cat` / `jq`. Do not refetch them from the repo via GitHub APIs.

## Scope

Audit only the files listed in `in-scope.txt`. Do not expand scope to other files even if related evidence suggests it. Out-of-scope files are deliberately skipped this run; they will be picked up in subsequent rotations.

If `in_scope_count` is `0`, call `noop` with a short message including the corpus stats. Use these patterns:

- Full mode with `target_path`: `Empty subtree /<target_path> (0 pages)`.
- Full mode without `target_path`: `Empty full sweep for <docs_root> (0 pages)`.
- Shard mode with `target_path`: `Empty subtree shard for /<target_path> (shard <slot>/<n>, 0 pages)`.
- Shard mode without `target_path`: `All files in this rotation are unaudited (shard <slot>/<n>, 0 pages)`.

## Step 1: Audit the frontmatter

This workflow is autonomous. Do not invoke runtime skills or depend on a skill package being installed. For each in-scope file, read the frontmatter block at the top of the copy under `/tmp/gh-aw/sweep-data/scope/` and inspect only the fields covered by this sweep.

Use local repository evidence first. If a repository schema or docs-builder frontmatter reference is present in the checked-out source, use it for required-field confirmation. Use the Elastic docs MCP server only for targeted authoring guidance, not for broad corpus searches. Prefer `elastic-docs.get_document_by_url` for known guidance pages such as `/docs/contribute-docs/how-to/cumulative-docs/reference`, and `elastic-docs.search_docs` only when you need to discover a published frontmatter guidance page before citing it.

Apply these rules:

- `description` should be present, non-empty, no more than 200 characters, specific to the page, and useful in search results. It must be a complete sentence, not a fragment or label.
- Descriptions should be action-oriented, value-focused, factual, and impersonal. Avoid "you can", "users can", "this page explains", "teaching", "enable", "disable", condescending or excluding terms, and version numbers.
- Descriptions must use plain text only. Do not use substitution variables such as `{{kib}}`, `{{es}}`, or `{{esql}}`; they are not parsed in frontmatter.
- Avoid label prefixes such as "Reference -", "Tutorial -", or "Guide -". Work content type naturally into the description when useful.
- Quote `description` values when punctuation could be misread by YAML. Avoid unquoted colons; when a colon would be needed, prefer wording that does not require one.
- Description suggestions should follow the page type: tutorial descriptions can start with "Step-by-step tutorial for...", troubleshooting descriptions can start with "Troubleshooting guide for...", reference descriptions should include "reference" naturally, how-to descriptions should lead with the action, and overview descriptions should lead with what the feature does and why it matters.
- `products` should be present and non-empty when the repository's frontmatter convention requires it. In docs-content, the canonical shape is `products` with `id` entries; flag `product` singular unless the local repository explicitly uses that schema. Do not invent product values; if you cannot verify the right value from the page context or local convention, report the missing field without a suggested fix.
- `navigation_title` should be present when the H1 is longer than about 50 characters or when the repository's convention requires it. It should be concise enough for navigation. Flag verbatim H1 duplicates only when the H1 is long or includes context that is unnecessary in the navigation tree.
- Preserve `mapped_pages` when present. Do not suggest adding it when absent.
- Do not emit `missing-applies-to` or `invalid-applies-to` findings. The dedicated applies_to sweep owns those categories.
- Audit only. Do not edit repo originals or scope copies. This sweep emits an issue, not a PR.

## Step 2: Build the findings list

For each finding, extract:

- `file` — the original repository-relative path (strip the `/tmp/gh-aw/sweep-data/scope/` prefix from any scoped file path).
- `line` — `1` for missing/invalid frontmatter keys (frontmatter starts at line 1); for description-quality findings use the line of the `description:` key.
- `category` — one of: `missing-description`, `weak-description`, `description-too-long`, `missing-products`, `missing-navigation-title`. **Do not emit `missing-applies-to` or `invalid-applies-to`** — those belong to `gh-aw-docs-applies-to-sweep`. If another source suggests them, drop them silently.
- `severity` — `high` for missing required fields; `medium` for weak/long/invalid; `low` for nits.
- `evidence` — one short sentence quoting or naming the exact problem.
- `suggested_fix` — concrete YAML snippet ready to paste into the file's frontmatter when you can produce one confidently. For audit-only findings, or a missing field with no verified value, omit `suggested_fix`.

Apply the **Rigor** standards from the imported fragment: skip any finding where you cannot point to exact evidence, and skip any pre-existing build-error-class issues already covered by the docs build.

## Step 3: Sort and cap

**Sort findings**: by `severity` (`high` → `medium` → `low`), then by `file` ascending, then by `line` ascending. The reader should see the highest-leverage findings at the top of the YAML block. Group findings on the same `file` adjacently so an author can fix one file in one PR.

**Cap** the findings list at `${{ inputs.max-per-fix-issue }}` distinct files (count distinct file paths, not finding rows). If more pages have findings, list the first N and add a note `+M additional pages will surface in next sweep` to the issue body.

If the capped findings list is empty, call `noop` and adapt the message to the selection mode:

- Shard mode without `target_path`: `"No high-confidence frontmatter issues in this slice (shard <slot>/<n>, <in_scope_count> pages)"`.
- Shard mode with `target_path`: `"No high-confidence frontmatter issues under /<target_path> in shard <slot>/<n> (<in_scope_count> pages)"`.
- Full mode with `target_path`: `"No high-confidence frontmatter issues under /<target_path> (<in_scope_count> pages)"`.
- Full mode without `target_path`: `"No high-confidence frontmatter issues in full sweep <docs_root> (<in_scope_count> pages)"`.

Otherwise, call `create_issue` with the body shape below.

## Output: fix-issue body

Title:

- Shard mode without `target_path`: `<shard X/N> — N pages` (the workflow's `title-prefix` will prepend `Docs fix — frontmatter: `, so produce a title body like `shard 17/52 — 12 pages`).
- Shard mode with `target_path`: `path /<target_path> — shard <X/N> — N pages` (for example, `path /solutions/observability — shard 2/7 — 12 pages`).
- Full mode with `target_path`: `path /<target_path> — N pages`.
- Full mode without `target_path`: `full <docs_root> — N pages`.

Body:

```markdown
Generated by `gh-aw-docs-frontmatter-sweep` for `${{ inputs.source-repo || github.repository }}` on <iso_week>.

Use one of these scope-summary lines:

- Shard mode without `target_path`: `Shard <slot+1>/<n> · <shard_count> pages in slice · <recent_count> recently-changed · <in_scope_count> total in scope · corpus <total> pages.`
- Shard mode with `target_path`: `Path /<target_path> · shard <slot+1>/<n> · <shard_count> pages in slice · <recent_count> recently-changed · <in_scope_count> total in scope · subtree corpus <total> pages.`
- Full mode with `target_path`: `Path /<target_path> · <in_scope_count> total in scope · subtree corpus <total> pages.`
- Full mode without `target_path`: `Full sweep of <docs_root> · <in_scope_count> total in scope · corpus <total> pages.`

## Findings (<count>)

```yaml
- file: docs/foo.md
  line: 1
  category: missing-description
  severity: high
  evidence: "frontmatter has no `description` field"
  suggested_fix: |
    description: "How to configure X for Y use cases."
- file: docs/bar.md
  line: 1
  category: weak-description
  severity: medium
  evidence: "description is generic ('Learn about X')"
  suggested_fix: |
    description: "<concrete replacement>"
```

## Done when
- All listed pages have a non-empty, <=200-character `description` field and required frontmatter keys present per the repo's frontmatter schema.
- A PR addressing this issue is merged.

## Notes
- <Optional 1-line about anything intentionally skipped>.

<!-- gh-aw-docs-frontmatter-sweep:run=<iso_week>:shard=<slot>/<n> -->
```

Keep the YAML block parseable — every entry must have `file`, `line`, `category`, `severity`, `evidence`. Use the literal `|` block scalar for multi-line `suggested_fix` values. Do not include comments inside the YAML block.

## What to skip

- Files outside `/tmp/gh-aw/sweep-data/in-scope.txt`.
- Findings already covered by the docs build (broken frontmatter syntax that fails the build is the build's job, not this sweep's).
- Speculative description rewrites for pages that already have an acceptable description.
- Repo-wide style preferences not directly tied to a missing or invalid frontmatter field.

${{ inputs.additional-instructions }}
