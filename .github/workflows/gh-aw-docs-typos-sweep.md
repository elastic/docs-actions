---
description: |
  Runs codespell across the docs corpus and turns the deterministic
  misspelling list into a structured fix-issue. No LLM skill is invoked for
  detection; the agent only formats and disambiguates the output. Full-repo
  scan (no rotation) because codespell is cheap.

inlined-imports: true
imports:
  - gh-aw-fragments/formatting.md
  - gh-aw-fragments/rigor.md
model: sonnet
engine:
  id: claude
  env:
    ANTHROPIC_API_KEY: ${{ secrets.DOCS_LITELLM_API_KEY }}
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
        description: "Approximate pages per rotating slice when scope-mode resolves to shard"
        type: string
        required: false
        default: "100"
      max-per-fix-issue:
        description: "Cap on findings per fix-issue; overflow is noted and surfaces in next sweep"
        type: string
        required: false
        default: "50"
      codespell-args:
        description: "Extra arguments passed verbatim to codespell (e.g., --ignore-words=path/to/allow.txt --skip='*.svg')"
        type: string
        required: false
        default: ""
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
  group: gh-aw-docs-typos-sweep-${{ github.run_id }}
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
    - "wc *"
    - "head *"
    - "jq *"
network:
  allowed:
    - defaults
    - github
safe-outputs:
  noop:
  create-issue:
    title-prefix: "Docs fix — typos: "
    labels:
      - docs-quality-sweep
      - "docs-fix:typos"
    max: 1
timeout-minutes: 15
steps:
  - name: Checkout source docs repo
    uses: actions/checkout@v6
    with:
      repository: ${{ inputs.source-repo || github.repository }}
      fetch-depth: 1
      persist-credentials: false
  - name: Install codespell
    run: pip install --quiet codespell
  - name: Run codespell
    env:
      DOCS_ROOT: ${{ inputs.docs-root }}
      TARGET_PATH: ${{ inputs.target-path }}
      SCOPE_MODE: ${{ inputs.scope-mode }}
      TARGET_BATCH: ${{ inputs.target-batch-size }}
      CODESPELL_ARGS: ${{ inputs.codespell-args }}
    run: |
      set -u
      mkdir -p /tmp/gh-aw/sweep-data

      TARGET_PATH_CLEAN=${TARGET_PATH#/}
      TARGET_PATH_CLEAN=${TARGET_PATH_CLEAN%/}
      DOCS_ROOT_CLEAN=${DOCS_ROOT%/}
      SCOPE_ROOT="$DOCS_ROOT"
      REQUESTED_SCOPE_MODE="$SCOPE_MODE"
      SELECTION_MODE="full"

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
        SELECTION_MODE="full"
      else
        SELECTION_MODE="$REQUESTED_SCOPE_MODE"
      fi

      if [ ! -d "$SCOPE_ROOT" ]; then
        echo "scope root '$SCOPE_ROOT' does not exist; producing empty output"
        : > /tmp/gh-aw/sweep-data/codespell.out
        : > /tmp/gh-aw/sweep-data/all.txt
        : > /tmp/gh-aw/sweep-data/in-scope.txt
        echo '{"docs_root":"'"$DOCS_ROOT"'","scope_root":"'"$SCOPE_ROOT"'","target_path":"'"$TARGET_PATH_CLEAN"'","scope_mode":"'"$REQUESTED_SCOPE_MODE"'","selection_mode":"'"$SELECTION_MODE"'","shard_n":1,"shard_slot":0,"in_scope_count":0,"total_md":0,"finding_count":0}' > /tmp/gh-aw/sweep-data/stats.json
        exit 0
      fi

      find "$SCOPE_ROOT" -type f -name '*.md' \
        -not -path '*/node_modules/*' \
        -not -path '*/.git/*' \
        | sort > /tmp/gh-aw/sweep-data/all.txt

      TOTAL_MD=$(wc -l < /tmp/gh-aw/sweep-data/all.txt | tr -d ' ')

      if [ "$SELECTION_MODE" = "shard" ]; then
        if [ "$TOTAL_MD" -eq 0 ]; then
          N=1
        else
          N=$(( (TOTAL_MD + TARGET_BATCH - 1) / TARGET_BATCH ))
        fi
        ISO_WEEK_NUM=$(date +%V | sed 's/^0//')
        SLOT=$(( ISO_WEEK_NUM % N ))
        : > /tmp/gh-aw/sweep-data/in-scope.txt
        while IFS= read -r f; do
          [ -z "$f" ] && continue
          HEX=$(printf '%s' "$f" | shasum -a 256 | cut -c1-4)
          HASH_NUM=$(( 16#$HEX ))
          if [ $((HASH_NUM % N)) -eq "$SLOT" ]; then
            echo "$f" >> /tmp/gh-aw/sweep-data/in-scope.txt
          fi
        done < /tmp/gh-aw/sweep-data/all.txt
      else
        N=1
        SLOT=0
        cp /tmp/gh-aw/sweep-data/all.txt /tmp/gh-aw/sweep-data/in-scope.txt
      fi

      IN_SCOPE_COUNT=$(wc -l < /tmp/gh-aw/sweep-data/in-scope.txt | tr -d ' ')

      # codespell exits non-zero when misspellings are found. Capture and continue.
      set +e
      if [ ! -s /tmp/gh-aw/sweep-data/in-scope.txt ]; then
        : > /tmp/gh-aw/sweep-data/codespell.out
        RC=0
      else
        codespell \
          --quiet-level=2 \
          $CODESPELL_ARGS \
          $(cat /tmp/gh-aw/sweep-data/in-scope.txt) \
          > /tmp/gh-aw/sweep-data/codespell.out 2>&1
        RC=$?
      fi
      set -e

      FINDING_COUNT=$(wc -l < /tmp/gh-aw/sweep-data/codespell.out | tr -d ' ')
      cat > /tmp/gh-aw/sweep-data/stats.json <<EOF
      {
        "docs_root": "$DOCS_ROOT",
        "scope_root": "$SCOPE_ROOT",
        "target_path": "$TARGET_PATH_CLEAN",
        "scope_mode": "$REQUESTED_SCOPE_MODE",
        "selection_mode": "$SELECTION_MODE",
        "shard_n": $N,
        "shard_slot": $SLOT,
        "in_scope_count": $IN_SCOPE_COUNT,
        "total_md": $TOTAL_MD,
        "finding_count": $FINDING_COUNT,
        "exit_code": $RC,
        "iso_week": "$(date +%G-W%V)"
      }
      EOF

      echo "Codespell scan: scope_mode=$REQUESTED_SCOPE_MODE mode=$SELECTION_MODE scope_root=$SCOPE_ROOT total_md=$TOTAL_MD in_scope=$IN_SCOPE_COUNT shard_n=$N shard_slot=$SLOT finding_count=$FINDING_COUNT exit_code=$RC"

  - name: Repo-specific setup
    if: ${{ inputs.setup-commands != '' }}
    env:
      SETUP_COMMANDS: ${{ inputs.setup-commands }}
    run: eval "$SETUP_COMMANDS"
---

# Docs typos sweep agent

You are a deterministic typos-finding formatter. The detection has already happened — `codespell` ran in a pre-step against the docs root. Your only job is to convert the raw output into a labeled fix-issue with a clean structured findings list.

## Pre-fetched data

- `/tmp/gh-aw/sweep-data/codespell.out` — codespell output, one finding per line in the format:
  `path/to/file.md:LINE: misspelled ==> correction, alt1, alt2`
- `/tmp/gh-aw/sweep-data/stats.json` — `docs_root`, `scope_root`, `target_path`, `scope_mode`, `selection_mode`, `shard_n`, `shard_slot`, `in_scope_count`, `total_md`, `finding_count`, `iso_week`.

If `finding_count` is `0`, call `noop` and adapt the message to `selection_mode` and `target_path`:

- Full mode without `target_path`: `"No typos found in <docs_root> (<in_scope_count> .md files scanned)"`.
- Full mode with `target_path`: `"No typos found under /<target_path> (<in_scope_count> .md files scanned)"`.
- Shard mode without `target_path`: `"No typos found in shard <slot+1>/<n> of <docs_root> (<in_scope_count> .md files scanned)"`.
- Shard mode with `target_path`: `"No typos found under /<target_path> in shard <slot+1>/<n> (<in_scope_count> .md files scanned)"`.

## Step 1: Parse codespell output

Each non-empty line follows the shape:
```
docs/foo.md:42: teh ==> the
docs/bar.md:17: recieve ==> receive
docs/baz.md:9: ambigous ==> ambiguous, ambiguously
```

Extract `file`, `line`, `misspelled`, and `correction`. When codespell offers multiple corrections (comma-separated), pick the single most likely one based on the surrounding line in the file. If the choice is ambiguous, **omit `suggested_fix`** and include the alternatives in `evidence`.

## Step 2: Build the findings list

Categories (use exactly these strings):

- `typo` — codespell flagged a misspelling with a single confident correction.
- `ambiguous-typo` — codespell offered multiple corrections; the right one depends on context.

For each finding produce:

- `file` — repo-relative path (codespell already emits these correctly).
- `line` — line number from codespell.
- `category` — `typo` or `ambiguous-typo`.
- `severity` — always `low` (typos are unambiguous fixes regardless of impact).
- `evidence` — `"'<misspelled>' — codespell suggests: <comma-separated corrections>"`.
- `suggested_fix` — the chosen correction (omit for `ambiguous-typo`).

## Step 3: Filter false positives

Drop findings where the misspelled token is:

- Inside a fenced code block (` ``` `), inline code (`` `…` ``), or a URL (`https://…`).
- A proper noun, product name, or technical identifier (e.g., `Elastic`, `kibana`, `kubectl`, command flags). Codespell sometimes flags these; skip them.
- Inside YAML frontmatter values that look like keys/IDs rather than prose.

Use `head -n <line>` and `cat` to inspect the surrounding context when filtering. When unsure whether a finding is a false positive, **drop it** — silence beats noise (per `rigor.md`).

## Step 4: Sort and emit

Sort findings by `file` ascending, then by `line` ascending — this groups all typos in a single file together so an author can fix them in one pass.

**Do not cap by category**. codespell is deterministic and every finding is unambiguous (one word swap); emit all of them after filtering. The reader does not need agent judgment about *which* typos are most important — they're all "fix the misspelling."

If, after filtering, the list is empty, `noop` with `"All <finding_count> codespell findings were false positives or out of scope"`.

**Hard upper bound for issue body length**: if the post-filter list would exceed 400 rows (GitHub issue body limit ≈ 65,536 characters), cap at 400 and add a note `+M additional typos will surface in next sweep`. This is a safety belt for issue-body length, not a quality gate. The `${{ inputs.max-per-fix-issue }}` input is **not** used by this sweep.

## Output: fix-issue body

Title body depends on the selection mode:

- Full mode without `target_path`: `<count> typos found across <files> files` (workflow prepends `Docs fix — typos: `).
- Full mode with `target_path`: `path /<target_path> — <count> typos across <files> files`.
- Shard mode without `target_path`: `shard <slot+1>/<n> — <count> typos across <files> files`.
- Shard mode with `target_path`: `path /<target_path> — shard <slot+1>/<n> — <count> typos across <files> files`.

```markdown
Generated by `gh-aw-docs-typos-sweep` for `${{ inputs.source-repo || github.repository }}` on <iso_week>.

Use one of these scope-summary lines:

- Full mode without `target_path`: `Scanned <in_scope_count> markdown files in <docs_root>; corpus <total_md> markdown files; codespell raised <finding_count> raw findings, <count> retained after filtering.`
- Full mode with `target_path`: `Scanned <in_scope_count> markdown files under /<target_path>; subtree corpus <total_md> markdown files; codespell raised <finding_count> raw findings, <count> retained after filtering.`
- Shard mode without `target_path`: `Scanned shard <slot+1>/<n> of <docs_root>; <in_scope_count> markdown files in scope; corpus <total_md> markdown files; codespell raised <finding_count> raw findings, <count> retained after filtering.`
- Shard mode with `target_path`: `Scanned path /<target_path> in shard <slot+1>/<n>; <in_scope_count> markdown files in scope; subtree corpus <total_md> markdown files; codespell raised <finding_count> raw findings, <count> retained after filtering.`

## Findings (<count>)

```yaml
- file: docs/foo.md
  line: 42
  category: typo
  severity: low
  evidence: "'teh' — codespell suggests: the"
  suggested_fix: |
    the
- file: docs/bar.md
  line: 9
  category: ambiguous-typo
  severity: low
  evidence: "'ambigous' — codespell suggests: ambiguous, ambiguously"
```

## Done when
- All listed misspellings are corrected.
- A PR addressing this issue is merged.

## Notes
- Findings filtered as false positives: <count if non-zero>.

<!-- gh-aw-docs-typos-sweep:run=<iso_week> -->
```

${{ inputs.additional-instructions }}
