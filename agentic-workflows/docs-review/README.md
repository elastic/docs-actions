# Docs review

Reviews changed markdown files in pull requests using self-contained Elastic docs review rules. By default, the workflow reviews files under `docs/`, and repositories such as `docs-content` can set `review-scope: repo-wide-markdown` to review changed markdown across the repository. It publishes a pull request review with a concise summary plus inline comments for actionable findings.

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

Add the following to the caller workflow before running this workflow:

- `permissions.copilot-requests: write`
- `permissions.id-token: write`
- Your repo on the allowlist of the Docs agentic workflows service account in `elastic/centralized-it-infra`. The workflow supplies the Workload Identity provider and the service account itself.

The workflow uses the Claude engine with Claude Sonnet 5.5 (`claude-sonnet-5-5`) through the Agent Router gateway (`/anthropic` route) and authenticates with a Google ID token, so it needs no model API key. A review of one page counted about 380,000 tokens against the service account's shared hourly limit (measured on Oct 22, 2026, cached tokens included). See [Developing agentic workflows](../DEVELOPING.md#agent-router-workflows) for the setup, the limit and troubleshooting. Threat detection still runs on Copilot, so keep `permissions.copilot-requests: write`.

## Inputs

| Input | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `additional-instructions` | string | No | `""` | Repo-specific instructions appended to the review prompt |
| `review-scope` | string | No | `"docs-subtree"` | Markdown review scope: `docs-subtree` or `repo-wide-markdown` |
| `setup-commands` | string | No | `""` | Shell commands to run before the agent starts |
| `comment-phrasing` | string | No | `"describe-recommended"` | Phrasing style for review comments: `describe-recommended` or `advisory` |

## Safe outputs

| Output | Max | Description |
|--------|-----|-------------|
| `noop` | — | Used when the trigger is not a pull request, or the PR has no changed markdown files in the configured review scope |
| `create-pull-request-review-comment` | 20 | Adds focused inline review comments on changed markdown lines |
| `submit-pull-request-review` | 1 | Submits the overall pull request review summary as a non-blocking `COMMENT` |

The inline review comment cap for this workflow is set to `20`, so the workflow prioritizes the highest-signal comments and keeps broader observations in the summary review. Lower-priority nits should only be reported when they are grounded in the Elastic style guide, and those nits should usually be summarized in the review body instead of consuming inline comment slots.

The review summary ends with a footer that asks the writer to add the label `ai-review:helpful` or `ai-review:unhelpful` to the PR when it closes. The footer is the `messages.footer` setting, so it appears on the summary and not on inline comments. The workflow does not read or apply the labels.

## Review scope

The workflow reviews only files that both:

- changed in the current pull request, and
- match the configured markdown review scope.

Supported review scopes:

- `docs-subtree` reviews only changed markdown files under `docs/`.
- `repo-wide-markdown` reviews changed markdown files anywhere in the repository.

It ignores markdown outside the configured review scope, non-markdown files, and unrelated pre-existing issues in untouched files.

If the pull request is linked to a parent issue, the review also checks whether the PR appears to satisfy that issue's documentation ask and reports the result in the summary review.

## Comment phrasing

The `comment-phrasing` input controls how the action phrases its review comments. Both styles follow the Elastic [word choice](https://www.elastic.co/docs/contribute-docs/style-guide/word-choice) guidance and avoid "you should" and "it is recommended".

| Value | Behavior |
|-------|----------|
| `describe-recommended` (default) | Describes the correct approach directly. Reserves "we recommend" for cases with multiple valid options. Avoids conditional modal verbs ("should", "could", "would") in comment prose. |
| `advisory` | Describes the correct approach as the default. Allows "consider X" and "we recommend X" for suggestions with legitimate alternatives. |

**Preferred phrasing (both styles)**:

| Instead of | Use |
|------------|-----|
| "You should use active voice here." | "Use active voice here." |
| "It is recommended that you add a prerequisites section." | "We recommend adding a prerequisites section." |
| "You could consider rephrasing this." | "Rephrase this as: ..." or "We recommend rephrasing this as: ..." |
| "You should avoid using `blacklist`." | "Replace `blacklist` with `blocklist`." |

## Autonomous checks

This workflow combines deterministic pre-steps with the `elastic/elastic-docs-skills` six-criteria review rubric. A pre-step runs Vale with `elastic/vale-rules` on eligible changed markdown files. Vale is one input into the review, not a blocker — the workflow still reviews all eligible files even when Vale finds nothing or is unavailable.

The review rubric (`review-criteria.md`) is compiled into the workflow and covers six criteria:

| Criterion | Covers |
|-----------|--------|
| User focus | Content completeness, scannability, findability, logical flow |
| Technical accuracy | Correctness, SME evidence, code samples, prerequisites |
| Applicability | `applies_to` tags, cumulative structure, deployment types |
| Maintainability | Single source of truth, redirects, high-maintenance content |
| Language | Grammar, plain language, jargon, variables |
| Style | Voice and tense, formatting, admonitions, accessibility |

At runtime, the workflow installs these `elastic/elastic-docs-skills` skills through the gh-aw `skills:` frontmatter key and the agent invokes each one with the `Skill` tool as an implementation tool for the relevant criterion:

- `docs-check-style` (Language and Style criteria).
- `docs-flag-jargon-skill` (Language criterion).
- `docs-frontmatter-audit` (Applicability criterion).
- `docs-content-type-checker` (User Focus criterion).
- `docs-applies-to-tagging` (Applicability criterion).
- `docs-check-contradictions` (Technical accuracy criterion).

The skills are pinned to `elastic-docs-skills@main` at compile time; the weekly recompile moves the pin. The Claude engine runs with `permission-mode: bypassPermissions` because gh-aw never adds the `Skill` tool to Claude's allowlist; the MCP gateway `allowed:` lists and the network firewall remain the enforced boundaries.

The workflow uses the Elastic docs MCP server for targeted verification, such as cross-page duplication checks, published cumulative-docs guidance, and sibling-page context. It noops or skips a finding when it cannot verify the evidence.

The workflow reads a linked code pull request's state before it describes it. It states that a linked commit is merged only with evidence for the target branch, such as a merged pull request that contains it, and that it is released only with a release or tag that contains it. It does not report a dependency or blocker that the PR description already names. It flags a UI label only after it finds the label in product source or in consistent published docs. When it cannot verify a label either way, it leaves the label alone and lists `UI labels: not verified` under `Review coverage`. It also lists any check that a rate limit or a tool error stopped.

To check code in another public repository, such as a UI label in `elastic/kibana`, the workflow makes a shallow, sparse clone of one directory and searches it with `grep`, up to two clones per run. `search_code` is the fallback when a clone fails or the path list does not show where to look. A failed clone appears in the Review coverage list.

It reads the PR conversation and review threads, and it treats a point that a reviewer or the author rejected as settled. It does not suggest content for a page that the PR links to another page for, and it follows the cumulative-docs rule that GA content in an unversioned product is labeled at the page level only.

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
  copilot-requests: write

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
```

## PR checkbox menus

If your repository already uses a checkbox-driven AI menu, keep that workflow in the consumer repo and have the selected PR checkbox call `elastic/docs-actions/.github/workflows/gh-aw-docs-review.lock.yml@v1`. This keeps the reusable review logic in `docs-actions` while letting each repo decide how its PR menu is posted and refreshed.

For repositories like `docs-content` where markdown lives across the repository instead of under `docs/`, set `review-scope: repo-wide-markdown`.
