# Agentic Workflows

AI-powered workflows for Elastic documentation tasks. Each directory contains a workflow source (`.md`), a trigger template (`example.yml`), and usage docs (`README.md`).

| Workflow | Description | Trigger | Safe Output |
|----------|-------------|---------|-------------|
| [docs-review](docs-review/) | Review changed markdown files under `docs/` in pull requests | `/docs-review`, PR checkbox menu | `create-pull-request-review-comment`, `submit-pull-request-review` |
| [docs-issue-scope](docs-issue-scope/) | Scope docs work from an issue plus linked PRs or commits | `/docs-issue-scope` | `add-comment`, `update-issue` |
| [issue-triage](issue-triage/) | Triage issues by applying team labels | `/docs-triage`, dispatch | `add-labels`, `remove-labels` |
| [docs-quality-sweep](docs-quality-sweep/) | Orchestrator that fans out to all five quality sweeps in parallel | `workflow_dispatch` | (per sub-workflow) |
| [docs-frontmatter-sweep](docs-frontmatter-sweep/) | Audit frontmatter (required fields + description quality) on a rotating slice | `workflow_dispatch` | `create-issue` (label `docs-fix:frontmatter`) |
| [docs-applies-to-sweep](docs-applies-to-sweep/) | Validate `applies_to` keys on a rotating slice | `workflow_dispatch` | `create-issue` (label `docs-fix:applies-to`) |
| [docs-openings-sweep](docs-openings-sweep/) | Audit page openings (H1, opening paragraph, prerequisites) on a rotating slice | `workflow_dispatch` | `create-issue` (label `docs-fix:openings`) |
| [docs-style-sweep](docs-style-sweep/) | Audit style-guide compliance on a rotating slice (Vale + Elastic style) | `workflow_dispatch` | `create-issue` (label `docs-fix:style`) |
| [docs-typos-sweep](docs-typos-sweep/) | Run codespell across the whole docs corpus and emit a structured fix-issue | `workflow_dispatch` | `create-issue` (label `docs-fix:typos`) |
| [docs-staleness-sweep](docs-staleness-sweep/) | Flag stale content, stale screenshots, broken external links, and unsupported-version mentions on a rotating slice | `workflow_dispatch` | `create-issue` (label `docs-fix:staleness`) |
| [docs-coherence-sweep](docs-coherence-sweep/) | Detect duplicates and contradictions vs. published Elastic docs via MCP on a rotating slice | `workflow_dispatch` | `create-issue` (label `docs-fix:coherence`) |

## Installation

Copy a workflow's `example.yml` into your repository's `.github/workflows/` directory:

```bash
mkdir -p .github/workflows && curl -sL \
  https://raw.githubusercontent.com/elastic/docs-actions/v1/agentic-workflows/docs-issue-scope/example.yml \
  -o .github/workflows/docs-issue-scope.yml
```

These workflows use `COPILOT_GITHUB_TOKEN`.
