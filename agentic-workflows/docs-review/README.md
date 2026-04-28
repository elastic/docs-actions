# Docs review

Reviews changed markdown files in pull requests by using Copilot and Elastic Docs Skills. The workflow limits its scope to files under `docs/` and publishes a pull request review with a concise summary plus inline comments for actionable findings.

## Triggers

| Event | Description |
|-------|-------------|
| `/docs-review` | Slash command on a pull request comment |
| PR checkbox menu | Consumer-managed PR menu workflow that calls the same reusable workflow when a checkbox is selected |

## Install

```bash
mkdir -p .github/workflows && curl -sL \
  https://raw.githubusercontent.com/elastic/docs-actions/v1/agentic-workflows/docs-review/example.yml \
  -o .github/workflows/docs-review.yml
```

Configure the `COPILOT_GITHUB_TOKEN` secret before running the workflow.

## Inputs

| Input | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `additional-instructions` | string | No | `""` | Repo-specific instructions appended to the review prompt |
| `review-scope` | string | No | `"docs-subtree"` | Markdown review scope: `docs-subtree` or `repo-wide-markdown` |
| `setup-commands` | string | No | `""` | Shell commands to run before the agent starts |
| `messages-footer` | string | No | _(default footer)_ | Footer appended to all review summaries |

## Safe outputs

| Output | Max | Description |
|--------|-----|-------------|
| `noop` | — | Used when the trigger is not a pull request, or the PR has no changed `docs/**/*.md` files |
| `create-pull-request-review-comment` | 20 | Adds focused inline review comments on changed markdown lines |
| `submit-pull-request-review` | 1 | Submits the overall pull request review summary as a non-blocking `COMMENT` |

The inline review comment cap for this workflow is set to `20`, so the workflow prioritizes the highest-signal comments and keeps broader observations in the summary review. Lower-priority nits should only be reported when they are grounded in the Elastic style guide, and those nits should usually be summarized in the review body instead of consuming inline comment slots.

## Review scope

The workflow reviews only files that both:

- changed in the current pull request, and
- match the configured markdown review scope.

Supported review scopes:

- `docs-subtree` reviews only changed markdown files under `docs/`.
- `repo-wide-markdown` reviews changed markdown files anywhere in the repository.

It ignores markdown outside the configured review scope, non-markdown files, and unrelated pre-existing issues in untouched files.

If the pull request is linked to a parent issue, the review also checks whether the PR appears to satisfy that issue's documentation ask and reports the result in the summary review.

## Skills used

This workflow installs these Elastic Docs Skills through Agent Package Manager dependencies:

- `docs-check-style`.
- `docs-flag-jargon-skill`.
- `docs-frontmatter-audit`.
- `docs-content-type-checker`.
- `docs-applies-to-tagging`.

The review prompt instructs the Copilot agent to invoke these imported skills by exact name through the skill tool before falling back to manual judgment.

When an inline comment can be expressed as a small, exact replacement for the reviewed line or hunk, the workflow should prefer an apply-ready GitHub suggestion block over prose-only guidance.

Only `docs-check-style` explicitly references Vale. That skill tries the `vale_lint` MCP tool first and otherwise falls back to the `vale` CLI when available. The reusable workflow itself does not install Vale, so if the runtime environment lacks a `vale` binary and no Vale MCP tool is present, that skill falls back to manual style review.

## Example

```yaml
name: Docs Review
on:
  issue_comment:
    types: [created]

permissions:
  actions: read
  contents: read
  discussions: write
  pull-requests: write

jobs:
  run:
    if: >-
      github.event.issue.pull_request != null &&
      startsWith(github.event.comment.body, '/docs-review')
    uses: elastic/docs-actions/.github/workflows/gh-aw-docs-review.lock.yml@v1
    with:
      review-scope: docs-subtree
      additional-instructions: |
        This repository stores product documentation in `docs/`.
        Prefer concise review comments with exact replacement text when possible.
    secrets:
      COPILOT_GITHUB_TOKEN: ${{ secrets.COPILOT_GITHUB_TOKEN }}
```

## PR checkbox menus

If your repository already uses a checkbox-driven AI menu, keep that workflow in the consumer repo and have the selected PR checkbox call `elastic/docs-actions/.github/workflows/gh-aw-docs-review.lock.yml@v1`. This keeps the reusable review logic in `docs-actions` while letting each repo decide how its PR menu is posted and refreshed.

For repositories like `docs-content` where markdown lives across the repository instead of under `docs/`, set `review-scope: repo-wide-markdown`.
