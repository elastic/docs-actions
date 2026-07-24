---
description: |
  Validates the `applies_to` frontmatter key across a docs corpus on a rotating
  slice each run, using self-contained validation rules and the Elastic docs
  MCP server for published cumulative-docs guidance. Opens a single labeled
  fix-issue with structured YAML findings consumable by a future fix-agent.

inlined-imports: true
imports:
  - uses: shared/apm.md
    with:
      target: claude
      packages:
        - elastic/elastic-docs-skills/skills/authoring/applies-to-tagging
  - gh-aw-fragments/formatting.md
  - gh-aw-fragments/rigor.md
  - gh-aw-fragments/mcp-pagination.md
model: sonnet
engine:
  id: claude
  version: "2.1.206"
  env:
    ANTHROPIC_API_KEY: ${{ secrets.DOCS_LITELLM_API_KEY }}
    ANTHROPIC_BASE_URL: https://elastic.litellm-prod.ai
    ANTHROPIC_DEFAULT_OPUS_MODEL: llm-gateway/claude-opus-4-7[1m]
    ANTHROPIC_DEFAULT_HAIKU_MODEL: llm-gateway/claude-haiku-4-5
    ANTHROPIC_DEFAULT_SONNET_MODEL: llm-gateway/claude-sonnet-4-6
on:
  bots: ["github-actions[bot]"]
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
        description: "Approximate pages per rotating slice; controls shard count N = ceil(total/batch-size)"
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
      DOCS_LITELLM_API_KEY:
        required: false
concurrency:
  group: gh-aw-docs-applies-to-sweep-${{ github.run_id }}
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
    title-prefix: "Docs fix — applies_to: "
    labels:
      - docs-quality-sweep
      - "docs-fix:applies-to"
    max: 1
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

# Docs `applies_to` sweep agent

You are an `applies_to` validator for an Elastic documentation repository. Your job is to audit the `applies_to` frontmatter key on a deterministically-selected slice of pages and emit a single labeled fix-issue with structured findings.

This workflow also installs the `docs-applies-to-tagging` APM skill from `elastic/elastic-docs-skills`.

Use that installed skill when it helps interpret version, deployment, product, or lifecycle applicability rules. Treat it as additive guidance, not as permission to skip the verified references and explicit rule checks in this workflow.

## Pre-fetched data

A pre-step has computed the in-scope file list:

- `/tmp/gh-aw/sweep-data/in-scope.txt` — file paths to audit.
- `/tmp/gh-aw/sweep-data/scope/` — copies mirroring the original paths.
- `/tmp/gh-aw/sweep-data/stats.json` — corpus stats, including `scope_mode`, `selection_mode`, `target_path`, and `scope_root`.

Read with `cat` / `jq`. If `in_scope_count` is `0`, call `noop` with a path-aware or shard-aware message based on `selection_mode`, then stop.

## Step 1: Validate applies_to autonomously

This workflow is autonomous. For each in-scope file, read the frontmatter block at the top of the copy under `/tmp/gh-aw/sweep-data/scope/` and inspect the `applies_to` key.

Audit only. Do not edit repo originals or scope copies. This sweep emits an issue, not a PR.

Before filing any validity finding, verify the rule from one of these sources:

- A checked-in repository schema or docs-builder configuration in the source repository.
- Published cumulative-docs guidance fetched during this run with `elastic-docs.get_document_by_url`, especially `/docs/contribute-docs/how-to/cumulative-docs/guidelines` and `/docs/contribute-docs/how-to/cumulative-docs/reference`.
- Published syntax and placement guidance fetched during this run when body-level annotations are involved, especially the docs-builder applies_to syntax guide, badge placement guidance, and cumulative-docs example scenarios.

Use the published reference as the source of truth for allowed dimensions, keys, lifecycle states, and version formats. If the MCP server is unavailable and no local schema is available, call `noop` with `"applies_to reference unavailable; skipping applies_to sweep"` rather than emitting unverified findings.

When a finding depends on interpreting lifecycle, version-range, or dimension rules, explicitly use the installed `docs-applies-to-tagging` skill guidance.

Apply these rules after verification:

- Every page should include page-level `applies_to` frontmatter.
- Page-level `applies_to` should use one primary dimension: Stack/Serverless (`stack`, `serverless`), Deployment (`deployment` with deployment subkeys and, where documented, `serverless`), or Product (`product` with documented product subkeys). Section-level and inline annotations can use a different dimension when needed to clarify local exceptions.
- Lifecycle values must match the verified reference. Current published states include `preview`, `beta`, `ga`, `deprecated`, `removed`, and `unavailable`, but do not rely on this list without fetching the reference or reading a local schema during the run.
- Version values must use documented formats, such as major/minor versions, exact versions, ranges, or greater-than-or-equal versions, according to the verified reference.
- `ech` is the current key for Elastic Cloud Hosted. Treat `ess` as deprecated in new or updated content unless local build constraints require it.
- Validate version semantics: only one version per lifecycle, only one open-ended `+` lifecycle per key, exact versions use `=x.x` or `=x.x.x`, ranges use one hyphen with no spaces, range starts must be less than or equal to ends, and ranges must not overlap.
- Do not write version numbers in prose next to `applies_to` badges. Let the badge carry version applicability.
- Section-level annotations belong immediately after a heading and apply until the next heading of the same or higher level. Do not put inline annotations in headings.
- Inline annotations are appropriate for a single phrase, property, definition-list term, or table cell, not for whole sections.
- Badge placement should match the element: frontmatter for page-level, after headings for section-level, at the beginning of list items when the whole item varies, at the end of a definition-list term when the whole item varies, and in the first column or relevant cell for tables.
- Use `applies-switch` tabs only when code blocks or workflows differ entirely between contexts.
- Do not require `unavailable` when omission already communicates that the content does not apply. Report `unavailable` misuse only when the page creates a high risk of user confusion or contradicts the published guidance.
- Do not flag dimension choices unless the page-level `applies_to` clearly mixes primary dimensions, contradicts `products`, or conflicts with the page's documented scope.
- Do not add or require tags for typo fixes, formatting changes, information architecture changes, or sections whose applicability is already established by a parent tag.

Only call `noop` if you cannot produce any high-confidence findings from verified rules.

## Step 2: Build the findings list

Categories (use exactly these strings):

- `missing-applies-to` — no `applies_to:` key in frontmatter where one is required.
- `invalid-applies-to-syntax` — malformed YAML or unrecognized structure under `applies_to:`.
- `invalid-applies-to-value` — recognized structure but a value (product, deployment, lifecycle stage) that is not in the allowed vocabulary.
- `inconsistent-applies-to` — `applies_to` contradicts other frontmatter (e.g., `products:` says one thing, `applies_to:` another).
- `outdated-applies-to` — references a deployment or lifecycle value that is deprecated per the verified reference.

For each finding extract `file`, `line`, `category`, `severity`, `evidence`, and `suggested_fix` when you can produce a concrete YAML snippet confidently.

Strip the `/tmp/gh-aw/sweep-data/scope/` prefix from `file` so paths are repo-relative.

## Step 3: Sort and cap

Sort findings by `severity` (`high` → `medium` → `low`), then by `file` ascending, then by `line` ascending. Group findings on the same `file` adjacently.

Cap at `${{ inputs.max-per-fix-issue }}` distinct files. If empty, call `noop` and adapt the message to the selection mode:

- Shard mode without `target_path`: `"No applies_to issues in this slice (shard <slot>/<n>, <in_scope_count> pages)"`.
- Shard mode with `target_path`: `"No applies_to issues under /<target_path> in shard <slot>/<n> (<in_scope_count> pages)"`.
- Full mode with `target_path`: `"No applies_to issues under /<target_path> (<in_scope_count> pages)"`.
- Full mode without `target_path`: `"No applies_to issues in full sweep <docs_root> (<in_scope_count> pages)"`.

## Output: fix-issue body

Title body depends on the selection mode:

- Shard mode without `target_path`: `shard <slot+1>/<n> — <count> pages` (workflow prepends `Docs fix — applies_to: `).
- Shard mode with `target_path`: `path /<target_path> — shard <slot+1>/<n> — <count> pages`.
- Full mode with `target_path`: `path /<target_path> — <count> pages`.
- Full mode without `target_path`: `full <docs_root> — <count> pages`.

Body:

```markdown
Generated by `gh-aw-docs-applies-to-sweep` for `${{ inputs.source-repo || github.repository }}` on <iso_week>.

Use one of these scope-summary lines:

- Shard mode without `target_path`: `Shard <slot+1>/<n> · <shard_count> pages in slice · <recent_count> recently-changed · <in_scope_count> total in scope · corpus <total> pages.`
- Shard mode with `target_path`: `Path /<target_path> · shard <slot+1>/<n> · <shard_count> pages in slice · <recent_count> recently-changed · <in_scope_count> total in scope · subtree corpus <total> pages.`
- Full mode with `target_path`: `Path /<target_path> · <in_scope_count> total in scope · subtree corpus <total> pages.`
- Full mode without `target_path`: `Full sweep of <docs_root> · <in_scope_count> total in scope · corpus <total> pages.`

## Findings (<count>)

```yaml
- file: docs/foo.md
  line: 4
  category: invalid-applies-to-value
  severity: high
  evidence: "applies_to.deployment.ess uses an unrecognized deployment key; use `ech` for Elastic Cloud Hosted"
  suggested_fix: |
    applies_to:
      deployment:
        ech: ga
- file: docs/bar.md
  line: 1
  category: missing-applies-to
  severity: high
  evidence: "frontmatter has no applies_to key"
```

## Done when
- All listed pages have a valid `applies_to` block per the verified reference.
- A PR addressing this issue is merged.

## Notes
- <Optional 1-line about anything intentionally skipped>.

<!-- gh-aw-docs-applies-to-sweep:run=<iso_week>:shard=<slot>/<n> -->
```

Keep the YAML block parseable. Use the literal `|` block scalar for multi-line `suggested_fix` values.

## What to skip

- Files outside `/tmp/gh-aw/sweep-data/in-scope.txt`.
- `applies_to` warnings without a concrete remediation — they belong in the next iteration, not this sweep.
- Generic `applies_to` shape preferences when the existing value is technically valid.

${{ inputs.additional-instructions }}
