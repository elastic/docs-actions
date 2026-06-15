# Docs review

Reviews changed markdown files in pull requests by using Copilot with self-contained Elastic docs review rules. By default, the workflow reviews files under `docs/`, and repositories such as `docs-content` can set `review-scope: repo-wide-markdown` to review changed markdown across the repository. It publishes a pull request review with a concise summary plus inline comments for actionable findings.

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

## Safe outputs

| Output | Max | Description |
|--------|-----|-------------|
| `noop` | — | Used when the trigger is not a pull request, or the PR has no changed markdown files in the configured review scope |
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

## Autonomous checks

This workflow combines deterministic pre-steps with runtime APM skills from `elastic/elastic-docs-skills`. A pre-step runs Vale with `elastic/vale-rules` on eligible changed markdown files, and the prompt still embeds the review rules directly so the workflow can continue making evidence-based judgments even when a specific skill is not decisive. Vale is one input into the review, not a blocker for whether review happens. The workflow still reviews all eligible markdown files even when Vale finds nothing or is unavailable. It focuses on:

- Style and clarity issues from Vale, plus high-confidence Formatting, Accessibility, and UI writing checks from the embedded style guide checklist.
- Elastic-internal jargon, outdated terms, informal shorthand, and unexplained acronyms that external readers will not understand.
- Frontmatter quality for `description`, `products`, `navigation_title`, and verified `applies_to` guidance.
- Content type fit and structure for overviews, how-to guides, tutorials, troubleshooting pages, and changelog entries.
- Parent issue satisfaction when the pull request links to a docs issue.

At runtime, the workflow imports these skills through APM:

- `docs-check-style`.
- `docs-flag-jargon-skill`.
- `docs-frontmatter-audit`.
- `docs-content-type-checker`.

The workflow uses the Elastic docs MCP server only for targeted verification, such as published cumulative-docs guidance or sibling-page context. It noops or skips a finding when it cannot verify the evidence.

When an inline comment can be expressed as a small, exact replacement for the reviewed line or hunk, the workflow should prefer an apply-ready GitHub suggestion block over prose-only guidance.

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
