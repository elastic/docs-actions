# Issue auto-triage

Automatically triages a newly opened issue with two focused agents. The router selects existing
type and team labels, then the content checker rates the issue green, orange, or red. The parent
workflow applies the labels, reacts with 👍 when a green issue passes triage, or posts one summary
comment that mentions the author for orange and red issues. It never rewrites the issue body, and
it skips issues opened by bots.

The workflow treats public issue content as untrusted input. GitHub reads use
`min-integrity: none` so community-authored issues can be analyzed, while all writes remain
constrained by safe outputs.

## Trigger

| Event | Description |
|---|---|
| `issues: opened` | The caller invokes the reusable workflow when an issue is opened. |

## Install

Install the caller workflow and copy the project instructions template:

```bash
mkdir -p .github/workflows
curl -sL \
  https://raw.githubusercontent.com/elastic/docs-actions/v1/agentic-workflows/issue-auto-triage/example.yml \
  -o .github/workflows/docs-auto-triage.yml
curl -sL \
  https://raw.githubusercontent.com/elastic/docs-actions/v1/agentic-workflows/issue-auto-triage/project-instructions.example.md \
  -o .github/triage-instructions.md
```

Customize `.github/triage-instructions.md` for the repository. The caller job needs
`issues: write`, `pull-requests: write`, and `copilot-requests: write`; it does not need secret
passthrough.

## Project instructions

By default, the workflow reads `.github/triage-instructions.md` from the consumer repository's
default branch. Use it for persistent project-specific guidance such as:

- Team, area, and ownership mappings
- Existing label selection and repository terminology
- Relevant CODEOWNERS paths
- Project-specific evidence and issue-quality expectations

The Copilot engine already loads conventional repository guidance such as `AGENTS.md` and
`.github/copilot-instructions.md`. The triage instructions file complements that general guidance;
it does not need to duplicate it. For example, in `elastic/docs-content`, keep the shared writing
and contribution rules in `AGENTS.md`, move the team map out of the caller workflow into the
triage instructions file, and summarize only the issue-quality checks relevant to triage.

Set `project-instructions-path` to another repository-relative path, or to an empty string to
disable the file. The existing `additional-instructions` input remains fully supported, so
current callers do not need to migrate immediately. When the project file is absent, the inline
instructions continue to provide all repository-specific context. When both are present, the
inline instructions can refine or override the file within the customizable topics above.

The precedence model is:

1. The immutable workflow contract
2. Inline `additional-instructions` from the caller
3. The project instructions file

Project instructions cannot override the security policy, safe-output limits, read-only GitHub
access, outcome templates, no-body-edit rule, green reaction-only behavior, one-comment limit, or
the rule that `human-needed` is the only label applied to red issues. Inline instructions cannot
override these rules either.

## Inputs

| Input | Type | Required | Default | Description |
|---|---|---|---|---|
| `project-instructions-path` | string | No | `.github/triage-instructions.md` | Repository-relative project instructions path; an empty string disables it. |
| `additional-instructions` | string | No | `""` | Inline guidance applied after the project instructions file. |
| `setup-commands` | string | No | `""` | Shell commands to run before the agent starts. |

## Safe outputs

| Output | Max | Description |
|---|---|---|
| `add-labels` | 6 | Green/orange: apply `triaged` and confident routing labels. Red: apply only `human-needed`. |
| `remove-labels` | 1 | Remove `needs-team` when a team label is applied to a green or orange issue. |
| `react-green` | 1 | Add 👍 to a green issue without posting a comment. |
| `add-comment` | 1 | Post the matching orange or red summary and mention the issue author. |

Allowed classification labels are `triaged`, `human-needed`, `bug`, `enhancement`, `question`,
and `documentation`. The workflow also allows the configured `Team:*` labels and `cross-team` for
routing on green and orange outcomes. It applies only labels that already exist in the target
repository.

There is no undo path because an issue-open event has no triggering comment.

## Quality bar

The content checker scores the issue on five criteria from the [good issues guide](https://www.elastic.co/docs/contribute-docs/how-to/good-issues), each worth 1 point:

| # | Criterion | Score 1 | Score 0 |
|---|-----------|---------|---------|
| 1 | Specific, action-oriented title | Names the exact problem or change | Too vague to act on without the body |
| 2 | Clear request with a definition of done | States what "done" looks like | Generic verb with no specific outcome |
| 3 | Context and motivation | Explains why it matters or who is affected | No indication of impact or trigger |
| 4 | Template compliance | All required sections present for the issue type | Any required section absent or placeholder |
| 5 | One issue, one testable problem | Single focused task or closely related bundle | Multiple unrelated requests or undefined scope |

Total score maps to the outcome: **4–5 → green**, **2–3 → orange**, **0–1 → red**.
