# Docs staleness sweep

Audits docs on a rotating slice each run for four kinds of staleness:

1. **Stale content** — pages whose latest commit is older than `stale-content-months` (default 24).
2. **Stale screenshots** — image references where the image's last commit predates the doc's by at least `stale-screenshot-min-gap-months` (default 6).
3. **Broken external links** — non-Elastic external URLs that fail HTTP via `lychee`.
4. **Unsupported version mentions** — references to product versions past EOL, identified via the Elastic Docs MCP server.

Opens a single labeled fix-issue with structured YAML findings.

## Triggers

| Event | Description |
|-------|-------------|
| `workflow_dispatch` | Manual trigger |

## Install

```bash
mkdir -p .github/workflows && curl -sL \
  https://raw.githubusercontent.com/elastic/docs-actions/v1/agentic-workflows/docs-staleness-sweep/example.yml \
  -o .github/workflows/docs-staleness-sweep.yml
```

Configure both secrets:

- `COPILOT_GITHUB_TOKEN` — Copilot agent token.
- `DOCS_FIX_ISSUES_TOKEN` — token with `issues:write` on `elastic/docs-content-internal` (where fix-issues are filed). See the parent README for context.

## Inputs

| Input | Default | Description |
|-------|---------|-------------|
| `docs-root` | `docs/` | Root directory to sweep. |
| `target-batch-size` | `100` | Approximate pages per slice. |
| `max-per-fix-issue` | `30` | Findings cap per fix-issue. |
| `stale-content-months` | `24` | Flag pages whose latest commit is older than this. |
| `stale-screenshot-min-gap-months` | `6` | Minimum gap between image and doc commit dates to count as stale. |
| `lychee-config` | `""` | Optional path to a lychee config file in your repo (e.g., `.lychee.toml`). |
| `additional-instructions` | `""` | Repo-specific guidance. |
| `setup-commands` | `""` | Pre-agent shell commands. |

## Safe outputs

| Output | Max | Labels |
|--------|-----|--------|
| `noop` | — | — |
| `create-issue` | 1 | `docs-quality-sweep`, `docs-fix:staleness` (filed in `elastic/docs-content-internal`) |

## How it works

1. **Pre-step 1** — compute the rotating slice (same logic as other sweeps) plus pages modified in the last 7 days.
2. **Pre-step 2** — for each in-scope page: get last-commit date, extract image references, compute commit ages for each image. Write to `staleness.json`.
3. **Pre-step 3** — install lychee and run it on the slice; output to `lychee.json`. Internal Elastic domains are excluded by default.
4. **Agent** — assembles findings from the deterministic outputs and adds version-mention findings using the `elastic-docs` MCP server (`search_docs`, `get_document_by_url`) to determine the current support matrix.

## Categories

- `stale-content` — page age exceeds threshold.
- `stale-screenshot` — image is older than the doc by the configured gap.
- `broken-external-link` — lychee reported a non-OK status.
- `unsupported-version-mention` — references a version past EOL per the published support matrix.

## Combining with other sweeps

Use the [docs-quality-sweep orchestrator](../docs-quality-sweep/) to fan out alongside the other sweeps.
