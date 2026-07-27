---
description: |
  Audits style-guide compliance across a docs corpus on a rotating slice each
  run, by running Vale with the elastic/vale-rules ruleset in a deterministic
  pre-step and having the agent format the findings. Opens a single labeled
  fix-issue with structured YAML findings consumable by a future fix-agent.

inlined-imports: true
imports:
  - uses: shared/apm.md
    with:
      target: claude
      packages:
        - elastic/elastic-docs-skills/skills/review/docs-check-style
        - elastic/elastic-docs-skills/skills/review/flag-jargon-skill
  - gh-aw-fragments/formatting.md
  - gh-aw-fragments/rigor.md
  - gh-aw-fragments/mcp-pagination.md
  - gh-aw-fragments/findings-contract.md
model: claude-sonnet-5
engine:
  id: copilot
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
      target-files:
        description: "Optional newline- or comma-separated list of docs-root-relative file paths to sweep. When set, overrides target-path and scope-mode: the sweep processes exactly these files."
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
concurrency:
  group: gh-aw-docs-style-sweep-${{ github.run_id }}
  cancel-in-progress: false
permissions:
  contents: read
  issues: read
  copilot-requests: write
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
    title-prefix: "Docs fix — style: "
    labels:
      - docs-quality-sweep
      - "docs-fix:style"
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
      TARGET_FILES: ${{ inputs.target-files }}
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

      # target-files overrides target-path and scope-mode: audit exactly the
      # listed files (newline- or comma-separated, docs-root-relative).
      if [ -n "$TARGET_FILES" ]; then
        SELECTION_MODE="files"
        : > /tmp/gh-aw/sweep-data/all.txt
        : > /tmp/gh-aw/sweep-data/shard.txt
        : > /tmp/gh-aw/sweep-data/recent.txt
        : > /tmp/gh-aw/sweep-data/in-scope.txt

        REQUESTED_COUNT=0
        printf '%s' "$TARGET_FILES" | tr ',' '\n' > /tmp/gh-aw/sweep-data/target-files.raw
        while IFS= read -r raw || [ -n "$raw" ]; do
          entry=$(printf '%s' "$raw" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')
          [ -z "$entry" ] && continue
          REQUESTED_COUNT=$(( REQUESTED_COUNT + 1 ))
          entry=${entry#/}
          if [ "$DOCS_ROOT_CLEAN" = "." ] || [ -z "$DOCS_ROOT_CLEAN" ]; then
            resolved="$entry"
          else
            case "$entry" in
              "$DOCS_ROOT_CLEAN"/*) resolved="$entry" ;;
              *) resolved="$DOCS_ROOT_CLEAN/$entry" ;;
            esac
          fi
          if [ -f "$resolved" ]; then
            echo "$resolved" >> /tmp/gh-aw/sweep-data/all.txt
          else
            echo "target-files: '$resolved' not found; skipping"
          fi
        done < /tmp/gh-aw/sweep-data/target-files.raw

        sort -u /tmp/gh-aw/sweep-data/all.txt > /tmp/gh-aw/sweep-data/in-scope.txt
        cp /tmp/gh-aw/sweep-data/in-scope.txt /tmp/gh-aw/sweep-data/all.txt

        while IFS= read -r f; do
          [ -z "$f" ] && continue
          [ ! -f "$f" ] && continue
          mkdir -p "/tmp/gh-aw/sweep-data/scope/$(dirname "$f")"
          cp "$f" "/tmp/gh-aw/sweep-data/scope/$f"
        done < /tmp/gh-aw/sweep-data/in-scope.txt

        IN_SCOPE_COUNT=$(wc -l < /tmp/gh-aw/sweep-data/in-scope.txt | tr -d ' ')
      cat > /tmp/gh-aw/sweep-data/stats.json <<EOF
      {
        "total": $IN_SCOPE_COUNT,
        "shard_n": 1,
        "shard_slot": 0,
        "shard_count": $IN_SCOPE_COUNT,
        "recent_count": 0,
        "in_scope_count": $IN_SCOPE_COUNT,
        "requested_count": $REQUESTED_COUNT,
        "iso_week": "$(date +%G-W%V)",
        "docs_root": "$DOCS_ROOT",
        "scope_mode": "files",
        "selection_mode": "files",
        "target_path": "$TARGET_PATH_CLEAN",
        "scope_root": "$DOCS_ROOT_CLEAN"
      }
      EOF
        echo "Sweep targets (file list): requested=$REQUESTED_COUNT in_scope=$IN_SCOPE_COUNT"
        exit 0
      fi

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

  - name: Install Vale and elastic/vale-rules
    env:
      VALE_VERSION: "3.12.0"
    run: |
      set -eu
      mkdir -p /tmp/gh-aw/bin

      # Download the Vale binary into a path the agent container shares
      curl -fsSL "https://github.com/errata-ai/vale/releases/download/v${VALE_VERSION}/vale_${VALE_VERSION}_Linux_64-bit.tar.gz" \
        -o /tmp/vale.tar.gz
      tar -xz -C /tmp/gh-aw/bin -f /tmp/vale.tar.gz vale
      chmod +x /tmp/gh-aw/bin/vale
      rm /tmp/vale.tar.gz

      # Clone elastic/vale-rules (StylesPath in its .vale.ini is `styles`,
      # resolved relative to the .vale.ini file's directory).
      git clone --depth 1 https://github.com/elastic/vale-rules.git /tmp/gh-aw/vale-rules

      /tmp/gh-aw/bin/vale --version
      ls -la /tmp/gh-aw/vale-rules/.vale.ini

  - name: Run Vale on slice
    run: |
      set -u
      mkdir -p /tmp/gh-aw/sweep-data

      if [ ! -s /tmp/gh-aw/sweep-data/in-scope.txt ]; then
        echo '[]' > /tmp/gh-aw/sweep-data/vale.json
        echo '{"finding_count":0,"file_count":0}' > /tmp/gh-aw/sweep-data/vale-stats.json
        exit 0
      fi

      # Vale exits 1 when it finds problems; that's expected and not a failure.
      # Run from /tmp/gh-aw/vale-rules so the relative StylesPath resolves.
      cd /tmp/gh-aw/vale-rules
      set +e
      /tmp/gh-aw/bin/vale \
        --config /tmp/gh-aw/vale-rules/.vale.ini \
        --output JSON \
        --no-exit \
        $(while IFS= read -r f; do
            [ -z "$f" ] && continue
            [ -f "/tmp/gh-aw/sweep-data/scope/$f" ] || continue
            printf '%s\n' "/tmp/gh-aw/sweep-data/scope/$f"
          done < /tmp/gh-aw/sweep-data/in-scope.txt) \
        > /tmp/gh-aw/sweep-data/vale.json 2> /tmp/gh-aw/sweep-data/vale.stderr
      RC=$?
      set -e

      # Vale's JSON output is an object keyed by file path. Normalize basic stats.
      FILE_COUNT=$(jq 'keys | length' /tmp/gh-aw/sweep-data/vale.json 2>/dev/null || echo 0)
      FINDING_COUNT=$(jq '[.[] | length] | add // 0' /tmp/gh-aw/sweep-data/vale.json 2>/dev/null || echo 0)
      cat > /tmp/gh-aw/sweep-data/vale-stats.json <<EOF
      {"finding_count": $FINDING_COUNT, "file_count": $FILE_COUNT, "vale_exit": $RC}
      EOF
      echo "Vale: file_count=$FILE_COUNT finding_count=$FINDING_COUNT exit=$RC"
      head -c 4000 /tmp/gh-aw/sweep-data/vale.stderr 2>/dev/null || true

  - name: Repo-specific setup
    if: ${{ inputs.setup-commands != '' }}
    env:
      SETUP_COMMANDS: ${{ inputs.setup-commands }}
    run: eval "$SETUP_COMMANDS"
---

# Docs style sweep agent

You are a style-guide reviewer for an Elastic documentation repository. Your job is to format Vale's findings (already produced by a deterministic pre-step) into the structured YAML schema below, applying light filtering and category mapping. You may add high-confidence manual findings for style-guide areas Vale does not fully cover, especially Formatting and UI writing. **Vale has already run** — you are not invoking any skill.

This workflow also installs these APM skills from `elastic/elastic-docs-skills`:

- `docs-check-style`
- `docs-flag-jargon-skill`

Use those installed skills when they help interpret style-guide, wording, accessibility, or jargon findings that go beyond Vale's deterministic output. Treat them as additive guidance, not as permission to ignore Vale or the explicit filtering rules in this workflow.

## Pre-fetched data

- `/tmp/gh-aw/sweep-data/in-scope.txt` — file paths to audit.
- `/tmp/gh-aw/sweep-data/scope/` — copies mirroring the original paths.
- `/tmp/gh-aw/sweep-data/stats.json` — corpus stats, including `scope_mode`, `selection_mode`, `target_path`, and `scope_root`.
- `/tmp/gh-aw/sweep-data/vale.json` — Vale's raw findings, an object keyed by absolute file path under `/tmp/gh-aw/sweep-data/scope/`. Each value is an array of `{Check, Match, Line, Message, Severity, Span, Link}` objects produced by `vale --output JSON` against the `elastic/vale-rules` ruleset.
- `/tmp/gh-aw/sweep-data/vale-stats.json` — `{finding_count, file_count, vale_exit}`.

If `in_scope_count` or `vale-stats.finding_count` is `0`, call `noop` with a path-aware or shard-aware message based on `selection_mode`, then stop.

## Step 1: Read Vale output

Read `/tmp/gh-aw/sweep-data/vale.json` with `cat | jq`. Each rule check name (the `Check` field, e.g. `Elastic.WordList`, `Elastic.Accessibility`, `Elastic.Voice`) maps to one of our categories below. The `Line`, `Match`, `Message`, and `Severity` fields are the raw inputs you'll convert.

For long Vale outputs, paginate with `jq` rather than reading the whole file in one go.

## Step 2: Build the findings list

Use Vale as the primary source of findings. For high-confidence issues that Vale does not cover, you may also consult the Elastic docs MCP server and fetch the relevant style guide pages with `elastic-docs.get_document_by_url`, including:

- `/docs/contribute-docs/style-guide/formatting`.
- `/docs/contribute-docs/style-guide/ui-writing`.
- `/docs/contribute-docs/style-guide/accessibility`.
- `/docs/contribute-docs/style-guide/voice-tone`.
- `/docs/contribute-docs/style-guide/grammar-spelling`.
- `/docs/contribute-docs/style-guide/word-choice`.

When you add manual findings, explicitly use the installed skill guidance:

- `docs-check-style` for style-guide, formatting, accessibility, and UI-writing judgments.
- `docs-flag-jargon-skill` for Elastic-internal jargon, outdated terms, and unexplained acronyms.

Only add manual findings when the issue is visible in the file, has an exact line number, and has a concrete suggested fix.

Categories (use exactly these strings, lowercased and hyphenated):

- `voice-tone` — sentences that violate Elastic's voice (overly casual, overly formal, marketing-y, second-person inconsistencies).
- `word-choice` — banned/discouraged terms with documented alternatives.
- `grammar` — grammatical errors that change meaning or readability.
- `tortured-sentence` — unambiguously bad construction: nested negations, garden-path sentences, three or more nested clauses, subject-verb separated by long parentheticals, or sentences a competent reader would have to re-read to parse. Only flag when reasonable rewrites are obvious; skip mere stylistic preferences.
- `formatting` — heading levels, list structure, code-fence language, table conventions.
- `accessibility` — alt text, link text, color/visual cues used as the only signal.
- `ui-writing` — UI element references that don't match Elastic conventions (button names, menu paths, capitalization).

Manual checklist for non-Vale findings:

- Formatting: UI element names should be bold; code, commands, config settings, file paths, fields, parameters, values, and environment variables should be monospace; new terms and Elastic docs resource titles should be italicized.
- Formatting: Lists need at least two items, parallel structure, and periods only for complete sentences.
- Formatting: Dates should use `Month DD, YYYY`; times should use uppercase `AM`/`PM`; avoid relative dates such as "recently" when they become stale.
- Formatting: Do not stack admonitions or use an admonition when a requirements section would be clearer.
- Accessibility: Images need useful alt text without backticks; link text must be descriptive; avoid directional-only references such as "above" or "below".
- UI writing: Use "Click **Save**" for action buttons and icons, "Select **Logs**" for tabs, checkboxes, radio buttons, dropdown options, and choices, and "In the **Name** field, enter `value`" for text fields.
- UI writing: Use "Turn on **Feature**" and "Turn off **Feature**" for toggles; use "toggle" as a noun, not a verb.
- UI writing: Use menu arrows such as `Select **Manage index → Add lifecycle policy**`; do not say "open the dropdown menu".
- UI writing: Procedures should usually have 5-9 meaningful steps and omit obvious UI narration.

For each finding extract:

- `file` — repo-relative (strip `/tmp/gh-aw/sweep-data/scope/`).
- `line` — exact line number from Vale's output.
- `category` — one of the strings above; that list is the complete category allowlist for this sweep (see the **Findings contract**).
- `severity` — `high` for changes-meaning issues; `medium` for clear style violations; `low` for nits.
- `confidence` — `high`, `medium`, or `low` per the **Findings contract**. Vale-sourced findings with a single deterministic replacement are usually `high`; manual style judgments you added are usually `medium`.
- `evidence` — short quote of the offending text plus the rule name (e.g., `"'in order to' — Elastic.WordList rule"`).
- `suggested_fix` — concrete replacement text or short directive (e.g., `to`).

## Step 3: Sort and cap

Sort findings by `severity` (`high` → `medium` → `low`), then by `file` ascending, then by `line` ascending. Group findings on the same `file` adjacently.

Cap at `${{ inputs.max-per-fix-issue }}` distinct files. If empty, call `noop` and adapt the message to the selection mode:

- Shard mode without `target_path`: `"No high-confidence style issues in this slice (shard <slot>/<n>, <in_scope_count> pages)"`.
- Shard mode with `target_path`: `"No high-confidence style issues under /<target_path> in shard <slot>/<n> (<in_scope_count> pages)"`.
- Full mode with `target_path`: `"No high-confidence style issues under /<target_path> (<in_scope_count> pages)"`.
- Full mode without `target_path`: `"No high-confidence style issues in full sweep <docs_root> (<in_scope_count> pages)"`.
- Files mode: `"No high-confidence style issues in the requested file list (<in_scope_count> files)"`.

**Files mode**: when `selection_mode` is `files`, the caller supplied an explicit file list via `target-files`; audit exactly those files and ignore `target_path`/shard framing. Use an explicit-file-list description in the title (`file list — <in_scope_count> pages`) and scope-summary (`Explicit file list · <in_scope_count> of <requested_count> requested files in scope.`).

Drop low-severity findings when the cap is already reached with medium/high — prioritize impact.

## Output: fix-issue body

Title body depends on the selection mode:

- Shard mode without `target_path`: `shard <slot+1>/<n> — <count> pages` (workflow prepends `Docs fix — style: `).
- Shard mode with `target_path`: `path /<target_path> — shard <slot+1>/<n> — <count> pages`.
- Full mode with `target_path`: `path /<target_path> — <count> pages`.
- Full mode without `target_path`: `full <docs_root> — <count> pages`.

```markdown
Generated by `gh-aw-docs-style-sweep` for `${{ inputs.source-repo || github.repository }}` on <iso_week>.

Use one of these scope-summary lines:

- Shard mode without `target_path`: `Shard <slot+1>/<n> · <shard_count> pages in slice · <recent_count> recently-changed · <in_scope_count> total in scope · corpus <total> pages.`
- Shard mode with `target_path`: `Path /<target_path> · shard <slot+1>/<n> · <shard_count> pages in slice · <recent_count> recently-changed · <in_scope_count> total in scope · subtree corpus <total> pages.`
- Full mode with `target_path`: `Path /<target_path> · <in_scope_count> total in scope · subtree corpus <total> pages.`
- Full mode without `target_path`: `Full sweep of <docs_root> · <in_scope_count> total in scope · corpus <total> pages.`

## Findings (<count>)

```yaml
- file: docs/foo.md
  line: 42
  category: word-choice
  severity: medium
  confidence: high
  evidence: "'in order to' — Elastic.WordList prefers 'to'"
  suggested_fix: |
    to
- file: docs/bar.md
  line: 17
  category: voice-tone
  severity: medium
  confidence: medium
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
- Style preferences not grounded in a documented rule — if Vale's output lacks a rule citation, drop the finding.
- Repository-wide cleanup opportunities outside the sliced scope.
- Findings whose `suggested_fix` is uncertain — when in doubt, omit `suggested_fix` rather than guess.

${{ inputs.additional-instructions }}
