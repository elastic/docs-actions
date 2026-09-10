# Issue triage

Labels an issue with the right type and team labels. A single agent fetches the repository's
existing labels, selects the ones that fit, applies them, and reacts with 👍. No comment
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
| `setup-commands` | string | No | `""` | Shell commands to run before the agent starts. |

## Safe outputs

| Output | Max | Description |
|--------|-----|-------------|
| `add-labels` | 6 | Routable: `triaged` plus selected labels. Not routable: `human-needed` only. |
| `remove-labels` | 1 | Remove `needs-team` when a team label is applied. |
| `react-green` | 1 | Add 👍 to a routable issue after labeling. |

Labels are selected from the target repository's existing label list, which the agent fetches at
the start of every run. Any label already present in the repository is eligible; there is no
fixed allowlist to extend, so board metadata such as `priority:*`, `area:*`, or `release:*` works
as soon as the repository defines it and the instructions say when to apply it. Two guardrails
hold regardless of instructions: `create-if-missing: false` refuses any label name that does not
already exist, and `needs-team` is blocked from being added because it is a remove-only label.

## Status comments

The workflow posts brief status comments at run start, on success, and on failure. These are
separate from any triage outcome and are used for observability.

## How it works

A single agent performs the whole run; there are no sub-agents.

1. **Fetch the menu.** Lists every label in the repository and treats that list as the only
   source of labels it may apply. Also reads the issue title, body, author login, comments, and
   `CODEOWNERS`.
2. **Read the instructions.** Applies the project instructions file and any inline
   `additional-instructions`. These explain *when* a label from the menu applies; they never add
   to the menu.
3. **Select from the menu.** Picks at most one type label, a team label from `CODEOWNERS` when
   confident, `cross-team` when several teams own the area, and any board metadata labels the
   instructions define. Every pick is copied verbatim from the fetched list.
4. **Judge routability.** An issue is not routable only when no type could be selected *and* it
   names no specific page, feature, or surface. A missing team label never makes an issue
   not routable.
5. **Apply the outcome.** Routable: `triaged` plus the selected labels, then a 👍 reaction, and
   `needs-team` removed if a team label was applied. Not routable: `human-needed` only, with
   `triaged` withheld so the issue stays visible in `-label:triaged` searches. No comment in
   either case.
