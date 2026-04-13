# Docs Issue Scope

Analyzes a public PR or commit to determine whether Elastic documentation needs updating. Posts a structured comment with findings, affected pages, and specific recommendations.

## Triggers

| Event | Description |
|-------|-------------|
| `/docs-issue-scope <url>` | Slash command on an issue or PR |
| `workflow_dispatch` | Manual trigger |

## Install

```bash
mkdir -p .github/workflows && curl -sL \
  https://raw.githubusercontent.com/elastic/docs-actions/v1/agentic-workflows/docs-issue-scope/example.yml \
  -o .github/workflows/docs-issue-scope.yml
```

Ensure the `COPILOT_GITHUB_TOKEN` secret is configured in your repository.

## Inputs

| Input | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `additional-instructions` | string | No | `""` | Repo-specific instructions appended to the agent prompt |
| `setup-commands` | string | No | `""` | Shell commands to run before the agent starts |
| `messages-footer` | string | No | _(default footer)_ | Footer appended to all agent comments |

## Safe Outputs

| Output | Max | Description |
|--------|-----|-------------|
| `noop` | — | No documentation impact detected |
| `add-comment` | 1 | Structured documentation impact analysis |

## Example

```yaml
name: Docs Issue Scope
on:
  issue_comment:
    types: [created]
  workflow_dispatch:

permissions:
  actions: read
  contents: read
  discussions: write
  issues: write
  pull-requests: write

jobs:
  run:
    if: >-
      github.event_name == 'workflow_dispatch' ||
      startsWith(github.event.comment.body, '/docs-issue-scope')
    uses: elastic/docs-actions/.github/workflows/gh-aw-docs-issue-scope.lock.yml@v1
    with:
      additional-instructions: |
        This repo is the Elasticsearch Java client.
        Focus on REST API changes and client method signatures.
    secrets:
      COPILOT_GITHUB_TOKEN: ${{ secrets.COPILOT_GITHUB_TOKEN }}
```
