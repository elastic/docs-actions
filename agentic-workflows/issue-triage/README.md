# Issue triage

Labels an issue with the right type and team labels. A single `router` sub-agent classifies the
issue and selects type and team labels. The parent applies labels and reacts with 👍. No comment
is ever posted and the issue body is never rewritten.

The workflow treats public issue content as untrusted input. GitHub reads use
`min-integrity: none` so community-authored issues can be analyzed, while all writes remain
constrained by safe outputs.

For quality assessment and scope estimation, see [issue-scope](../docs-issue-scope/).
For the same routing logic running automatically when an issue is opened, see
[issue-auto-triage](../issue-auto-triage/).

## Model

The workflow uses a fast, low-cost model (Haiku via OpenRouter). This keeps per-issue cost low.
Factor the model tier into cost estimates before enabling at scale.

## Triggers

| Event | Description |
|-------|-------------|
| `/triage` | Slash command on an issue comment. |
| `workflow_dispatch` | Manual trigger. |

The caller workflow uses `workflow_call` to invoke this reusable workflow. The triggers above
refer to the conditions the caller evaluates before dispatching.

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
| `additional-allowed-labels` | string | No | `""` | Comma-separated list of extra labels the router may apply (e.g. `priority:high,area:APM,size:S`). Use this to declare board metadata labels without a PR to docs-actions. |
| `setup-commands` | string | No | `""` | Shell commands to run before the agent starts. |

## Safe outputs

| Output | Max | Description |
|--------|-----|-------------|
| `add-labels` | 6 | Apply `triaged` plus confident type and team routing labels. |
| `remove-labels` | 1 | Remove `needs-team` when a team label is applied. |
| `react-green` | 1 | Add 👍 after labeling. |

Allowed classification labels are `triaged`, `bug`, `enhancement`, `question`, and
`documentation`. The workflow also allows `cross-team` and the following routing labels:
`Team:Admin`, `Team:Developer`, `Team:DocsEng`, `Team:Experience`, `Team:Ingest`, `Team:SKI`,
`Team:Projects`. Additional labels passed via `additional-allowed-labels` extend this list at
runtime. The workflow applies only labels that already exist in the target repository. Labels
outside the allowlist are silently dropped even if they exist in the repo.

## Status comments

The workflow posts brief status comments at run start, on success, and on failure. These are
separate from any triage outcome and are used for observability.

## How it works

1. Reads the issue title, body, author login, comments, `CODEOWNERS`, and the repository's
   existing labels.
2. The `router` sub-agent classifies the issue and returns a label decision. It does not call any
   safe-output tools.
3. The parent applies all writes: `add_labels`, `remove_labels` (when applicable), and
   `react_green`.
