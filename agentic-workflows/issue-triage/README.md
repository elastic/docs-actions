# Issue triage

Triages an issue using two focused sub-agents. The router classifies the issue and selects type
and team labels. The content checker rates the quality green, orange, or red. The parent workflow
applies all writes: labels and — for orange and red — a summary comment that mentions the author.
Green issues get a 👍 reaction. The issue body is never rewritten.

The workflow treats public issue content as untrusted input. GitHub reads use
`min-integrity: none` so community-authored issues can be analyzed, while all writes remain
constrained by safe outputs.

For the same logic running automatically when an issue is opened, see
[issue-auto-triage](../issue-auto-triage/).

## Triggers

| Event | Description |
|-------|-------------|
| `/triage` | Slash command on an issue comment. |
| `workflow_dispatch` | Manual trigger. |

## Install

```bash
mkdir -p .github/workflows
curl -sL \
  https://raw.githubusercontent.com/elastic/docs-actions/v1/agentic-workflows/issue-triage/example.yml \
  -o .github/workflows/docs-triage.yml
curl -sL \
  https://raw.githubusercontent.com/elastic/docs-actions/v1/agentic-workflows/issue-auto-triage/project-instructions.example.md \
  -o .github/triage-instructions.md
```

Customize `.github/triage-instructions.md` for the repository. The caller job needs
`issues: write`, `pull-requests: write`, and `copilot-requests: write`; it does not need secret
passthrough.

## Project instructions

By default, the workflow reads `.github/triage-instructions.md` from the consumer repository's
default branch. Both issue-triage and issue-auto-triage read the same file, so a single
instructions file covers both workflows.

Use it for persistent project-specific guidance such as:

- Team, area, and ownership mappings
- Existing label selection and repository terminology
- Relevant CODEOWNERS paths
- Project-specific evidence and issue-quality expectations

Set `project-instructions-path` to another repository-relative path, or to an empty string to
disable the file. The existing `additional-instructions` input remains fully supported. When both
are present, the inline instructions can refine or override the file within the customizable
topics listed above.

The precedence model is:

1. The immutable workflow contract
2. Inline `additional-instructions` from the caller
3. The project instructions file

## Inputs

| Input | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `project-instructions-path` | string | No | `.github/triage-instructions.md` | Repository-relative project instructions path; an empty string disables it. |
| `additional-instructions` | string | No | `""` | Inline guidance applied after the project instructions file. |
| `setup-commands` | string | No | `""` | Shell commands to run before the agent starts. |

## Safe outputs

| Output | Max | Description |
|--------|-----|-------------|
| `add-labels` | 6 | Green/orange: apply `triaged` and confident routing labels. Red: apply only `human-needed`. |
| `remove-labels` | 1 | Remove `needs-team` when a team label is applied to a green or orange issue. |
| `react-green` | 1 | Add 👍 to a green issue without posting a comment. |
| `add-comment` | 1 | Post the matching orange or red summary and mention the issue author. |

Allowed classification labels are `triaged`, `human-needed`, `bug`, `enhancement`, `question`,
and `documentation`. The workflow also allows the configured `Team:*` labels and `cross-team` for
routing. It applies only labels that already exist in the target repository.

## How it works

1. Reads the issue title, body, author login, comments, `CODEOWNERS`, and the repository's
   existing labels.
2. The `router` sub-agent classifies the issue and returns a label decision. It does not call any
   safe-output tools.
3. The `content-checker` sub-agent validates the body and comments against the quality bar and
   returns a green, orange, or red rating with actionable bullets. It does not call any
   safe-output tools.
4. The parent applies all writes: `add_labels`, `remove_labels` (when applicable), and either
   `react_green` (green) or `add_comment` (orange or red).

## Outcome behavior

| Outcome | Feedback | Labels |
|---|---|---|
| Green | Add a 👍 reaction; do not post a comment | `triaged` plus confident type/team routing labels |
| Orange | Post one 🟠 summary mentioning the issue author | `triaged` plus confident type/team routing labels |
| Red | Post one 🔴 summary mentioning the issue author | Only `human-needed` |
