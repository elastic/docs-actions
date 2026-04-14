# Kibana Alerting V2 digest (Slack)

Runs on a weekday schedule (default: 13:00 UTC Monday–Friday), searches **elastic/kibana** for PRs merged in the last 24 hours that match an alerting-related GitHub search query, and uses the agent to drop internal or infra-only work. The agent categorizes the rest as **new features**, **enhancements**, or **bug fixes**, then posts one formatted message to Slack via an incoming webhook.

Execution uses the same GitHub Copilot CLI engine as other `gh-aw` workflows in this repository (not a separate Claude API integration).

## Triggers

| Event | Description |
|-------|-------------|
| `schedule` | Weekday cron in the copied workflow (adjust timezone by changing cron) |
| `workflow_dispatch` | Manual run for testing |

## Install

```bash
mkdir -p .github/workflows && curl -sL \
  https://raw.githubusercontent.com/elastic/docs-actions/v1/agentic-workflows/alerting-v2-digest/example.yml \
  -o .github/workflows/kibana-alerting-v2-digest.yml
```

Configure these repository secrets:

| Secret | Required | Description |
|--------|----------|-------------|
| `COPILOT_GITHUB_TOKEN` | Yes | Token with read access to the target repo (e.g. Kibana) for `gh search` / agent tools |
| `SLACK_WEBHOOK_URL` | Yes | Slack incoming webhook URL for the docs channel |

## Inputs

| Input | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `additional-instructions` | string | No | `""` | Appended to the agent prompt |
| `setup-commands` | string | No | `""` | Shell commands before the agent runs |
| `messages-footer` | string | No | `""` | Optional footer line(s) included in the Slack message |
| `target-repo` | string | No | `elastic/kibana` | `owner/name` searched for merged PRs |
| `hours-back` | string | No | `24` | Merge window (hours) for the search |
| `search-query` | string | No | (see example YAML) | Extra `gh search` terms; example includes `alerting`, **`Rules v2`**, and label **`Feature:AlertingV2`** |

## Safe outputs

| Output | Description |
|--------|-------------|
| `noop` | No qualifying PRs in the window |
| `slack-digest-post` | One Slack webhook post with the full digest |

## Example

```yaml
name: Kibana Alerting V2 digest (Slack)
on:
  schedule:
    - cron: "0 13 * * 1-5"
  workflow_dispatch:

permissions:
  actions: read
  contents: read
  discussions: write
  issues: read
  pull-requests: read

jobs:
  run:
    uses: elastic/docs-actions/.github/workflows/gh-aw-alerting-v2-digest.lock.yml@v1
    with:
      hours-back: "24"
      search-query: 'alerting OR "rule registry"'
      messages-footer: "_Automated digest — questions in #docs._"
    secrets:
      COPILOT_GITHUB_TOKEN: ${{ secrets.COPILOT_GITHUB_TOKEN }}
      SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK_URL }}
```
