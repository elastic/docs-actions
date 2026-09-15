# Issue scope

Scopes the documentation impact of an issue in a single comment. One agent judges the issue
against the quality bar, searches the Elastic docs corpus for affected pages, verifies the
request against any linked code, recommends how to tackle the work, and lists questions to go
deeper. It applies `human-needed` only when the issue is not ready to scope. The issue body is
never rewritten.

## Model

The agent runs `openai/gpt-5.6-luna` through OpenRouter on the codex engine, authenticated with
the `OPENROUTER_API_KEY` secret. Threat detection runs separately on GitHub Copilot with the
`sonnet` model alias. The agent must query the Elastic docs MCP server before reading any
repository file, so expect higher per-issue cost than a classification-only workflow — roughly
10–15 AIC for a full assessment and under 10 AIC when the quality gate stops early.

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
| `add-labels` | 1 | Apply `human-needed` when the quality gate stops the run. No other label is ever applied. |
| `add-comment` | 1 | Post the scope comment. Previous ScopeBot comments are hidden automatically. |

The only allowed label is `human-needed`, and it must already exist in the target repository —
the workflow never creates labels.

## How it works

1. Reads the issue title, body, comments, `CODEOWNERS` (for path vocabulary), and any linked
   public PRs or commits. Linked code is evidence, not a prerequisite.
2. Scores the issue against the five-criterion quality bar. A red score (0–1) stops the run:
   the workflow applies `human-needed` and posts a team-facing list of what to resolve before
   rerunning `/scope`.
3. Searches the **Elastic docs MCP server** first (`search_docs`, `find_related_docs`,
   `get_document_by_url`) and only then reads repository files to confirm details.
4. Verifies the request against the linked code when there is any, otherwise against the
   published pages it found.
5. Recommends documentation targets with a confidence level, describes how to tackle the work
   with the information available, states the scope boundary, and lists questions to go deeper.
6. Posts one comment.

## Outcomes

| Outcome | Label | Comment |
|---------|-------|---------|
| 🔴 Issue not ready to scope (quality gate) | `human-needed` | Team-facing list of gaps to resolve before rerunning |
| 🟢 Full assessment | None | Summary, request accuracy, docs targets, how to tackle this, scope boundary, questions to go deeper |
| 🟠 Partial scope | None | The sections that could be assessed, plus questions to resolve before rerunning |

An issue with no linked PR or commit is normal for documentation work: targets are capped at
Medium confidence and the outcome can still be 🟢. 🟠 means the issue scored orange on the
quality bar, or no credible target was found.

## Project instructions

By default, the workflow reads `.github/scope-instructions.md` from the consumer repository.
If the file does not exist, the workflow continues without it. Use this file to customize:

- Area and ownership vocabulary
- Which CODEOWNERS paths are relevant
- Repository-specific terminology or docs structure

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
        Pages under `docs/ingest/` are owned by the ingest writers.
    secrets: inherit
```
