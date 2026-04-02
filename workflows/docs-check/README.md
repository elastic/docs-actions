# Docs Check

Analyzes a public PR or commit to determine whether Elastic documentation needs updating. Posts a structured comment with findings, affected pages, and specific recommendations.

## Triggers

| Event | Description |
|-------|-------------|
| `/docs-check <url>` | Slash command on an issue or PR |
| `docs-check` label | Added to an issue containing a PR/commit URL |
| `workflow_dispatch` | Manual trigger with a `url` input |

## Install

```bash
mkdir -p .github/workflows && curl -sL \
  https://raw.githubusercontent.com/elastic/docs-actions/v1/workflows/docs-check/example.yml \
  -o .github/workflows/docs-check.yml
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
name: Docs Check
on:
  issue_comment:
    types: [created]
  issues:
    types: [labeled]
  workflow_dispatch:
    inputs:
      url:
        description: "URL of a public PR or commit to check"
        required: true
        type: string

permissions:
  contents: read
  issues: read
  pull-requests: read

jobs:
  run:
    uses: elastic/docs-actions/.github/workflows/gh-aw-docs-check.lock.yml@v1
    with:
      additional-instructions: |
        This repo is the Elasticsearch Java client.
        Focus on REST API changes and client method signatures.
    secrets:
      COPILOT_GITHUB_TOKEN: ${{ secrets.COPILOT_GITHUB_TOKEN }}
```
