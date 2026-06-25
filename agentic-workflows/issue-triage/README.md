# Issue triage

Triages and refines an issue in a single pass. It classifies the issue type, validates the description against a quality bar, rewrites the description when it needs it, and applies labels. It reads `CODEOWNERS` and the issue's links to infer ownership and area. Repo-specific team mapping and label rules are supplied through the `additional-instructions` input.

For the same logic running automatically when an issue is opened, see [issue-auto-triage](../issue-auto-triage/).

## Triggers

| Event | Description |
|-------|-------------|
| `/triage` | Slash command on an issue comment. |
| `/triage undo` | Restores the description from the snapshot taken before the last rewrite. |
| `workflow_dispatch` | Manual trigger. |

## Install

```bash
mkdir -p .github/workflows && curl -sL \
  https://raw.githubusercontent.com/elastic/docs-actions/v1/agentic-workflows/issue-triage/example.yml \
  -o .github/workflows/docs-triage.yml
```

Add `permissions.copilot-requests: write` to the caller workflow. You do not need to pass `COPILOT_GITHUB_TOKEN` for the default built-in auth path.

## Inputs

| Input | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `additional-instructions` | string | No | `""` | Team mapping, label rules, CODEOWNERS paths. |
| `setup-commands` | string | No | `""` | Shell commands to run before the agent starts. |

## Safe outputs

| Output | Max | Description |
|--------|-----|-------------|
| `add-labels` | 6 | Apply classification labels and any team or area labels that already exist in the repo. |
| `remove-labels` | 1 | Remove `needs-team` once the issue has been triaged, when that label exists. |
| `add-comment` | 1 | Ask the author for missing information when the issue needs a human. |
| `update-issue` | 1 | Record a triage findings block and, when appropriate, a refined description. |

Classification labels for `add-labels`: `triaged`, `human-needed`, `bug`, `enhancement`, `question`, and `documentation`. The workflow also allows the `Team:*` and `cross-team` labels for routing. It only applies labels that already exist in the target repository, and it never invents labels.

## How it works

1. On a `/triage undo` comment, it restores the previous description from the hidden snapshot and stops.
2. Otherwise it reads the issue, its comments, any linked issues or files, and `CODEOWNERS`.
3. It classifies the issue type and validates the body against the quality bar (required sections, vague language, and cross-references).
4. When the description needs refinement and enough author-supplied information is present, it rewrites the main content, keeping a hidden snapshot of the previous version for `/triage undo`.
5. It applies `triaged` plus the best-fit classification and team or area labels, removes `needs-team` when present, and records a findings block in the issue body via `update_issue`.

## Example

The `example.yml` includes a sample team mapping via `additional-instructions`. Customize the mapping for your repo's team structure.
