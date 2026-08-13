# Issue scope

Scopes documentation impact and estimates cost/benefit for an issue in a single comment. A
`scoper` sub-agent identifies affected docs pages against linked code and the Elastic docs
corpus; a `sizer` sub-agent estimates effort, ownership, audience, and a bill of materials.
The workflow posts one combined comment and applies effort labels. The issue body is never
rewritten.

## Triggers

| Event | Description |
|-------|-------------|
| `/scope` | Slash command on an issue comment. |
| `workflow_dispatch` | Manual trigger. |

The workflow runs on issues only. Commenting `/scope` on a pull request does not trigger it.

## Install

```bash
mkdir -p .github/workflows && curl -sL \
  https://raw.githubusercontent.com/elastic/docs-actions/v1/agentic-workflows/issue-scope/example.yml \
  -o .github/workflows/docs-scope.yml
```

Add `copilot-requests: write` to the caller job `permissions:` block — no secret passthrough
needed.

## Inputs

| Input | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `additional-instructions` | string | No | `""` | Inline repo-specific instructions (precedence: immutable contract > inline instructions > project file). |
| `project-instructions-path` | string | No | `.github/scope-instructions.md` | Path to repo-specific scope instructions. Set to an empty string to disable. |
| `setup-commands` | string | No | `""` | Shell commands to run before the agent starts. |

## Safe outputs

| Output | Max | Description |
|--------|-----|-------------|
| `add-labels` | 2 | Apply one effort bucket label and, when all work is AI-suitable and effort is small, `good-for-ai`. |
| `add-comment` | 1 | Post the combined scope and cost/benefit comment. Previous ScopeBot comments are hidden automatically. |

Effort labels for `add-labels`: `hours`, `weeks: <1`, `weeks: 1`, `weeks: 2`, and `weeks: 4+`,
plus `good-for-ai`. The workflow only applies labels that already exist in the target
repository.

## Outcomes

| Outcome | Label | Comment |
|---------|-------|---------|
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
