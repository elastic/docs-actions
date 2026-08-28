# Docs applies_to sweep

Validates the `applies_to` frontmatter key across a docs corpus on a rotating slice each run, or across every markdown file under a selected subtree, using self-contained validation rules and the Elastic docs MCP server for published cumulative-docs guidance. Opens a single labeled fix-issue with structured YAML findings.

## Triggers

| Event | Description |
|-------|-------------|
| `workflow_dispatch` | Manual trigger |

## Install

```bash
mkdir -p .github/workflows && curl -sL \
  https://raw.githubusercontent.com/elastic/docs-actions/v1/agentic-workflows/docs-applies-to-sweep/example.yml \
  -o .github/workflows/docs-applies-to-sweep.yml
```

Add `copilot-requests: write` to the caller job `permissions:` block — no secret passthrough needed.

## Inputs

| Input | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `docs-root` | string | No | `docs/` | Root directory to sweep. |
| `target-path` | string | No | `""` | Optional `docs-root`-relative directory to sweep recursively. Accepts a leading slash, such as `/solutions/observability`. |
| `target-files` | string | No | `""` | Newline- or comma-separated list of `docs-root`-relative file paths to sweep. When set, overrides `target-path` and `scope-mode` — the sweep processes exactly these files. |
| `scope-mode` | string | No | `auto` | Scope behavior for the matched markdown files. `auto` preserves the existing behavior, `full` scans all matched files, and `shard` shards within the matched set. |
| `target-batch-size` | string | No | `100` | Pages per slice; controls shard count `N`. |
| `max-per-fix-issue` | string | No | `20` | Findings cap per fix-issue. |
| `additional-instructions` | string | No | `""` | Repo-specific guidance for the agent prompt. |
| `setup-commands` | string | No | `""` | Pre-agent shell commands. |

## Safe outputs

| Output | Max | Labels |
|--------|-----|--------|
| `noop` | — | — |
| `create-issue` | 1 | `docs-quality-sweep`, `docs-fix:applies-to` |

When any finding in the issue is `medium`- or `low`-confidence, the sweep also adds a `needs-human-review` label and a review-before-acting callout above the findings. Issues where every finding is `high`-confidence carry no such label and are safe to delegate to a fix-agent.

Each finding carries a `confidence` field (`high`/`medium`/`low`) that signals how safe it is to act on without human verification — a separate axis from `severity`.

## How it works

1. Pre-step enumerates `*.md` under the matched scope (`docs-root`, optionally narrowed by `target-path`), then either scans them all or computes the rotating slice (`hash(path) mod N == iso_week mod N`) plus pages modified in the last 7 days based on `scope-mode`.
2. Slice files are copied to `/tmp/gh-aw/sweep-data/scope/`.
3. The agent verifies `applies_to` rules against a local schema when present, or against published cumulative-docs guidance fetched through Elastic docs MCP.
4. Categories: `missing-applies-to`, `invalid-applies-to-syntax`, `invalid-applies-to-value`, `inconsistent-applies-to`, `outdated-applies-to`.
5. The embedded checks cover page-level dimensions, lifecycle and version syntax, deprecated deployment keys, section and inline annotation placement, badge placement, and when not to tag.
6. If the agent cannot verify allowed values from a local schema or MCP, it calls `noop` instead of filing unverified findings.

## Imported skills

This workflow installs the `docs-applies-to-tagging` APM skill from `elastic/elastic-docs-skills`.

The workflow uses it as additive guidance for lifecycle, deployment, product, and version applicability judgments. Verified local or published reference material remains the source of truth.

## Combining with other sweeps

Use the [docs-quality-sweep orchestrator](../docs-quality-sweep/) to run this alongside the other sweeps from a single dispatch.
