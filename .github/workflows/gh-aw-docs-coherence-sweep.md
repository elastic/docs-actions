---
description: |
  Audits docs for coherence across a rotating slice each run by comparing each
  in-scope page against related published Elastic docs (via the elastic-docs
  MCP server). Flags duplicate or near-duplicate content and contradictory
  claims that risk surfacing conflicting answers in search or AI assistants.
  Opens a single labeled fix-issue with structured YAML findings.

inlined-imports: true
imports:
  - gh-aw-fragments/formatting.md
  - gh-aw-fragments/rigor.md
  - gh-aw-fragments/mcp-pagination.md
model: sonnet
engine:
  id: claude
  env:
    ANTHROPIC_API_KEY: ${{ secrets.LITELLM_API_KEY }}
    ANTHROPIC_BASE_URL: https://elastic.litellm-prod.ai
    ENABLE_PROMPT_CACHING_1H: '1'
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
        description: "Approximate pages per rotating slice. Coherence is expensive (MCP + LLM comparisons per page) — keep this small."
        type: string
        required: false
        default: "50"
      max-per-fix-issue:
        description: "Cap on findings per fix-issue; overflow is noted and surfaces in next sweep"
        type: string
        required: false
        default: "20"
      max-related-per-page:
        description: "Cap on related-doc comparisons per in-scope page (each is ~one MCP fetch + one LLM judgment)"
        type: string
        required: false
        default: "3"
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
      LITELLM_API_KEY:
        required: false
concurrency:
  group: gh-aw-docs-coherence-sweep-${{ github.run_id }}
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
    title-prefix: "Docs fix — coherence: "
    labels:
      - docs-quality-sweep
      - "docs-fix:coherence"
    max: 1
timeout-minutes: 45
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

# Docs coherence sweep agent

You are a coherence reviewer for an Elastic documentation repository. Your job is to compare each in-scope page against published Elastic docs that cover overlapping topics, and flag two things that hurt search and AI-assistant quality:

1. **Duplicate or near-duplicate content** — the same explanation living in multiple places.
2. **Contradictions** — different pages giving different answers to the same question.

The Elastic Docs MCP server is your primary tool. You are not running on the full repo; you're inspecting a deterministic slice each run.

## Pre-fetched data

- `/tmp/gh-aw/sweep-data/in-scope.txt` — file paths to audit.
- `/tmp/gh-aw/sweep-data/scope/` — copies mirroring the original paths.
- `/tmp/gh-aw/sweep-data/stats.json` — corpus stats.

If `in_scope_count` is `0`, call `noop` with a path-aware or shard-aware message based on `selection_mode`, then stop.

## Step 1: For each in-scope page, find related published docs

Process pages from `/tmp/gh-aw/sweep-data/scope/` one at a time. For each:

1. Read the page (title, frontmatter, opening paragraphs, key headings).
2. Construct a focused query — the H1 plus the first one or two sentences of substantive content. Avoid using the navigation title alone; it's too short for useful matching.
3. Call `elastic-docs.find_related_docs` (or `elastic-docs.search_docs` if the related-docs tool isn't returning useful matches) with that query.
4. Take the top `${{ inputs.max-related-per-page }}` results that are *not the same page* the in-scope file is published as. Skip any result whose URL points back to the page itself (match by URL slug or title).
5. For each kept result, fetch the published version with `elastic-docs.get_document_by_url` and compare it to the in-scope file.

Conserve MCP calls — do not call `find_related_docs` multiple times per page hoping for a different result. One query, top-N, move on.

## Step 2: Classify each comparison

For each (in-scope page, related published page) pair, choose one verdict:

- **`duplicate-content`** — the two pages say substantially the same thing across most of their content. Use this when the in-scope page could plausibly redirect to or be merged into the related page (or vice versa).
- **`near-duplicate`** — there is significant overlap (one or two sections that are essentially the same), but each page also has unique content. Use this when consolidation or cross-linking is the obvious fix, not deletion.
- **`contradictory-content`** — the two pages give different answers to the same question (different default values, different supported versions, different recommended steps for the same scenario). This is the highest-priority verdict because it actively misleads readers and AI assistants.
- **`coherent`** — the pages are related but distinct, with no overlap or conflict worth filing. Do not emit a finding for these.

Apply the **Rigor** standards strictly. A finding must include a concrete pointer to the conflict or overlap (specific quoted lines, specific section headings, specific numerical values that disagree). If you can't cite the exact passage, omit the finding.

## Step 3: Build the findings list

For each finding produced in step 2, extract:

- `file` — the in-scope repo-relative path (strip `/tmp/gh-aw/sweep-data/scope/`).
- `line` — line number of the conflicting/overlapping passage in the in-scope file.
- `category` — `duplicate-content`, `near-duplicate`, or `contradictory-content`.
- `severity` — `high` for `contradictory-content`; `medium` for `duplicate-content`; `low` for `near-duplicate`.
- `evidence` — quote the disagreeing passage from the in-scope file in 1–2 short sentences, name the related published page by its URL.
- `related_url` — the published URL of the other page.
- `suggested_fix` — concrete remediation (consolidate, redirect, cross-link, or fix the contradiction). Be specific about which page should be the source of truth.

## Step 4: Sort and cap

Sort findings by `severity` (`high` → `medium` → `low`), then by `file` ascending, then by `line` ascending.

Cap at `${{ inputs.max-per-fix-issue }}` findings.

If empty, call `noop` and adapt the message to the selection mode:

- Shard mode without `target_path`: `"No coherence findings in this slice (shard <slot>/<n>, <in_scope_count> pages)"`.
- Shard mode with `target_path`: `"No coherence findings under /<target_path> in shard <slot>/<n> (<in_scope_count> pages)"`.
- Full mode with `target_path`: `"No coherence findings under /<target_path> (<in_scope_count> pages)"`.
- Full mode without `target_path`: `"No coherence findings in full sweep <docs_root> (<in_scope_count> pages)"`.

If the MCP server is unreachable or returns errors for more than half the pages, abort by calling `noop` with `"elastic-docs MCP unavailable; skipping coherence sweep"` rather than emitting unreliable findings.

## Output: fix-issue body

Title body depends on the selection mode:

- Shard mode without `target_path`: `shard <slot+1>/<n> — <count> findings` (workflow prepends `Docs fix — coherence: `).
- Shard mode with `target_path`: `path /<target_path> — shard <slot+1>/<n> — <count> findings`.
- Full mode with `target_path`: `path /<target_path> — <count> findings`.
- Full mode without `target_path`: `full <docs_root> — <count> findings`.

```markdown
Generated by `gh-aw-docs-coherence-sweep` for `${{ inputs.source-repo || github.repository }}` on <iso_week>.

Use one of these scope-summary lines:

- Shard mode without `target_path`: `Shard <slot+1>/<n> · <shard_count> pages in slice · <recent_count> recently-changed · <in_scope_count> total in scope · corpus <total> pages.`
- Shard mode with `target_path`: `Path /<target_path> · shard <slot+1>/<n> · <shard_count> pages in slice · <recent_count> recently-changed · <in_scope_count> total in scope · subtree corpus <total> pages.`
- Full mode with `target_path`: `Path /<target_path> · <in_scope_count> total in scope · subtree corpus <total> pages.`
- Full mode without `target_path`: `Full sweep of <docs_root> · <in_scope_count> total in scope · corpus <total> pages.`

## Findings (<count>)

```yaml
- file: docs/foo.md
  line: 12
  category: contradictory-content
  severity: high
  evidence: "states 'default refresh interval is 1s' but related published page says 30s"
  related_url: https://www.elastic.co/docs/elasticsearch/reference/refresh-intervals
  suggested_fix: |
    treat the related published page as source of truth; update this page or remove the contradicting line and link out
- file: docs/bar.md
  line: 1
  category: duplicate-content
  severity: medium
  evidence: "the entire 'Configure data views' section duplicates the published page nearly verbatim"
  related_url: https://www.elastic.co/docs/kibana/data-views/configure
  suggested_fix: |
    replace the duplicated section with a short summary and a link to the canonical page
- file: docs/baz.md
  line: 47
  category: near-duplicate
  severity: low
  evidence: "the 'Performance tuning' subsection overlaps with two paragraphs of the related page; rest of this page is unique"
  related_url: https://www.elastic.co/docs/elasticsearch/performance/tuning
  suggested_fix: |
    cross-link to the related page rather than restating its tuning advice
```

## Done when
- Duplicate content is consolidated or replaced with a cross-link.
- Contradictions are reconciled, with one page as source of truth.
- A PR addressing this issue is merged.

## Notes
- MCP availability: <mention only if calls failed and that affected the run>.
- <Optional 1-line about anything intentionally skipped>.

<!-- gh-aw-docs-coherence-sweep:run=<iso_week>:shard=<slot>/<n> -->
```

## What to skip

- Files outside `/tmp/gh-aw/sweep-data/in-scope.txt`.
- Pairs where the related published page IS the in-scope page (e.g., a doc compared against its own published mirror). Detect via URL slug or near-identical title; skip silently.
- Differences that aren't contradictions: stylistic phrasing, ordering, or examples that lead to the same conclusion.
- `near-duplicate` findings whose `suggested_fix` would be "improve cross-linking" without a concrete target — those belong to a future cross-links sweep, not this one.
- Comparisons where the related doc looks like a release-notes / changelog / migration page — overlap with those is expected.

${{ inputs.additional-instructions }}
