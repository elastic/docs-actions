# Issue scope

Scopes documentation impact and estimates cost/benefit for an issue in a single comment. A
`quality-checker` sub-agent first decides whether the issue carries enough information to scope
at all; a `scoper` sub-agent identifies affected docs pages against linked code and the Elastic
docs corpus; a `sizer` sub-agent estimates effort, ownership, audience, and a bill of materials.
The workflow posts one combined comment and applies labels. The issue body is never rewritten.

## Model

The agent runs `openai/gpt-5.6-luna` through OpenRouter on the codex engine, authenticated with
the `OPENROUTER_API_KEY` secret. Threat detection runs separately on GitHub Copilot with the
`sonnet` model alias. The scoper makes active use of the Elastic docs MCP server to search the
published docs corpus, so expect higher per-issue cost than a classification-only workflow —
roughly 16–25 AIC for a full assessment and under 10 AIC when the quality gate stops early.

## Triggers

| Event | Description |
|-------|-------------|
| `/scope` | Slash command on an issue comment. |
| `workflow_dispatch` | Manual trigger. |

The workflow runs on issues only. Commenting `/scope` on a pull request does not trigger it.

The caller workflow uses `workflow_call` to invoke this reusable workflow. The triggers above
refer to the conditions the caller evaluates before dispatching.

## Install

```bash
mkdir -p .github/workflows && curl -sL \
  https://raw.githubusercontent.com/elastic/docs-actions/v1/agentic-workflows/issue-scope/example.yml \
  -o .github/workflows/docs-scope.yml
```

The caller job needs `copilot-requests: write` in its `permissions:` block (threat detection
runs on Copilot) and must make `OPENROUTER_API_KEY` available to the workflow — `secrets: inherit`
is the simplest way, as in the example below.

## Inputs

| Input | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `additional-instructions` | string | No | `""` | Inline repo-specific instructions (precedence: immutable contract > inline instructions > project file). |
| `project-instructions-path` | string | No | `.github/scope-instructions.md` | Path to repo-specific scope instructions. Set to an empty string to disable. |
| `setup-commands` | string | No | `""` | Shell commands to run before the agent starts. |

## Safe outputs

| Output | Max | Description |
|--------|-----|-------------|
| `add-labels` | 2 | Apply one effort bucket label and, when all work is AI-suitable and effort is small, `good-for-ai`; or `human-needed` alone when the quality gate stops the run. |
| `add-comment` | 1 | Post the combined scope and cost/benefit comment. Previous ScopeBot comments are hidden automatically. |

Allowed labels for `add-labels`: `hours`, `weeks: <1`, `weeks: 1`, `weeks: 2`, `weeks: 4+`,
`good-for-ai`, and `human-needed`. The workflow only applies labels that already exist in the
target repository.

## How it works

1. Reads the issue title, body, comments, and any linked engineering PRs or commits.
2. The `quality-checker` sub-agent scores the issue against the five-criterion quality bar. A
   red score (0–1) stops the run: the workflow applies `human-needed`, posts a team-facing list
   of what to add before rerunning `/scope`, and skips the scoper and sizer.
3. The `scoper` sub-agent identifies affected documentation pages. It actively queries the
   **Elastic docs MCP server** (`search_docs`, `find_related_docs`, `get_document_by_url`,
   `find_docs_inconsistencies`) to find affected pages that may not be linked in the issue.
   APM installs the `content-type-checker` and `applies-to-tagging` skills for the codex target.
4. The `sizer` sub-agent estimates effort, ownership, audience, and produces a bill of materials.
5. The workflow posts one combined comment and applies labels.

## Outcomes

| Outcome | Label | Comment |
|---------|-------|---------|
| 🔴 Issue not ready to scope (quality gate) | `human-needed` | Team-facing list of gaps to resolve before rerunning; scoper and sizer never run |
| 🟢 Full assessment | Effort + optional `good-for-ai` | Full scope table and cost/benefit |
| 🟠 Additional context might help | Effort label when confident | Usable sections + what to add before rerunning |
| 🔴 Not assessable | None | Short ask for missing context |

A 🟠 outcome is common when the issue has no linked PRs or commits — the scoper produces a
limited scope from issue text and the Elastic docs corpus, and the sizer runs with lower
confidence. Add the PR or commit link and rerun `/scope` for a full assessment.

## Project instructions

By default, the workflow reads `.github/scope-instructions.md` from the consumer repository.
If the file does not exist, the workflow continues without it. Use this file to customize:

- Team, area, and ownership mappings
- Which CODEOWNERS paths are relevant
- Repository-specific vocabulary or docs structure

Project instructions cannot override the outcome contract, the comment templates, or the
safe-output limits.

## Example with additional instructions

```yaml
jobs:
  run:
    if: >-
      github.event_name == 'workflow_dispatch' ||
      (startsWith(github.event.comment.body, '/scope') &&
       github.event.issue.pull_request == null)
    uses: elastic/docs-actions/.github/workflows/gh-aw-issue-scope.lock.yml@v1
    with:
      additional-instructions: |
        This repository's docs live under `docs/` and follow the Elastic docs structure.
        Team:DocsEng owns all content under `docs/ingest/`.
    secrets: inherit
```
