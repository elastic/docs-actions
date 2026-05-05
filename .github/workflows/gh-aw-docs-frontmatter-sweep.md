---
description: |
  Audits frontmatter quality across a docs corpus on a rotating slice each run.
  Combines the docs-frontmatter-audit skill (required-field validation) with
  docs-frontmatter-description (description quality and suggestions). Opens a
  single labeled fix-issue with structured YAML findings consumable by a future
  fix-agent.

inlined-imports: true
imports:
  - gh-aw-fragments/formatting.md
  - gh-aw-fragments/rigor.md
  - uses: github/gh-aw/.github/workflows/shared/apm.md@v0.71.1
    with:
      packages:
        - elastic/elastic-docs-skills/skills/review/frontmatter-audit
        - elastic/elastic-docs-skills/skills/authoring/frontmatter-description
engine:
  id: copilot
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
network:
  allowed:
    - defaults
    - github
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
      TARGET_BATCH: ${{ inputs.target-batch-size }}
    run: |
      set -eu
      mkdir -p /tmp/gh-aw/sweep-data/scope

      if [ ! -d "$DOCS_ROOT" ]; then
        echo "docs-root '$DOCS_ROOT' does not exist; producing empty scope"
        : > /tmp/gh-aw/sweep-data/all.txt
        : > /tmp/gh-aw/sweep-data/shard.txt
        : > /tmp/gh-aw/sweep-data/recent.txt
        : > /tmp/gh-aw/sweep-data/in-scope.txt
        echo '{"total":0,"shard_n":1,"shard_slot":0,"shard_count":0,"recent_count":0,"in_scope_count":0,"iso_week":"'"$(date +%G-W%V)"'","docs_root":"'"$DOCS_ROOT"'"}' > /tmp/gh-aw/sweep-data/stats.json
        exit 0
      fi

      find "$DOCS_ROOT" -type f -name '*.md' \
        -not -path '*/node_modules/*' \
        -not -path '*/.git/*' \
        | sort > /tmp/gh-aw/sweep-data/all.txt

      TOTAL=$(wc -l < /tmp/gh-aw/sweep-data/all.txt | tr -d ' ')
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

      git log --since='7 days ago' --name-only --pretty=format: -- "$DOCS_ROOT/*.md" "$DOCS_ROOT/**/*.md" 2>/dev/null \
        | grep -E '\.md$' \
        | sort -u > /tmp/gh-aw/sweep-data/recent.txt || true

      sort -u /tmp/gh-aw/sweep-data/shard.txt /tmp/gh-aw/sweep-data/recent.txt \
        | grep -v '^$' > /tmp/gh-aw/sweep-data/in-scope.txt || true

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
        "docs_root": "$DOCS_ROOT"
      }
      EOF

      echo "Sweep targets: total=$TOTAL N=$N slot=$SLOT shard=$SHARD_COUNT recent=$RECENT_COUNT in_scope=$IN_SCOPE_COUNT"

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
- `/tmp/gh-aw/sweep-data/scope/` — copies of the same files, mirroring their original paths under this prefix. Pass this directory to skills when they accept a directory argument.
- `/tmp/gh-aw/sweep-data/stats.json` — `total`, `shard_n`, `shard_slot`, `in_scope_count`, `iso_week`, `docs_root`.

Read these with `cat` / `jq`. Do not refetch them from the repo via GitHub APIs.

## Scope

Audit only the files listed in `in-scope.txt`. Do not expand scope to other files even if a skill suggests it. Out-of-scope files are deliberately skipped this run; they will be picked up in subsequent rotations.

If `in_scope_count` is `0`, call `noop` with a short message including the corpus stats (`"Empty corpus" / "All files in this rotation are unaudited"`) and stop.

## Step 1: Run the skills on the slice

Invoke the two installed skills against `/tmp/gh-aw/sweep-data/scope/` (which mirrors only the in-scope files):

- `skill(skill: docs-frontmatter-audit)` — reports missing or invalid required keys (`description`, `applies_to`, `products`, `navigation_title`).
- `skill(skill: docs-frontmatter-description)` — proposes SEO-quality `description:` text where it is missing, empty, too long (>200 chars), or low-quality. **Audit/suggest only — do not write any files.** This sweep produces an issue, not edits.

If both skills succeed, merge their findings; if one fails, report only the other and note the skill failure once in the issue body's `Notes` section.

## Step 2: Build the findings list

For each finding, extract:

- `file` — the original repository-relative path (strip the `/tmp/gh-aw/sweep-data/scope/` prefix from any skill output).
- `line` — `1` for missing/invalid frontmatter keys (frontmatter starts at line 1); for description-quality findings use the line of the `description:` key.
- `category` — one of: `missing-description`, `weak-description`, `description-too-long`, `missing-applies-to`, `invalid-applies-to`, `missing-products`, `missing-navigation-title`.
- `severity` — `high` for missing required fields; `medium` for weak/long/invalid; `low` for nits.
- `evidence` — one short sentence quoting or naming the exact problem.
- `suggested_fix` — concrete YAML snippet ready to paste into the file's frontmatter, when the skill produces one. For audit-only findings (e.g., a missing field with no suggested value), omit `suggested_fix`.

Apply the **Rigor** standards from the imported fragment: skip any finding where you cannot point to exact evidence, and skip any pre-existing build-error-class issues already covered by the docs build.

## Step 3: Quality gate

Cap the findings list at `${{ inputs.max-per-fix-issue }}` pages. If more pages have findings, list the first N (sorted by severity then path) and add a note `+M additional pages will surface in next sweep` to the issue body.

If the capped findings list is empty, call `noop` with `"No high-confidence frontmatter issues in this slice (shard <slot>/<n>, <in_scope_count> pages)"` and stop.

Otherwise, call `create_issue` with the body shape below.

## Output: fix-issue body

Title: `<shard X/N> — N pages` (the workflow's `title-prefix` will prepend `Docs fix — frontmatter: `, so produce a title body like `shard 17/52 — 12 pages`).

Body:

```markdown
Generated by `gh-aw-docs-frontmatter-sweep` for `${{ inputs.source-repo || github.repository }}` on <iso_week>.

Shard <slot+1>/<n> · <shard_count> pages in slice · <recent_count> recently-changed · <in_scope_count> total in scope · corpus <total> pages.

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
- All listed pages have a non-empty, ≤200-character `description` field, valid `applies_to`, and required keys present per the repo's frontmatter schema.
- A PR addressing this issue is merged.

## Notes
- Skill availability: <only mention if a skill failed>.
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
