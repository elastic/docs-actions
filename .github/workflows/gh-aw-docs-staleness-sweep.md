---
description: |
  Audits docs for staleness across a rotating slice each run: content older
  than N years, screenshots older than the doc that references them, broken
  external links (via lychee), and mentions of unsupported product versions
  (via the Elastic Docs MCP server). Opens a single labeled fix-issue with
  structured YAML findings.

inlined-imports: true
imports:
  - gh-aw-fragments/formatting.md
  - gh-aw-fragments/rigor.md
  - gh-aw-fragments/mcp-pagination.md
engine:
  id: copilot
  model: gpt-5-mini
  concurrency:
    group: "gh-aw-copilot-docs-staleness-sweep-${{ github.run_id }}"
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
        default: "30"
      stale-content-months:
        description: "Flag pages whose latest commit is older than this many months"
        type: string
        required: false
        default: "24"
      stale-screenshot-min-gap-months:
        description: "Flag screenshots only when the gap between image last-commit and doc last-commit is at least this many months"
        type: string
        required: false
        default: "6"
      lychee-config:
        description: "Optional path to a lychee config file in the consumer repo (e.g., .lychee.toml)"
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
  group: gh-aw-docs-staleness-sweep-${{ github.run_id }}
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
    - "git rev-parse *"
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
    title-prefix: "Docs fix — staleness: "
    labels:
      - docs-quality-sweep
      - "docs-fix:staleness"
    max: 1
    close-older-issues: true
timeout-minutes: 30
steps:
  - name: Checkout source docs repo
    uses: actions/checkout@v6
    with:
      repository: ${{ inputs.source-repo || github.repository }}
      fetch-depth: 0
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

  - name: Compute per-page git ages and image references
    env:
      STALE_CONTENT_MONTHS: ${{ inputs.stale-content-months }}
      STALE_IMAGE_MIN_GAP_MONTHS: ${{ inputs.stale-screenshot-min-gap-months }}
    run: |
      set -eu

      if [ ! -s /tmp/gh-aw/sweep-data/in-scope.txt ]; then
        echo '{"pages":[],"thresholds":{"stale_content_months":'"$STALE_CONTENT_MONTHS"',"stale_image_min_gap_months":'"$STALE_IMAGE_MIN_GAP_MONTHS"'}}' > /tmp/gh-aw/sweep-data/staleness.json
        exit 0
      fi

      python3 - <<'PY'
      import json, os, re, subprocess, datetime, pathlib

      stale_content_months = int(os.environ["STALE_CONTENT_MONTHS"])
      stale_image_gap_months = int(os.environ["STALE_IMAGE_MIN_GAP_MONTHS"])

      with open("/tmp/gh-aw/sweep-data/in-scope.txt") as f:
          pages = [l.strip() for l in f if l.strip()]

      def last_commit_date(p):
          try:
              out = subprocess.run(
                  ["git", "log", "-1", "--format=%cs", "--", p],
                  capture_output=True, text=True, check=True,
              ).stdout.strip()
              return out or None
          except subprocess.CalledProcessError:
              return None

      img_re = re.compile(r'!\[[^\]]*\]\(([^)]+)\)|<img\s[^>]*src="([^"]+)"', re.IGNORECASE)
      today = datetime.date.today()

      def months_between(a, b):
          return (a.year - b.year) * 12 + (a.month - b.month)

      def parse_date(s):
          try:
              return datetime.date.fromisoformat(s)
          except Exception:
              return None

      out = []
      for p in pages:
          page_date_str = last_commit_date(p)
          page_date = parse_date(page_date_str) if page_date_str else None
          age_months = months_between(today, page_date) if page_date else None

          stale_content = age_months is not None and age_months >= stale_content_months

          images = []
          try:
              with open(p, "r", encoding="utf-8", errors="replace") as fh:
                  text = fh.read()
              for m in img_re.finditer(text):
                  ref = m.group(1) or m.group(2)
                  if not ref:
                      continue
                  if ref.startswith(("http://", "https://", "data:")):
                      continue
                  ref_clean = ref.split("?", 1)[0].split("#", 1)[0].strip()
                  if not ref_clean:
                      continue
                  resolved = ref_clean
                  if not resolved.startswith("/"):
                      resolved = os.path.normpath(os.path.join(os.path.dirname(p), ref_clean))
                  if not os.path.isfile(resolved):
                      continue
                  img_date_str = last_commit_date(resolved)
                  img_date = parse_date(img_date_str) if img_date_str else None
                  gap = None
                  if img_date and page_date:
                      gap = months_between(page_date, img_date)
                  flag = (gap is not None) and (gap >= stale_image_gap_months)
                  images.append({
                      "ref": ref_clean,
                      "resolved": resolved,
                      "image_last_commit": img_date_str,
                      "page_last_commit": page_date_str,
                      "gap_months": gap,
                      "stale": flag,
                  })
          except Exception as e:
              images.append({"error": str(e)})

          out.append({
              "file": p,
              "last_commit": page_date_str,
              "age_months": age_months,
              "stale_content": stale_content,
              "images": images,
          })

      payload = {
          "thresholds": {
              "stale_content_months": stale_content_months,
              "stale_image_min_gap_months": stale_image_gap_months,
          },
          "pages": out,
      }
      with open("/tmp/gh-aw/sweep-data/staleness.json", "w") as fh:
          json.dump(payload, fh, indent=2)

      stale_pages = sum(1 for p in out if p["stale_content"])
      stale_imgs = sum(1 for p in out for img in p["images"] if img.get("stale"))
      print(f"Staleness: pages={len(out)} stale_content={stale_pages} stale_images={stale_imgs}")
      PY

  - name: Run lychee on slice
    env:
      LYCHEE_CONFIG: ${{ inputs.lychee-config }}
    run: |
      set -u

      if [ ! -s /tmp/gh-aw/sweep-data/in-scope.txt ]; then
        echo '{"failed_urls":[]}' > /tmp/gh-aw/sweep-data/lychee.json
        exit 0
      fi

      LYCHEE_VERSION="0.18.1"
      curl -sSL "https://github.com/lycheeverse/lychee/releases/download/lychee-v${LYCHEE_VERSION}/lychee-x86_64-unknown-linux-gnu.tar.gz" \
        -o /tmp/lychee.tar.gz
      tar -xz -C /tmp -f /tmp/lychee.tar.gz
      chmod +x /tmp/lychee

      LYCHEE_FLAGS=(
        --no-progress
        --format json
        --include-fragments
        --max-concurrency 8
        --timeout 20
        --max-retries 1
        --exclude '^https?://(localhost|127\.0\.0\.1|0\.0\.0\.0)'
        --exclude '^https?://[^/]*\.elastic\.co'
        --output /tmp/gh-aw/sweep-data/lychee.json
      )
      if [ -n "$LYCHEE_CONFIG" ] && [ -f "$LYCHEE_CONFIG" ]; then
        LYCHEE_FLAGS+=(--config "$LYCHEE_CONFIG")
      fi

      set +e
      xargs -a /tmp/gh-aw/sweep-data/in-scope.txt /tmp/lychee "${LYCHEE_FLAGS[@]}"
      RC=$?
      set -e

      if [ ! -f /tmp/gh-aw/sweep-data/lychee.json ]; then
        echo '{"failed_urls":[],"note":"lychee produced no output"}' > /tmp/gh-aw/sweep-data/lychee.json
      fi

      FAILED=$(jq '.fail_map // {} | to_entries | map(.value | length) | add // 0' /tmp/gh-aw/sweep-data/lychee.json 2>/dev/null || echo 0)
      echo "Lychee exit=$RC failed_urls=$FAILED"

  - name: Repo-specific setup
    if: ${{ inputs.setup-commands != '' }}
    env:
      SETUP_COMMANDS: ${{ inputs.setup-commands }}
    run: eval "$SETUP_COMMANDS"
---

# Docs staleness sweep agent

You are a staleness reviewer for an Elastic documentation repository. Your job is to flag pages, screenshots, external links, and version mentions that have likely gone out of date — and emit a single labeled fix-issue with structured findings.

The hard work has already been done by deterministic pre-steps; your role is filtering false positives, prioritizing, and adding the version-mention judgment via the Elastic Docs MCP server.

## Pre-fetched data

- `/tmp/gh-aw/sweep-data/in-scope.txt` — file paths to audit.
- `/tmp/gh-aw/sweep-data/scope/` — copies mirroring the original paths.
- `/tmp/gh-aw/sweep-data/stats.json` — corpus stats.
- `/tmp/gh-aw/sweep-data/staleness.json` — per-page git ages, image references, and `stale_content` / image-`stale` boolean flags. Contains a `thresholds` block describing the configured cutoffs.
- `/tmp/gh-aw/sweep-data/lychee.json` — lychee output (`fail_map` keyed by source file → list of broken URLs).

If `in_scope_count` is `0`, call `noop` with a path-aware or shard-aware message based on `selection_mode`, then stop.

## Step 1: Collect deterministic findings

From `staleness.json`:

- **`stale-content`** — every page where `stale_content` is `true`. `evidence` should cite the configured threshold (`thresholds.stale_content_months`) and the page's `age_months`.
- **`stale-screenshot`** — every image entry where `stale` is `true`. `evidence` cites the `gap_months`.

From `lychee.json`:

- **`broken-external-link`** — every entry in `fail_map`. `file` is the source markdown; `line` is the line number from lychee (if present); `evidence` is the URL plus the failure reason.

Group all of these into the findings list directly; no LLM judgment needed. Apply the Rigor standards — drop anything where the evidence isn't concrete (a missing `line`, an ambiguous file path, etc.) rather than guessing.

## Step 2: Add version-mention findings via MCP

For each in-scope page that has version-shaped tokens in its body (e.g., `8.x`, `7.17`, `9.0.0`, `Stack 7.x`), use the `elastic-docs` MCP server to determine whether the versions referenced are still supported:

- `search_docs(query: "supported versions Elastic Stack")` once per run to cache the current support matrix.
- For specific products (Kibana, Elasticsearch, Logstash, Beats, etc.), use `search_docs` with the product name to find its support page, then `get_document_by_url` to read the matrix.

Flag a finding only when:

- The version mentioned is below the published "supported" range (i.e., end-of-life), AND
- The page is not itself a release-notes / changelog / upgrade-from-old-version page (those legitimately reference EOL versions).

Category: `unsupported-version-mention`. `evidence` cites the version token and the support-matrix source.

Do not invent versions or speculate about the support matrix when the MCP server doesn't return a clean answer. Skip the finding instead.

## Step 3: Sort and cap

Sort findings by `severity` (`high` → `medium` → `low`), then by `category` (`broken-external-link` > `stale-content` > `unsupported-version-mention` > `stale-screenshot`), then by `file` ascending, then by `line` ascending.

**Do not cap deterministic categories** — `broken-external-link`, `stale-content`, and `stale-screenshot` are produced verbatim by lychee and the python pre-step. Emit all of them. The reader can scan many deterministic findings; throwing them away costs an audit cycle and gives no value (these are not LLM judgments that need triage).

**Cap only** the LLM-judgment category `unsupported-version-mention` at `${{ inputs.max-per-fix-issue }}` findings. Overflow surfaces in the next sweep.

**Hard upper bound for issue body length**: if the total findings list would exceed 400 rows (GitHub issue body limit ≈ 65,536 characters), cap at 400 and add a note `+M additional findings will surface in next sweep`. Apply this only if the deterministic-uncapped pass exceeds the bound.

If the combined output is empty, call `noop` and adapt the message to the selection mode:

- Shard mode without `target_path`: `"No staleness findings in this slice (shard <slot>/<n>, <in_scope_count> pages)"`.
- Shard mode with `target_path`: `"No staleness findings under /<target_path> in shard <slot>/<n> (<in_scope_count> pages)"`.
- Full mode with `target_path`: `"No staleness findings under /<target_path> (<in_scope_count> pages)"`.
- Full mode without `target_path`: `"No staleness findings in full sweep <docs_root> (<in_scope_count> pages)"`.

## Output: fix-issue body

Title body depends on the selection mode:

- Shard mode without `target_path`: `shard <slot+1>/<n> — <count> findings` (workflow prepends `Docs fix — staleness: `).
- Shard mode with `target_path`: `path /<target_path> — shard <slot+1>/<n> — <count> findings`.
- Full mode with `target_path`: `path /<target_path> — <count> findings`.
- Full mode without `target_path`: `full <docs_root> — <count> findings`.

```markdown
Generated by `gh-aw-docs-staleness-sweep` for `${{ inputs.source-repo || github.repository }}` on <iso_week>.

Use one of these scope-summary lines:

- Shard mode without `target_path`: `Shard <slot+1>/<n> · <shard_count> pages in slice · <recent_count> recently-changed · <in_scope_count> total in scope · corpus <total> pages.`
- Shard mode with `target_path`: `Path /<target_path> · shard <slot+1>/<n> · <shard_count> pages in slice · <recent_count> recently-changed · <in_scope_count> total in scope · subtree corpus <total> pages.`
- Full mode with `target_path`: `Path /<target_path> · <in_scope_count> total in scope · subtree corpus <total> pages.`
- Full mode without `target_path`: `Full sweep of <docs_root> · <in_scope_count> total in scope · corpus <total> pages.`
Thresholds: stale_content_months=<n>, stale_image_min_gap_months=<n>.

## Findings (<count>)

```yaml
- file: docs/foo.md
  line: 1
  category: stale-content
  severity: medium
  evidence: "last commit 2023-01-15 (38 months ago); threshold is 24 months"
  suggested_fix: |
    review and refresh; either update content or move to archive
- file: docs/bar.md
  line: 17
  category: stale-screenshot
  severity: low
  evidence: "image images/bar-ui.png last modified 12 months before page; gap exceeds 6-month threshold"
  suggested_fix: |
    re-capture screenshot reflecting the current UI
- file: docs/baz.md
  line: 42
  category: broken-external-link
  severity: high
  evidence: "https://example.com/old-spec returned 404 (lychee)"
  suggested_fix: |
    replace link or cite a current source
- file: docs/qux.md
  line: 9
  category: unsupported-version-mention
  severity: medium
  evidence: "references Elastic Stack 7.17 — past EOL per support matrix at https://www.elastic.co/support/eol"
  suggested_fix: |
    update to a currently-supported version or move guidance to upgrade docs
```

## Done when
- Stale content has been refreshed, archived, or annotated as historical.
- Stale screenshots are re-captured.
- Broken external links are replaced with current sources.
- Unsupported-version mentions are removed or moved to upgrade docs.
- A PR addressing this issue is merged.

## Notes
- <Optional 1-line about MCP availability or anything intentionally skipped>.

<!-- gh-aw-docs-staleness-sweep:run=<iso_week>:shard=<slot>/<n> -->
```

## What to skip

- Files outside `/tmp/gh-aw/sweep-data/in-scope.txt`.
- Internal (relative) link failures — those are docs-build's responsibility, not this sweep's.
- Internal Elastic domain URLs — they were excluded from lychee deliberately; if you spot one in the input, do not fabricate a finding for it.
- Release-notes / upgrade / changelog pages when flagging unsupported versions: those legitimately reference EOL versions.
- Stale-screenshot findings for diagrams or non-UI illustrations where age doesn't imply staleness.

${{ inputs.additional-instructions }}
