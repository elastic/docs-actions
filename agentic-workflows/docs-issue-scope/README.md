# Docs Issue Scope

Uses an issue description plus linked public PRs and commits to scope Elastic documentation work. When the command runs on an issue, it maintains a concise bot-managed scope block in the issue body when that can be done safely. The managed block is published under an `Elastic Docs AI Scoping 🤖` heading, and the details are wrapped in a collapsible section to keep the issue body compact. Otherwise, it falls back to a concise comment with recommended doc targets and next steps.

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

Pass `DOCS_LITELLM_API_KEY` via a repository or organization secret. The caller job must forward it:

```yaml
    secrets:
      DOCS_LITELLM_API_KEY: ${{ secrets.DOCS_LITELLM_API_KEY }}
```

## Inputs

| Input | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `additional-instructions` | string | No | `""` | Repo-specific instructions appended to the agent prompt |
| `setup-commands` | string | No | `""` | Shell commands to run before the agent starts |

## Safe Outputs

| Output | Max | Description |
|--------|-----|-------------|
| `noop` | — | No documentation impact detected |
| `add-comment` | 1 | Concise fallback comment when body updates are skipped or the command runs on a PR |
| `update-issue` | 1 | Maintains a bot-managed scope block in the issue body |

## Integrity model

This workflow explicitly sets `tools.github.min-integrity: none` so it can scope docs work from public community issues in public repositories. Treat issue and comment content as untrusted input, and rely on the workflow prompt and safe outputs to keep the analysis constrained.

## Managed issue block

When `/docs-issue-scope` runs on an issue, the workflow prefers to maintain a bot-managed block between:

- `<!-- docs-issue-scope:start -->`
- `<!-- docs-issue-scope:end -->`

If the markers already exist exactly once, the workflow rewrites only that block. If the markers are missing, it appends a new block. The managed block includes an `Elastic Docs AI Scoping 🤖` heading followed by a GitHub `<details>` section. If the markers are malformed or duplicated, it does not overwrite the issue body and falls back to a concise comment instead.

## Imported skills

This workflow installs these APM skills from `elastic/elastic-docs-skills`:

- `docs-content-type-checker`.
- `docs-applies-to-tagging`.

The workflow uses them only when they materially improve page-fit, content-type, or `applies_to` recommendations. The prompt still embeds its own scoping rules so the workflow remains usable without any single skill.

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
```
