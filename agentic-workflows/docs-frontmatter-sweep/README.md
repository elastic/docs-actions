# Docs frontmatter sweep

Audits frontmatter across a docs corpus on a rotating slice each run, or across every markdown file under a selected subtree, using self-contained required-field and description-quality rules. Opens a single labeled fix-issue with structured YAML findings consumable by a future fix-agent.

## Triggers

| Event | Description |
|-------|-------------|
| `workflow_dispatch` | Manual trigger; choose `docs-root`, batch size, and per-issue cap |

## Install

```bash
mkdir -p .github/workflows && curl -sL \
  https://raw.githubusercontent.com/elastic/docs-actions/v1/agentic-workflows/docs-frontmatter-sweep/example.yml \
  -o .github/workflows/docs-frontmatter-sweep.yml
```

Add `permissions.copilot-requests: write` to the caller workflow. You do not need to pass `COPILOT_GITHUB_TOKEN` for the default built-in auth path.

Issues are filed in the **calling repo** (where the workflow runs). Install this in the repo where you want fix-issues to land — typically `elastic/docs-content-internal` if the docs being scanned are in `elastic/docs-content`. The example template ships with `source-repo: elastic/docs-content`.

## Inputs

| Input | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `source-repo` | string | No | `""` (calling repo) | Repository to scan, as `owner/repo`. Set this when the workflow runs in a triage repo (e.g., `docs-content-internal`) but should audit a separate docs repo (e.g., `docs-content`). The example template defaults to `elastic/docs-content`. |
| `docs-root` | string | No | `docs/` | Root directory to sweep within the source repo. Set to `.` for repos where docs live at the repo root. |
| `target-path` | string | No | `""` | Optional `docs-root`-relative directory to sweep recursively. Accepts a leading slash, such as `/solutions/observability`. |
| `scope-mode` | string | No | `auto` | Scope behavior for the matched markdown files. `auto` preserves the existing behavior, `full` scans all matched files, and `shard` shards within the matched set. |
| `target-batch-size` | string | No | `100` | Approximate pages per slice; controls shard count `N = ceil(total/batch-size)`. |
| `max-per-fix-issue` | string | No | `20` | Cap on findings per fix-issue. Overflow surfaces in the next sweep. |
| `additional-instructions` | string | No | `""` | Repo-specific guidance appended to the agent prompt. |
| `setup-commands` | string | No | `""` | Shell commands to run before the agent starts. |

## Safe outputs

| Output | Max | Labels | Description |
|--------|-----|--------|-------------|
| `noop` | — | — | No high-confidence findings in this slice. |
| `create-issue` | 1 | `docs-quality-sweep`, `docs-fix:frontmatter` | Fix-issue with structured YAML findings. |

## How it works

1. A pre-step enumerates `*.md` under the matched scope (`docs-root`, optionally narrowed by `target-path`), then either scans them all or computes a deterministic shard `(hash(path) mod N == iso_week mod N)` based on `scope-mode`.
2. In-scope files are copied to `/tmp/gh-aw/sweep-data/scope/` (mirroring their original paths) so the agent can audit the slice without affecting the repo.
3. The agent applies embedded checks for required frontmatter keys, complete and unique `description` values, canonical `products` shape, preserved `mapped_pages`, and concise `navigation_title` values.
4. Findings are emitted as a YAML block in the fix-issue body, capped at `max-per-fix-issue`.
5. If nothing high-confidence surfaces, the agent calls `noop` instead of opening an issue.

## Imported skills

This workflow installs these APM skills from `elastic/elastic-docs-skills`:

- `docs-frontmatter-audit`.
- `docs-frontmatter-description`.

The workflow uses them as additive guidance for metadata-shape checks and description-quality judgments. Local repository evidence and the embedded rules remain the source of truth.

## Fix-issue body

The issue body contains a fenced YAML block with one entry per finding:

```yaml
- file: docs/foo.md
  line: 1
  category: missing-description
  severity: high
  evidence: "frontmatter has no `description` field"
  suggested_fix: |
    description: "How to configure X for Y use cases."
```

Categories: `missing-description`, `weak-description`, `description-too-long`, `missing-products`, `missing-navigation-title`.

The workflow may use Elastic docs MCP for targeted published authoring guidance, but it does not use MCP as a blanket replacement for local frontmatter evidence.

## Combining with other sweeps

To run all sweeps from a single dispatch, use the [docs-quality-sweep orchestrator](../docs-quality-sweep/) instead of installing each sweep individually.
