# Docs coherence sweep

Compares each in-scope page against published Elastic docs (via the Elastic Docs MCP server) and flags two things that hurt search and AI-assistant quality:

- **Duplicate or near-duplicate content** — the same explanation living in multiple places.
- **Contradictions** — different pages giving different answers to the same question.

The sweep runs on a rotating slice each run, or across every markdown file under a selected subtree. The default `target-batch-size` is smaller (`50`) than other sweeps because each in-scope page produces multiple MCP calls and LLM comparisons.

## Triggers

| Event | Description |
|-------|-------------|
| `workflow_dispatch` | Manual trigger |

## Install

```bash
mkdir -p .github/workflows && curl -sL \
  https://raw.githubusercontent.com/elastic/docs-actions/v1/agentic-workflows/docs-coherence-sweep/example.yml \
  -o .github/workflows/docs-coherence-sweep.yml
```

Configure both secrets:

- `permissions.copilot-requests: write` in the caller workflow — required for built-in Copilot auth. You do not need to pass `COPILOT_GITHUB_TOKEN` for the default path.
- `DOCS_FIX_ISSUES_TOKEN` — token with `issues:write` on `elastic/docs-content-internal`.

## Inputs

| Input | Default | Description |
|-------|---------|-------------|
| `docs-root` | `docs/` | Root directory to sweep. |
| `target-path` | `""` | Optional `docs-root`-relative directory to sweep recursively. Accepts a leading slash, such as `/solutions/observability`. |
| `scope-mode` | `auto` | Scope behavior for the matched markdown files. `auto` preserves the existing behavior, `full` scans all matched files, and `shard` shards within the matched set. |
| `target-batch-size` | `50` | Pages per slice. Smaller than other sweeps because each comparison is expensive. |
| `max-per-fix-issue` | `20` | Findings cap per fix-issue. |
| `max-related-per-page` | `3` | Cap on related-doc comparisons per in-scope page. |
| `additional-instructions` | `""` | Repo-specific guidance. |
| `setup-commands` | `""` | Pre-agent shell commands. |

## Safe outputs

| Output | Max | Labels |
|--------|-----|--------|
| `noop` | — | — |
| `create-issue` | 1 | `docs-quality-sweep`, `docs-fix:coherence` (filed in `elastic/docs-content-internal`) |

## How it works

1. Pre-step enumerates `*.md` under the matched scope (`docs-root`, optionally narrowed by `target-path`), then either scans them all or computes the rotating slice plus recently-changed pages based on `scope-mode`.
2. The agent processes each in-scope page:
   - Builds a focused query from the page's H1 and opening paragraphs.
   - Calls `elastic-docs.find_related_docs` (or `search_docs`) to find related published Elastic docs.
   - Fetches the top `max-related-per-page` results via `get_document_by_url`.
   - Classifies each comparison: `duplicate-content`, `near-duplicate`, `contradictory-content`, or `coherent` (no finding).
3. Findings are emitted with `file`, `line`, `category`, `severity`, `evidence`, `related_url`, and `suggested_fix`.

## Cost notes

Coherence is the most expensive sweep in the family — every in-scope page generates multiple MCP fetches and several LLM comparisons. Tune `target-batch-size` and `max-related-per-page` down before scheduling, then up only if the run completes well within the 45-minute timeout.

If the MCP server is unreachable for more than half the run, the agent calls `noop` rather than emit unreliable findings.

## Combining with other sweeps

Use the [docs-quality-sweep orchestrator](../docs-quality-sweep/) to fan out alongside the other sweeps. Be aware that running coherence in parallel with the other six sweeps consumes more LLM budget than any other single sweep.
