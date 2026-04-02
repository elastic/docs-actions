# Agentic Workflows

AI-powered workflows for Elastic documentation tasks. Each directory contains a workflow source (`.md`), a trigger template (`example.yml`), and usage docs (`README.md`).

| Workflow | Description | Trigger | Safe Output |
|----------|-------------|---------|-------------|
| [docs-check](docs-check/) | Analyze a PR or commit for documentation impact | `/docs-check`, label, dispatch | `add-comment` |
| [issue-triage](issue-triage/) | Triage issues by applying team labels | `/triage`, dispatch | `add-labels` |

## Installation

Copy a workflow's `example.yml` into your repository's `.github/workflows/` directory:

```bash
mkdir -p .github/workflows && curl -sL \
  https://raw.githubusercontent.com/elastic/docs-actions/v1/agentic-workflows/docs-check/example.yml \
  -o .github/workflows/docs-check.yml
```

All workflows require the `COPILOT_GITHUB_TOKEN` secret.
