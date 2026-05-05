---
description: |
  Audits page openings (H1 specificity, opening paragraph, "Before you begin")
  across a docs corpus on a rotating slice each run, using the
  docs-page-opening-optimizer skill in suggest-only mode. Opens a single
  labeled fix-issue with structured YAML findings.

inlined-imports: true
imports:
  - gh-aw-fragments/formatting.md
  - gh-aw-fragments/rigor.md
  - uses: github/gh-aw/.github/workflows/shared/apm.md@v0.71.1
    with:
      packages:
        - elastic/elastic-docs-skills/skills/authoring/page-opening-optimizer
engine:
  id: copilot
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
  group: gh-aw-docs-openings-sweep-${{ github.run_id }}
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
    - "diff *"
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
    title-prefix: "Docs fix — page openings: "
    labels:
      - docs-quality-sweep
      - "docs-fix:openings"
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

# Docs page-openings sweep agent

You are a page-opening reviewer for an Elastic documentation repository. Your job is to audit the opening of a deterministically-selected slice of pages — H1 specificity, opening paragraph quality, and "Before you begin" appropriateness — and emit a single labeled fix-issue with structured findings.

## Pre-fetched data

A pre-step has computed the in-scope file list:

- `/tmp/gh-aw/sweep-data/in-scope.txt` — file paths to audit.
- `/tmp/gh-aw/sweep-data/scope/` — copies mirroring the original paths. This is a working directory; the skill may write here. Use these copies, not the repo originals, when invoking the skill.
- `/tmp/gh-aw/sweep-data/stats.json` — corpus stats.

If `in_scope_count` is `0`, call `noop` with the stats and stop.

## Step 1: Run the skill in suggest-only mode

Invoke `skill(skill: docs-page-opening-optimizer)` against `/tmp/gh-aw/sweep-data/scope/`.

**Suggest only — do not produce edits to repo originals.** This sweep emits an issue, not a PR. The skill may modify files inside the scope copy directory; that is fine — the changes are scratch. To recover the suggestion, diff each modified scope file against the original at `${{ github.workspace }}/<path>`.

If the skill fails, abort by calling `noop` with `"docs-page-opening-optimizer skill unavailable"`.

## Optional: cross-check H1 specificity via the Elastic Docs MCP server

When judging whether an H1 is too vague, you may consult the `elastic-docs` MCP server (`search_docs`, `find_related_docs`) to see whether sibling pages on the same product/feature use distinct H1s. Use this when:

- A candidate `vague-h1` finding has a generic word ("Overview", "Introduction") and you want to confirm the term is overloaded across the public docs.
- The skill's suggested H1 reuses a phrase that already appears as another page's H1 — call this out and pick a more distinctive replacement.

Skip the MCP call when the skill's judgment is already grounded in concrete evidence; do not pad findings with weak MCP-derived nits.

## Step 2: Build the findings list

Categories (use exactly these strings):

- `missing-h1` — file has no `# Heading` line.
- `vague-h1` — H1 is generic ("Overview", "Introduction", "Guide", "About") without product/feature context, or is a common word that doesn't indicate the page topic.
- `missing-h1-anchor` — H1 lacks the `[anchor-id]` suffix where the repo's convention requires one (the skill enforces this; respect its judgment).
- `weak-opening` — opening paragraph is empty, exceeds 4 sentences, or fails to convey what the page covers within the first 2 sentences.
- `missing-before-you-begin` — task/how-to page that omits a prerequisites section the skill judges necessary.
- `inadequate-navigation-title` — `navigation_title` is missing or duplicates the H1 verbatim when a shorter form is needed.

For each finding extract:

- `file` — repo-relative path (strip `/tmp/gh-aw/sweep-data/scope/`).
- `line` — line number of the affected element in the original file (H1 line for H1 findings, opening-paragraph start for opening findings, `navigation_title:` line for nav-title findings).
- `category`, `severity` (`high` for missing/vague-H1; `medium` for weak-opening; `low` for nav-title nits), `evidence`, `suggested_fix`.
- `suggested_fix` should be a concrete replacement (e.g., a one-line H1, a 2–4 sentence opening paragraph, or a YAML snippet for navigation_title).

## Step 3: Quality gate

Cap at `${{ inputs.max-per-fix-issue }}` pages. If empty, `noop` with `"No high-confidence opening issues in this slice (shard <slot>/<n>, <in_scope_count> pages)"`.

Skip findings where the skill's suggestion materially changes meaning rather than just clarity — those need a human author, not a fix-agent.

## Output: fix-issue body

Title body: `shard <slot+1>/<n> — <count> pages` (workflow prepends `Docs fix — page openings: `).

```markdown
Generated by `gh-aw-docs-openings-sweep` for `${{ inputs.source-repo || github.repository }}` on <iso_week>.

Shard <slot+1>/<n> · <shard_count> pages in slice · <recent_count> recently-changed · <in_scope_count> total in scope · corpus <total> pages.

## Findings (<count>)

```yaml
- file: docs/foo.md
  line: 7
  category: vague-h1
  severity: high
  evidence: "H1 is 'Overview' — no product or feature context"
  suggested_fix: |
    # Configure data views in Kibana [configure-data-views]
- file: docs/bar.md
  line: 9
  category: weak-opening
  severity: medium
  evidence: "first paragraph is one sentence and does not say what the page covers"
  suggested_fix: |
    Data views are saved searches that point to one or more indices and define
    which fields Kibana exposes for analysis. Use this page to create a data
    view, choose a time field, and verify field types before building
    visualizations.
```

## Done when
- All listed pages have a specific, contextual H1; an opening paragraph that conveys purpose; and (where applicable) a prerequisites section.
- A PR addressing this issue is merged.

## Notes
- <Optional 1-line about anything intentionally skipped>.

<!-- gh-aw-docs-openings-sweep:run=<iso_week>:shard=<slot>/<n> -->
```

## What to skip

- Files outside `/tmp/gh-aw/sweep-data/in-scope.txt`.
- Subjective rewrites that don't measurably improve specificity or scannability.
- Stylistic preferences already covered by `docs-check-style` — leave those to the style sweep.
- Findings whose `suggested_fix` would change the page's technical content rather than its framing.

${{ inputs.additional-instructions }}
