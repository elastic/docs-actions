# Docs page openings sweep

Audits page openings — H1 specificity, opening paragraph, "Before you begin" section, `navigation_title` — across a docs corpus on a rotating slice each run, or across every markdown file under a selected subtree, using self-contained rules and targeted Elastic docs MCP checks.

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

Pass `LITELLM_API_KEY` via a repository or organization secret. The caller job must forward it:

```yaml
    secrets:
      LITELLM_API_KEY: ${{ secrets.LITELLM_API_KEY }}
```

## Inputs

| Input | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `docs-root` | string | No | `docs/` | Root directory to sweep. |
| `target-path` | string | No | `""` | Optional `docs-root`-relative directory to sweep recursively. Accepts a leading slash, such as `/solutions/observability`. |
| `scope-mode` | string | No | `auto` | Scope behavior for the matched markdown files. `auto` preserves the existing behavior, `full` scans all matched files, and `shard` shards within the matched set. |
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

1. Pre-step enumerates `*.md` under the matched scope (`docs-root`, optionally narrowed by `target-path`), then either scans them all or computes the rotating slice plus recently-changed pages based on `scope-mode`.
2. The agent reads the copied slice and applies embedded checks for content type, H1 specificity, opening paragraph quality, task prerequisites, substitutions, UI/technical formatting in openings, and navigation titles.
3. Categories: `missing-h1`, `vague-h1`, `missing-h1-anchor`, `weak-opening`, `missing-before-you-begin`, `inadequate-navigation-title`.
4. The agent may use Elastic docs MCP to compare sibling page titles when H1 specificity needs published-doc context.
5. The workflow does not edit files or push changes — only the structured findings are emitted in the fix-issue.

## Imported skills

This workflow installs these APM skills from `elastic/elastic-docs-skills`:

- `docs-page-opening-optimizer`.
- `docs-frontmatter-description`.
- `docs-content-type-checker`.
- `docs-check-style`.

The workflow uses them as additive guidance for H1 quality, opening-paragraph scope, content-type-specific expectations, and opening-specific style issues.

## Notes

This sweep covers vague H1s, so there is no separate H1 sweep.

## Combining with other sweeps

Use the [docs-quality-sweep orchestrator](../docs-quality-sweep/) to fan out this alongside the other sweeps.
