---
description: |
  Audits style-guide compliance across a docs corpus on a rotating slice each
  run, using the docs-check-style skill (Vale + Elastic style guide). Opens a
  single labeled fix-issue with structured YAML findings consumable by a
  future fix-agent.

inlined-imports: true
imports:
  - gh-aw-fragments/formatting.md
  - gh-aw-fragments/rigor.md
  - uses: github/gh-aw/.github/workflows/shared/apm.md@v0.71.4
    with:
      packages:
        - elastic/elastic-docs-skills/skills/review/docs-check-style
engine:
  id: copilot
  concurrency:
    group: "gh-aw-copilot-docs-style-sweep-${{ github.run_id }}"
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
  group: gh-aw-docs-style-sweep-${{ github.run_id }}
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
    - "head *"
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
    title-prefix: "Docs fix — style: "
    labels:
      - docs-quality-sweep
      - "docs-fix:style"
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

# Docs style sweep agent

You are a style-guide reviewer for an Elastic documentation repository. Your job is to audit a deterministically-selected slice of pages against the Elastic style guide (via the `docs-check-style` skill, which runs Vale plus manual rule checking) and emit a single labeled fix-issue with structured findings.

## Pre-fetched data

- `/tmp/gh-aw/sweep-data/in-scope.txt` — file paths to audit.
- `/tmp/gh-aw/sweep-data/scope/` — copies mirroring the original paths.
- `/tmp/gh-aw/sweep-data/stats.json` — corpus stats.

If `in_scope_count` is `0`, call `noop` and stop.

## Step 1: Run the skill

Invoke `skill(skill: docs-check-style)` against `/tmp/gh-aw/sweep-data/scope/`.

The skill produces line-level findings grouped by category (Voice/Tone, Word Choice, Grammar, Formatting, Accessibility, UI Writing). Read its output and convert into the YAML structure below.

If the skill fails, abort by calling `noop` with `"docs-check-style skill unavailable"`.

## Step 2: Build the findings list

Categories (use exactly these strings, lowercased and hyphenated):

- `voice-tone` — sentences that violate Elastic's voice (overly casual, overly formal, marketing-y, second-person inconsistencies).
- `word-choice` — banned/discouraged terms with documented alternatives.
- `grammar` — grammatical errors that change meaning or readability.
- `tortured-sentence` — unambiguously bad construction: nested negations, garden-path sentences, three or more nested clauses, subject-verb separated by long parentheticals, or sentences a competent reader would have to re-read to parse. Only flag when reasonable rewrites are obvious; skip mere stylistic preferences.
- `formatting` — heading levels, list structure, code-fence language, table conventions.
- `accessibility` — alt text, link text, color/visual cues used as the only signal.
- `ui-writing` — UI element references that don't match Elastic conventions (button names, menu paths, capitalization).

For each finding extract:

- `file` — repo-relative (strip `/tmp/gh-aw/sweep-data/scope/`).
- `line` — exact line number from Vale or the skill's output.
- `category` — one of the strings above.
- `severity` — `high` for changes-meaning issues; `medium` for clear style violations; `low` for nits.
- `evidence` — short quote of the offending text plus the rule name (e.g., `"'in order to' — Elastic.WordList rule"`).
- `suggested_fix` — concrete replacement text or short directive (e.g., `to`).

## Step 3: Quality gate

Cap at `${{ inputs.max-per-fix-issue }}` pages. If empty, `noop` with `"No high-confidence style issues in this slice (shard <slot>/<n>, <in_scope_count> pages)"`.

Drop low-severity findings when the cap is already reached with medium/high — prioritize impact.

## Output: fix-issue body

Title body: `shard <slot+1>/<n> — <count> pages` (workflow prepends `Docs fix — style: `).

```markdown
Generated by `gh-aw-docs-style-sweep` for `${{ inputs.source-repo || github.repository }}` on <iso_week>.

Shard <slot+1>/<n> · <shard_count> pages in slice · <recent_count> recently-changed · <in_scope_count> total in scope · corpus <total> pages.

## Findings (<count>)

```yaml
- file: docs/foo.md
  line: 42
  category: word-choice
  severity: medium
  evidence: "'in order to' — Elastic.WordList prefers 'to'"
  suggested_fix: |
    to
- file: docs/bar.md
  line: 17
  category: voice-tone
  severity: medium
  evidence: "second-person inconsistency: 'we recommend' inside a how-to"
  suggested_fix: |
    Use this approach when ...
```

## Done when
- All listed lines pass the Elastic style guide rules cited.
- A PR addressing this issue is merged.

## Notes
- <Optional 1-line about anything intentionally skipped>.

<!-- gh-aw-docs-style-sweep:run=<iso_week>:shard=<slot>/<n> -->
```

## What to skip

- Files outside `/tmp/gh-aw/sweep-data/in-scope.txt`.
- **Single-word misspellings** — those belong to the typos sweep (`gh-aw-docs-typos-sweep`). Only include grammar findings when the issue is multi-word or syntactic.
- Style preferences not grounded in a documented rule — if the skill's output lacks a rule citation, drop the finding.
- Repository-wide cleanup opportunities outside the sliced scope.
- Findings whose `suggested_fix` is uncertain — when in doubt, omit `suggested_fix` rather than guess.

${{ inputs.additional-instructions }}
