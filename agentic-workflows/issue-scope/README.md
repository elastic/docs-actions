# Issue scope

Scopes the documentation impact of an issue in a single comment. One agent judges the issue
against the quality bar, searches the Elastic docs corpus for affected pages, verifies the
request against any linked code, recommends how to tackle the work, and lists questions to go
deeper. It applies `human-needed` only when the issue is not ready to scope. The issue body is
never rewritten.

## Model

The agent runs `openai/gpt-6-luna` through OpenRouter on the codex engine, authenticated with
the `OPENROUTER_API_KEY` secret. Threat detection runs separately on GitHub Copilot with the
`sonnet` model alias. The agent must query the Elastic docs MCP server before reading any
repository file, so expect higher per-issue cost than a classification-only workflow — roughly
7–10 AIC for a full assessment, about 7 for a partial one, and under 4 when the quality gate stops
early (sandbox battery, 2026-09-15).

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

1. Reads the issue title, body, comments, `CODEOWNERS` (for path vocabulary), any linked public
   PRs or commits, and up to three linked public issues (one hop). Linked code is evidence, not a
   prerequisite. When sources disagree it ranks them: linked code and PRs first, then comments
   from Elastic members (`author_association` of `MEMBER`, `OWNER`, or `COLLABORATOR`), then other
   comments and linked issues, then the issue description. Within a rank the newer source wins.
   When it cannot read a source that the issue depends on, it says what it could not read, caps
   dependent targets at Low, and returns 🟠 Partial scope if nothing else supports a target.
2. Scores the issue against the five-criterion quality bar. A red score (0–1) stops the run:
   the workflow applies `human-needed` and posts a team-facing list of what to resolve before
   rerunning `/scope`.
3. Searches the **Elastic docs MCP server** first (`search_docs`, `find_related_docs`,
   `get_document_by_url`) and only then reads repository files to confirm details.
4. Verifies the request against the linked code when there is any, otherwise against the
   published pages it found.
5. When something suggests an open pull request exists, checks sibling issues and open pull
   requests for work already in flight, within a fixed search budget of three searches and five
   pull request reads. The signals are a parent or tracking issue, a follow-up or sibling
   relationship, a linked merged PR for the same feature, or a mentioned assignee, branch, or
   draft PR. It searches the consumer repository and any other public repository that the issue,
   its parent, or its siblings name or link to. It skips this step when no signal is present.
6. Recommends documentation targets with a confidence level, describes how to tackle the work
   with the information available, states the scope boundary, and lists questions to go deeper.
   For find-and-replace issues it searches the consumer repository, and any other public
   repository that the issue names, for the phrase. It reads code from a shallow, sparse clone
   that it searches with `grep`, so it does not depend on GitHub code search; `search_code` is the
   fallback. It reports the total match count and lists up
   to 15 matching files, and writes "at least N files" when the results are partial. For issues about procedures, UI labels, or privileges it checks product source for the
   current labels and says when it could not. It treats issue
   comments as evidence and does not ask questions that they already answer.
7. Posts one comment. The 🟢 and 🟠 comments end with a line that says the scope reflects the
   issue as of the run and that `/scope` runs it again. The comment also carries a footer that
   mentions the person who requested the scope, so that GitHub notifies them when the result
   arrives, and asks them to add the label `ai-scope:helpful` or `ai-scope:unhelpful` to the issue
   when the work closes. It is the `body-footer` setting, so it appears on the scope comment and
   not on the "finished" status comment. A mention in the status message is escaped by gh-aw, so
   the footer carries it. The workflow does not read or apply the labels.

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
