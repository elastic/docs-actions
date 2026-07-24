# Docs style sweep

Audits style-guide compliance across a docs corpus on a rotating slice each run, or across every markdown file under a selected subtree. A deterministic pre-step runs Vale with `elastic/vale-rules`, and the agent formats the resulting findings into a single labeled fix-issue. The agent may also add high-confidence manual findings for style-guide areas Vale does not fully cover, such as Formatting and UI writing.

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

Use `secrets: inherit` on the caller job to forward the `DOCS_LITELLM_API_KEY` org secret:

```yaml
    secrets: inherit
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
| `create-issue` | 1 | `docs-quality-sweep`, `docs-fix:style` |

## How it works

1. Pre-step enumerates `*.md` under the matched scope (`docs-root`, optionally narrowed by `target-path`), then either scans them all or computes the rotating slice plus recently-changed pages based on `scope-mode`.
2. A pre-step runs Vale against the copied slice.
3. The agent reads Vale's JSON output, optionally fetches published style-guide pages through Elastic docs MCP for manual checks, and groups findings by category: `voice-tone`, `word-choice`, `grammar`, `formatting`, `accessibility`, `ui-writing`.
4. Single-word misspellings are deliberately excluded — those are handled by [`docs-typos-sweep`](../docs-typos-sweep/).

## Imported skills

This workflow installs these APM skills from `elastic/elastic-docs-skills`:

- `docs-check-style`.
- `docs-flag-jargon-skill`.

The workflow uses them as additive guidance for style, wording, accessibility, UI-writing, and jargon judgments that go beyond Vale's deterministic output.

## Combining with other sweeps

Use the [docs-quality-sweep orchestrator](../docs-quality-sweep/) to fan out this alongside the other sweeps.
