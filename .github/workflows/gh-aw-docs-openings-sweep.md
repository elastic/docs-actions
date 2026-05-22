---
description: |
  Audits page openings (H1 specificity, opening paragraph, "Before you begin")
  across a docs corpus on a rotating slice each run, using self-contained
  review rules and targeted Elastic docs MCP checks. Opens a single labeled
  fix-issue with structured YAML findings.

inlined-imports: true
imports:
  - gh-aw-fragments/formatting.md
  - gh-aw-fragments/rigor.md
  - gh-aw-fragments/mcp-pagination.md
engine:
  id: copilot
  concurrency:
    group: "gh-aw-copilot-docs-openings-sweep-${{ github.run_id }}"
    cancel-in-progress: false
on:
  bots: ["github-actions[bot]"]
  roles: [admin, maintainer, write]
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

# Docs page-openings sweep agent

You are a page-opening reviewer for an Elastic documentation repository. Your job is to audit the opening of a deterministically-selected slice of pages — H1 specificity, opening paragraph quality, and "Before you begin" appropriateness — and emit a single labeled fix-issue with structured findings.

## Pre-fetched data

A pre-step has computed the in-scope file list:

- `/tmp/gh-aw/sweep-data/in-scope.txt` — file paths to audit.
- `/tmp/gh-aw/sweep-data/scope/` — copies mirroring the original paths. Audit these copies and map findings back to the repo originals.
- `/tmp/gh-aw/sweep-data/stats.json` — corpus stats, including `scope_mode`, `selection_mode`, `target_path`, and `scope_root`.

If `in_scope_count` is `0`, call `noop` with a path-aware or shard-aware message based on `selection_mode`, then stop.

## Step 1: Analyze page openings

This workflow is autonomous. Do not invoke runtime skills or depend on a skill package being installed. Read each in-scope file from `/tmp/gh-aw/sweep-data/scope/`, inspect its frontmatter, H1, first substantive paragraph, and early task scaffolding, and produce findings only when the problem is visible in the file.

Audit only. Do not edit repo originals or scope copies. This sweep emits an issue, not a PR.

Apply these checks:

- Classify the page type before judging the opening. Tutorials are learning-oriented and hands-on, how-to pages are goal-oriented task instructions, reference pages describe technical specifications, explanation pages cover concepts, and overview pages are parent/landing pages that often have children in `toc.yml`.
- The page should have exactly one clear H1 near the top after frontmatter.
- The H1 should be discoverable, specific, unique, and include product, feature, or task context. Generic titles such as "Overview", "Introduction", "Guide", "Configuration", or "Settings" are findings only when the surrounding page does not make the topic clear in the heading itself.
- Use content-type-appropriate H1 patterns: tutorials often start with "Get started with...", how-to pages use action verbs such as "Configure..." or "Troubleshoot...", reference pages use labels such as "[Feature] settings" or "[API] reference", explanation pages can use "How [feature] works", and overview pages can use the feature name when the page is a landing page.
- If nearby pages in the same docs area consistently use explicit anchor suffixes in H1s, flag a missing H1 anchor on pages that violate that local convention.
- The opening paragraph should immediately follow the H1 unless an important or warning admonition must remain first. It should explain what the page covers within the first two sentences, front-load the important information, and convey purpose, value, and scope in 2-4 complete sentences.
- The opening should not repeat the frontmatter `description`, duplicate the next paragraph, use fragments instead of sentences, or bury the page purpose after a long setup.
- Tutorials should define the feature, explain how it works, and state what the tutorial covers. How-to pages should define the feature or task, explain what it does, and state the value. Reference pages should define the subject and state its purpose. Explanation pages should establish context and state the concepts covered. Overview pages should state what the feature is, its value, and key capabilities.
- Task and how-to pages should include prerequisites or a "Before you begin" section when the steps require access, permissions, prior setup, sample data, or product state that is not obvious from the title.
- Add or recommend "Before you begin" only when no equivalent requirements or prerequisites section appears in the first 50 lines, the page is not an overview page, and at least one requirement is non-obvious. Include specific Kibana privilege levels, data requirements, external systems, special licenses, or version requirements only when the feature requires a version greater than 9.0. Exclude obvious prerequisites, generic "access to Kibana", and procedural details that belong in the main body.
- `navigation_title` should be present when frontmatter convention requires it, should be shorter than a long H1 when a compact navigation label would help, and should not be a vague duplicate such as "Overview".
- Prefer Elastic substitutions in the opening when the repository uses them, such as `{{product.kibana}}`, `{{product.elasticsearch}}`, `{{esql}}`, `{{ece}}`, `{{eck}}`, and `{{ech}}`. Flag hardcoded product names only when the local file or nearby pages clearly use substitutions.
- Use bold for UI elements in the opening and monospace for technical elements.
- Spell out acronyms on first use in the opening.
- Do not rewrite, move, or remove important/warning admonitions in the first ~20 lines. Work around them.
- Do not add pre-9.0 version references to openings in Stack 9+ docs.

Only call `noop` if you cannot produce any high-confidence findings from the in-scope files.

## Optional: cross-check H1 specificity via the Elastic Docs MCP server

When judging whether an H1 is too vague, you may consult the `elastic-docs` MCP server (`search_docs`, `find_related_docs`) to see whether sibling pages on the same product/feature use distinct H1s. Use this when:

- A candidate `vague-h1` finding has a generic word ("Overview", "Introduction") and you want to confirm the term is overloaded across the public docs.
- Your suggested H1 reuses a phrase that already appears as another page's H1. Call this out and pick a more distinctive replacement.

Skip the MCP call when the local file evidence is already concrete; do not pad findings with weak MCP-derived nits.

## Step 2: Build the findings list

Categories (use exactly these strings):

- `missing-h1` — file has no `# Heading` line.
- `vague-h1` — H1 is generic ("Overview", "Introduction", "Guide", "About") without product/feature context, or is a common word that doesn't indicate the page topic.
- `missing-h1-anchor` — H1 lacks the `[anchor-id]` suffix where the repo's convention requires one.
- `weak-opening` — opening paragraph is empty, exceeds 4 sentences, or fails to convey what the page covers within the first 2 sentences.
- `missing-before-you-begin` — task/how-to page that omits a prerequisites section even though the steps require prior access, permissions, setup, sample data, or product state.
- `inadequate-navigation-title` — `navigation_title` is missing or duplicates the H1 verbatim when a shorter form is needed.

For each finding extract:

- `file` — repo-relative path (strip `/tmp/gh-aw/sweep-data/scope/`).
- `line` — line number of the affected element in the original file (H1 line for H1 findings, opening-paragraph start for opening findings, `navigation_title:` line for nav-title findings).
- `category`, `severity` (`high` for missing/vague-H1; `medium` for weak-opening; `low` for nav-title nits), `evidence`, `suggested_fix`.
- `suggested_fix` should be a concrete replacement (e.g., a one-line H1, a 2–4 sentence opening paragraph, or a YAML snippet for navigation_title).

## Step 3: Sort and cap

Sort findings by `severity` (`high` → `medium` → `low`), then by `file` ascending, then by `line` ascending. Group findings on the same `file` adjacently.

Cap at `${{ inputs.max-per-fix-issue }}` distinct files. If empty, call `noop` and adapt the message to the selection mode:

- Shard mode without `target_path`: `"No high-confidence opening issues in this slice (shard <slot>/<n>, <in_scope_count> pages)"`.
- Shard mode with `target_path`: `"No high-confidence opening issues under /<target_path> in shard <slot>/<n> (<in_scope_count> pages)"`.
- Full mode with `target_path`: `"No high-confidence opening issues under /<target_path> (<in_scope_count> pages)"`.
- Full mode without `target_path`: `"No high-confidence opening issues in full sweep <docs_root> (<in_scope_count> pages)"`.

**Drop vague `suggested_fix` values**: do not emit `suggested_fix` if the only thing you can produce is generic prose like "improve clarity" or "consider rewording". Either propose a concrete replacement or omit the `suggested_fix` field entirely — vague advice wastes an author's time.

Skip findings where your suggested fix would materially change meaning rather than just clarity. Those need a human author, not a fix-agent.

## Output: fix-issue body

Title body depends on the selection mode:

- Shard mode without `target_path`: `shard <slot+1>/<n> — <count> pages` (workflow prepends `Docs fix — page openings: `).
- Shard mode with `target_path`: `path /<target_path> — shard <slot+1>/<n> — <count> pages`.
- Full mode with `target_path`: `path /<target_path> — <count> pages`.
- Full mode without `target_path`: `full <docs_root> — <count> pages`.

```markdown
Generated by `gh-aw-docs-openings-sweep` for `${{ inputs.source-repo || github.repository }}` on <iso_week>.

Use one of these scope-summary lines:

- Shard mode without `target_path`: `Shard <slot+1>/<n> · <shard_count> pages in slice · <recent_count> recently-changed · <in_scope_count> total in scope · corpus <total> pages.`
- Shard mode with `target_path`: `Path /<target_path> · shard <slot+1>/<n> · <shard_count> pages in slice · <recent_count> recently-changed · <in_scope_count> total in scope · subtree corpus <total> pages.`
- Full mode with `target_path`: `Path /<target_path> · <in_scope_count> total in scope · subtree corpus <total> pages.`
- Full mode without `target_path`: `Full sweep of <docs_root> · <in_scope_count> total in scope · corpus <total> pages.`

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
- Stylistic preferences already covered by Vale or the style sweep.
- Findings whose `suggested_fix` would change the page's technical content rather than its framing.

${{ inputs.additional-instructions }}
