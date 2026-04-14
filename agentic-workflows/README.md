# Agentic Workflows

AI-powered workflows for Elastic documentation tasks. Each directory contains a workflow source (`.md`), a trigger template (`example.yml`), and usage docs (`README.md`).

| Workflow | Description | Trigger | Safe Output |
|----------|-------------|---------|-------------|
| [docs-issue-scope](docs-issue-scope/) | Analyze a PR or commit for documentation impact | `/docs-issue-scope`, dispatch | `add-comment` |
| [issue-triage](issue-triage/) | Triage issues by applying team labels | `/docs-triage`, dispatch | `add-labels`, `remove-labels` |
| [alerting-v2-digest](alerting-v2-digest/) | Weekday Slack digest of merged Kibana alerting PRs | `schedule`, dispatch | `noop`, `slack-digest-post` |

## Installation

Copy a workflow's `example.yml` into your repository's `.github/workflows/` directory:

```bash
mkdir -p .github/workflows && curl -sL \
  https://raw.githubusercontent.com/elastic/docs-actions/v1/agentic-workflows/docs-issue-scope/example.yml \
  -o .github/workflows/docs-issue-scope.yml
```

All workflows require the `COPILOT_GITHUB_TOKEN` secret.
