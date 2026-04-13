# Docs Issue Scope

Uses an issue description plus linked public PRs and commits to scope Elastic documentation work. Posts a concise comment with recommended doc targets and specific next steps, or asks for more information if the issue does not provide enough signal.

## Triggers

| Event | Description |
|-------|-------------|
| `/docs-issue-scope [url ...] [context]` | Slash command on an issue or PR |

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
| `add-comment` | 1 | Concise scope analysis or request for more information |

## Example

```yaml
name: Docs Issue Scope
on:
  issue_comment:
    types: [created]

permissions:
  actions: read
  contents: read
  discussions: write
  issues: write
  pull-requests: write

jobs:
  run:
    if: startsWith(github.event.comment.body, '/docs-issue-scope')
    uses: elastic/docs-actions/.github/workflows/gh-aw-docs-issue-scope.lock.yml@v1
    with:
      additional-instructions: |
        This repo is the {{product.elasticsearch}} Java client.
        Focus on REST API changes and client method signatures.
    secrets:
      COPILOT_GITHUB_TOKEN: ${{ secrets.COPILOT_GITHUB_TOKEN }}
```
