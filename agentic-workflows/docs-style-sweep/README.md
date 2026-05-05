# Docs style sweep

Audits style-guide compliance across a docs corpus on a rotating slice each run, using the `docs-check-style` skill (Vale + Elastic style guide). Opens a single labeled fix-issue with structured findings.

## Triggers

| Event | Description |
|-------|-------------|
| `workflow_dispatch` | Manual trigger |

## Install

```bash
mkdir -p .github/workflows && curl -sL \
  https://raw.githubusercontent.com/elastic/docs-actions/v1/agentic-workflows/docs-style-sweep/example.yml \
  -o .github/workflows/docs-style-sweep.yml
```

Ensure `COPILOT_GITHUB_TOKEN` is configured.

## Inputs

| Input | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `docs-root` | string | No | `docs/` | Root directory to sweep. |
| `target-batch-size` | string | No | `100` | Pages per slice. |
| `max-per-fix-issue` | string | No | `20` | Findings cap per fix-issue. |
| `additional-instructions` | string | No | `""` | Repo-specific guidance for the agent prompt. |
| `setup-commands` | string | No | `""` | Pre-agent shell commands. |

## Safe outputs

| Output | Max | Labels |
|--------|-----|--------|
| `noop` | — | — |
| `create-issue` | 1 | `docs-quality-sweep`, `docs-fix:style` |

## How it works

1. Pre-step computes the rotating slice plus recently-changed pages.
2. The agent invokes `docs-check-style` against the slice and groups findings by category: `voice-tone`, `word-choice`, `grammar`, `formatting`, `accessibility`, `ui-writing`.
3. Single-word misspellings are deliberately excluded — those are handled by [`docs-typos-sweep`](../docs-typos-sweep/).

## Combining with other sweeps

Use the [docs-quality-sweep orchestrator](../docs-quality-sweep/) to fan out this alongside the other sweeps.
