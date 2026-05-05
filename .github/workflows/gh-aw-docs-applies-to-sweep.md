---
description: |
  Validates the `applies_to` frontmatter key across a docs corpus on a rotating
  slice each run, using the docs-applies-to-tagging skill in audit mode.
  Opens a single labeled fix-issue with structured YAML findings consumable by
  a future fix-agent.

inlined-imports: true
imports:
  - gh-aw-fragments/formatting.md
  - gh-aw-fragments/rigor.md
  - uses: github/gh-aw/.github/workflows/shared/apm.md@v0.71.4
    with:
      packages:
        - elastic/elastic-docs-skills/skills/authoring/applies-to-tagging
engine:
  id: copilot
  concurrency:
    group: "gh-aw-copilot-docs-applies-to-sweep-${{ github.run_id }}"
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
      COPILOT_GITHUB_TOKEN:
        required: true
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
network:
  allowed:
    - defaults
    - github
safe-outputs:
  noop:
  create-issue:
    title-prefix: "Docs fix — applies_to: "
    labels:
      - docs-quality-sweep
      - "docs-fix:applies-to"
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

# Docs `applies_to` sweep agent

You are an `applies_to` validator for an Elastic documentation repository. Your job is to audit the `applies_to` frontmatter key on a deterministically-selected slice of pages and emit a single labeled fix-issue with structured findings.

## Pre-fetched data

A pre-step has computed the in-scope file list:

- `/tmp/gh-aw/sweep-data/in-scope.txt` — file paths to audit.
- `/tmp/gh-aw/sweep-data/scope/` — copies mirroring the original paths.
- `/tmp/gh-aw/sweep-data/stats.json` — corpus stats.

Read with `cat` / `jq`. If `in_scope_count` is `0`, call `noop` with the stats and stop.

## Step 1: Run the skill in audit mode

Invoke `skill(skill: docs-applies-to-tagging)` against `/tmp/gh-aw/sweep-data/scope/`.

**Audit mode only — do not write any files.** The skill defaults to validation when not asked to fix; reinforce that intent in the call. This sweep produces an issue, not edits.

If the skill fails, abort the run by calling `noop` with `"docs-applies-to-tagging skill unavailable"` — there is no fallback heuristic worth filing as findings.

## Step 2: Build the findings list

Categories (use exactly these strings):

- `missing-applies-to` — no `applies_to:` key in frontmatter where one is required.
- `invalid-applies-to-syntax` — malformed YAML or unrecognized structure under `applies_to:`.
- `invalid-applies-to-value` — recognized structure but a value (product, deployment, lifecycle stage) that is not in the allowed vocabulary.
- `inconsistent-applies-to` — `applies_to` contradicts other frontmatter (e.g., `products:` says one thing, `applies_to:` another).
- `outdated-applies-to` — references a deployment/lifecycle value that is deprecated per the skill's reference set.

For each finding extract `file`, `line`, `category`, `severity`, `evidence`, and `suggested_fix` (concrete YAML snippet) when the skill produces one.

Strip the `/tmp/gh-aw/sweep-data/scope/` prefix from `file` so paths are repo-relative.

## Step 3: Quality gate

Cap at `${{ inputs.max-per-fix-issue }}` pages. If empty, `noop` with `"No applies_to issues in this slice (shard <slot>/<n>, <in_scope_count> pages)"` and stop.

## Output: fix-issue body

Title body: `shard <slot+1>/<n> — <count> pages` (workflow prepends `Docs fix — applies_to: `).

Body:

```markdown
Generated by `gh-aw-docs-applies-to-sweep` for `${{ inputs.source-repo || github.repository }}` on <iso_week>.

Shard <slot+1>/<n> · <shard_count> pages in slice · <recent_count> recently-changed · <in_scope_count> total in scope · corpus <total> pages.

## Findings (<count>)

```yaml
- file: docs/foo.md
  line: 4
  category: invalid-applies-to-value
  severity: high
  evidence: "applies_to.deployment.ess: 'preview' — not in allowed lifecycle values"
  suggested_fix: |
    applies_to:
      deployment:
        ess: ga
- file: docs/bar.md
  line: 1
  category: missing-applies-to
  severity: high
  evidence: "frontmatter has no applies_to key"
```

## Done when
- All listed pages have a valid `applies_to` block per the skill's reference set.
- A PR addressing this issue is merged.

## Notes
- <Optional 1-line about anything intentionally skipped>.

<!-- gh-aw-docs-applies-to-sweep:run=<iso_week>:shard=<slot>/<n> -->
```

Keep the YAML block parseable. Use the literal `|` block scalar for multi-line `suggested_fix` values.

## What to skip

- Files outside `/tmp/gh-aw/sweep-data/in-scope.txt`.
- `applies_to` values the skill flags as warnings without a concrete remediation — they belong in the next iteration, not this sweep.
- Generic `applies_to` shape preferences when the existing value is technically valid.

${{ inputs.additional-instructions }}
