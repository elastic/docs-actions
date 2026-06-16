# Issue Triage

Triages issues by analyzing content and applying the appropriate team label. Uses the Elastic Docs MCP server and CODEOWNERS to determine ownership. Removes the `needs-team` label after applying a team label.

## Triggers

| Event | Description |
|-------|-------------|
| `/docs-triage` | Slash command on an issue comment |
| `workflow_dispatch` | Manual trigger (batch mode: triages all `needs-team` issues) |

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
| `additional-instructions` | string | No | `""` | Team mapping, label rules, CODEOWNERS paths |
| `setup-commands` | string | No | `""` | Shell commands to run before the agent starts |

## Safe Outputs

| Output | Max | Description |
|--------|-----|-------------|
| `noop` | — | No issues to triage or no labels needed |
| `add-labels` | 30 | Apply team labels to issues |
| `remove-labels` | 25 | Remove the `needs-team` label after triage |

Allowed labels for `add-labels`: `Team:Admin`, `Team:Developer`, `Team:DocsEng`, `Team:Experience`, `Team:Ingest`, `Team:Projects`, `cross-team`.

## How it works

1. Pre-steps fetch issue data and CODEOWNERS to `/tmp/gh-aw/triage-data/`
2. The agent reads each issue, uses the Elastic Docs MCP server to gather context about referenced pages
3. For docs stored outside the current repo, it fetches the relevant repo's CODEOWNERS via `gh api`
4. It applies the best-fit team label via `add_labels`
5. If the issue has a `needs-team` label, it removes it via `remove_labels`

## Example

The `example.yml` includes a sample team mapping via `additional-instructions`. Customize the mapping for your repo's team structure.
