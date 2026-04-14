# Docs Issue Scope

Uses an issue description plus linked public PRs and commits to scope Elastic documentation work. When the command runs on an issue, it maintains a concise bot-managed scope block in the issue body when that can be done safely. Otherwise, it falls back to a concise comment with recommended doc targets and next steps.

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
| `add-comment` | 1 | Concise fallback comment when body updates are skipped or the command runs on a PR |
| `update-issue` | 1 | Maintains a bot-managed scope block in the issue body |

## Managed issue block

When `/docs-issue-scope` runs on an issue, the workflow prefers to maintain a bot-managed block between:

- `<!-- docs-issue-scope:start -->`
- `<!-- docs-issue-scope:end -->`

If the markers already exist exactly once, the workflow rewrites only that block. If the markers are missing, it appends a new block. If the markers are malformed or duplicated, it does not overwrite the issue body and falls back to a concise comment instead.

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
