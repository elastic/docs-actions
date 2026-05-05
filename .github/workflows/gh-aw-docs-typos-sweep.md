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
engine:
  id: copilot
  concurrency:
    group: "gh-aw-copilot-docs-typos-sweep-${{ github.run_id }}"
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
      COPILOT_GITHUB_TOKEN:
        required: true
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
    close-older-issues: true
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
      CODESPELL_ARGS: ${{ inputs.codespell-args }}
    run: |
      set -u
      mkdir -p /tmp/gh-aw/sweep-data

      if [ ! -d "$DOCS_ROOT" ]; then
        echo "docs-root '$DOCS_ROOT' does not exist; producing empty output"
        : > /tmp/gh-aw/sweep-data/codespell.out
        echo '{"docs_root":"'"$DOCS_ROOT"'","total_md":0,"finding_count":0}' > /tmp/gh-aw/sweep-data/stats.json
        exit 0
      fi

      TOTAL_MD=$(find "$DOCS_ROOT" -type f -name '*.md' \
        -not -path '*/node_modules/*' -not -path '*/.git/*' | wc -l | tr -d ' ')

      # codespell exits non-zero when misspellings are found. Capture and continue.
      set +e
      codespell \
        --quiet-level=2 \
        $CODESPELL_ARGS \
        $(find "$DOCS_ROOT" -type f -name '*.md' \
          -not -path '*/node_modules/*' -not -path '*/.git/*') \
        > /tmp/gh-aw/sweep-data/codespell.out 2>&1
      RC=$?
      set -e

      FINDING_COUNT=$(wc -l < /tmp/gh-aw/sweep-data/codespell.out | tr -d ' ')
      cat > /tmp/gh-aw/sweep-data/stats.json <<EOF
      {
        "docs_root": "$DOCS_ROOT",
        "total_md": $TOTAL_MD,
        "finding_count": $FINDING_COUNT,
        "exit_code": $RC,
        "iso_week": "$(date +%G-W%V)"
      }
      EOF

      echo "Codespell scan: total_md=$TOTAL_MD finding_count=$FINDING_COUNT exit_code=$RC"

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
- `/tmp/gh-aw/sweep-data/stats.json` — `docs_root`, `total_md`, `finding_count`, `iso_week`.

If `finding_count` is `0`, call `noop` with `"No typos found in <docs_root> (<total_md> .md files scanned)"` and stop.

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

Title body: `<count> typos found across <files> files` (workflow prepends `Docs fix — typos: `).

```markdown
Generated by `gh-aw-docs-typos-sweep` for `${{ inputs.source-repo || github.repository }}` on <iso_week>.

Scanned <total_md> markdown files in <docs_root>; codespell raised <finding_count> raw findings, <count> retained after filtering.

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
