# Agentic Workflows

AI-powered workflows for Elastic documentation tasks. Each directory contains a workflow source (`.md`), a trigger template (`example.yml`), and usage docs (`README.md`).

| Workflow | Description | Trigger | Safe Output |
|----------|-------------|---------|-------------|
| [docs-review](docs-review/) | Review changed markdown files under `docs/` in pull requests | `/docs-review`, PR checkbox menu | `create-pull-request-review-comment`, `submit-pull-request-review` |
| [docs-issue-scope](docs-issue-scope/) | Scope docs work from an issue plus linked PRs or commits | `/docs-issue-scope` | `add-comment`, `update-issue` |
| [issue-triage](issue-triage/) | Triage issues by applying team labels | `/docs-triage`, dispatch | `add-labels`, `remove-labels` |
| [docs-frontmatter-sweep](docs-frontmatter-sweep/) | Audit frontmatter (required fields + description quality) on a rotating slice | `workflow_dispatch` | `create-issue` (label `docs-fix:frontmatter`) |

## Installation

Copy a workflow's `example.yml` into your repository's `.github/workflows/` directory:

```bash
mkdir -p .github/workflows && curl -sL \
  https://raw.githubusercontent.com/elastic/docs-actions/v1/agentic-workflows/docs-issue-scope/example.yml \
  -o .github/workflows/docs-issue-scope.yml
```

These workflows use `COPILOT_GITHUB_TOKEN`.
