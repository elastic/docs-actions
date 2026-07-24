# Docs typos sweep

Runs `codespell` against the entire docs corpus, or one selected subtree, and turns the deterministic misspelling list into a structured fix-issue. No LLM is used for detection; the agent only filters false positives, picks among ambiguous corrections, and formats the output.

By default this sweep scans the full matched scope because codespell is fast and cheap, but it can also shard within that scope when `scope-mode=shard`.

## Triggers

| Event | Description |
|-------|-------------|
| `workflow_dispatch` | Manual trigger |

## Install

```bash
mkdir -p .github/workflows && curl -sL \
  https://raw.githubusercontent.com/elastic/docs-actions/v1/agentic-workflows/docs-typos-sweep/example.yml \
  -o .github/workflows/docs-typos-sweep.yml
```

Pass `DOCS_LITELLM_API_KEY` via a repository or organization secret. The caller job must forward it:

```yaml
    secrets:
      DOCS_LITELLM_API_KEY: ${{ secrets.DOCS_LITELLM_API_KEY }}
```

## Inputs

| Input | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `docs-root` | string | No | `docs/` | Root directory to scan. |
| `target-path` | string | No | `""` | Optional `docs-root`-relative directory to scan recursively. Accepts a leading slash, such as `/solutions/observability`. |
| `scope-mode` | string | No | `auto` | Scope behavior for the matched markdown files. `auto` preserves the existing behavior, `full` scans all matched files, and `shard` shards within the matched set. |
| `target-batch-size` | string | No | `100` | Approximate pages per rotating slice when `scope-mode=shard`. |
| `max-per-fix-issue` | string | No | `50` | Cap on findings per fix-issue. |
| `codespell-args` | string | No | `""` | Extra flags passed verbatim to codespell — useful for project allowlists (`--ignore-words=allowlist.txt`) or skip patterns (`--skip='*.svg'`). |
| `additional-instructions` | string | No | `""` | Repo-specific guidance. |
| `setup-commands` | string | No | `""` | Pre-agent shell commands. |

## Safe outputs

| Output | Max | Labels |
|--------|-----|--------|
| `noop` | — | — |
| `create-issue` | 1 | `docs-quality-sweep`, `docs-fix:typos` |

## How it works

1. Pre-step installs `codespell`, enumerates `*.md` under the matched scope (`docs-root`, optionally narrowed by `target-path`), and either scans them all or scans one rotating shard based on `scope-mode`, capturing output to `/tmp/gh-aw/sweep-data/codespell.out`.
2. The agent reads the output, drops false positives (proper nouns, code identifiers, terms inside fenced code blocks), picks the most likely correction when codespell offers multiple, and emits structured YAML findings.
3. Categories: `typo` (single confident correction), `ambiguous-typo` (multiple possible corrections — `suggested_fix` omitted).

## Configuring an allowlist

Add a `codespell-allowlist.txt` to your repo with one term per line, then pass:

```yaml
with:
  codespell-args: "--ignore-words=codespell-allowlist.txt"
```

## Combining with other sweeps

Use the [docs-quality-sweep orchestrator](../docs-quality-sweep/) to fan out this alongside the other sweeps.
