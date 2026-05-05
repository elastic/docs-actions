# Docs page openings sweep

Audits page openings — H1 specificity, opening paragraph, "Before you begin" section, `navigation_title` — across a docs corpus on a rotating slice each run, using self-contained rules and targeted Elastic docs MCP checks.

## Triggers

| Event | Description |
|-------|-------------|
| `workflow_dispatch` | Manual trigger |

## Install

```bash
mkdir -p .github/workflows && curl -sL \
  https://raw.githubusercontent.com/elastic/docs-actions/v1/agentic-workflows/docs-openings-sweep/example.yml \
  -o .github/workflows/docs-openings-sweep.yml
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
| `create-issue` | 1 | `docs-quality-sweep`, `docs-fix:openings` |

## How it works

1. Pre-step computes the rotating slice plus recently-changed pages.
2. The agent reads the copied slice and applies embedded checks for H1 specificity, opening paragraph quality, task prerequisites, and navigation titles.
3. Categories: `missing-h1`, `vague-h1`, `missing-h1-anchor`, `weak-opening`, `missing-before-you-begin`, `inadequate-navigation-title`.
4. The agent may use Elastic docs MCP to compare sibling page titles when H1 specificity needs published-doc context.
5. The workflow does not edit files or push changes — only the structured findings are emitted in the fix-issue.

## Notes

This sweep covers vague H1s, so there is no separate H1 sweep.

## Combining with other sweeps

Use the [docs-quality-sweep orchestrator](../docs-quality-sweep/) to fan out this alongside the other sweeps.
