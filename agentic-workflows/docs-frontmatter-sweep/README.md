# Docs frontmatter sweep

Audits frontmatter across a docs corpus on a rotating slice each run, combining the `docs-frontmatter-audit` skill (required-field validation) with `docs-frontmatter-description` (description quality + SEO suggestions). Opens a single labeled fix-issue with structured YAML findings consumable by a future fix-agent.

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

Ensure the `COPILOT_GITHUB_TOKEN` secret is configured in your repository.

Issues are filed in the **calling repo** (where the workflow runs). Install this in the repo where you want fix-issues to land — typically `elastic/docs-content-internal` if the docs being scanned are in `elastic/docs-content`. The example template ships with `source-repo: elastic/docs-content`.

## Inputs

| Input | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `source-repo` | string | No | `""` (calling repo) | Repository to scan, as `owner/repo`. Set this when the workflow runs in a triage repo (e.g., `docs-content-internal`) but should audit a separate docs repo (e.g., `docs-content`). The example template defaults to `elastic/docs-content`. |
| `docs-root` | string | No | `docs/` | Root directory to sweep within the source repo. Set to `.` for repos where docs live at the repo root. |
| `target-batch-size` | string | No | `100` | Approximate pages per slice; controls shard count `N = ceil(total/batch-size)`. |
| `max-per-fix-issue` | string | No | `20` | Cap on findings per fix-issue. Overflow surfaces in the next sweep. |
| `additional-instructions` | string | No | `""` | Repo-specific guidance appended to the agent prompt. |
| `setup-commands` | string | No | `""` | Shell commands to run before the agent starts. |

## Safe outputs

| Output | Max | Labels | Description |
|--------|-----|--------|-------------|
| `noop` | — | — | No high-confidence findings in this slice. |
| `create-issue` | 1 | `docs-quality-sweep`, `docs-fix:frontmatter` | Fix-issue with structured YAML findings. Closes prior issues from the same workflow. |

## How it works

1. A pre-step enumerates `*.md` under `docs-root`, computes a deterministic shard `(hash(path) mod N == iso_week mod N)`, and unions in any files modified in the last 7 days.
2. In-scope files are copied to `/tmp/gh-aw/sweep-data/scope/` (mirroring their original paths) so the skills can operate on the slice without affecting the repo.
3. The agent invokes `docs-frontmatter-audit` and `docs-frontmatter-description` against the slice in audit/suggest mode.
4. Findings are emitted as a YAML block in the fix-issue body, capped at `max-per-fix-issue`.
5. If nothing high-confidence surfaces, the agent calls `noop` instead of opening an issue.

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

Categories: `missing-description`, `weak-description`, `description-too-long`, `missing-applies-to`, `invalid-applies-to`, `missing-products`, `missing-navigation-title`.

## Combining with other sweeps

To run all sweeps from a single dispatch, use the [docs-quality-sweep orchestrator](../docs-quality-sweep/) instead of installing each sweep individually.
