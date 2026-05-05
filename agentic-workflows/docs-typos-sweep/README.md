# Docs typos sweep

Runs `codespell` against the entire docs corpus and turns the deterministic misspelling list into a structured fix-issue. No LLM is used for detection; the agent only filters false positives, picks among ambiguous corrections, and formats the output.

Full-repo scan — no rotation — because codespell is fast and cheap.

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

Ensure `COPILOT_GITHUB_TOKEN` is configured.

## Inputs

| Input | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `docs-root` | string | No | `docs/` | Root directory to scan. |
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

1. Pre-step installs `codespell` and runs it against `docs-root`, capturing output to `/tmp/gh-aw/sweep-data/codespell.out`.
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
