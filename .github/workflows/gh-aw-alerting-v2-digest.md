---
description: |
  Weekday digest of recently merged Kibana alerting-related PRs, categorized for docs,
  delivered to Slack via webhook. Excludes internal and infrastructure-only changes.

inlined-imports: true
imports:
  - gh-aw-fragments/formatting.md
  - gh-aw-fragments/rigor.md
  - gh-aw-fragments/messages-footer.md
engine:
  id: copilot
on:
  roles: [admin, maintainer, write]
  workflow_call:
    inputs:
      additional-instructions:
        description: "Repo-specific instructions appended to the agent prompt"
        type: string
        required: false
        default: ""
      setup-commands:
        description: "Shell commands to run before the agent starts"
        type: string
        required: false
        default: ""
      messages-footer:
        description: "Footer appended to agent outputs (included in Slack text if you add it to the message)"
        type: string
        required: false
        default: ""
      target-repo:
        description: "Owner/name of the repo to search for merged PRs"
        type: string
        required: false
        default: "elastic/kibana"
      hours-back:
        description: "How far back to search for merged PRs"
        type: string
        required: false
        default: "24"
      search-query:
        description: "Extra GitHub search terms (combined with repo, is:merged, and merged date)"
        type: string
        required: false
        default: "alerting"
    secrets:
      COPILOT_GITHUB_TOKEN:
        required: true
      SLACK_WEBHOOK_URL:
        required: true
concurrency:
  group: alerting-v2-digest
  cancel-in-progress: true
permissions:
  contents: read
  issues: read
  pull-requests: read
tools:
  github:
    toolsets: [repos, pull_requests, search]
  bash:
    - "cat *"
    - "jq *"
network:
  allowed:
    - defaults
    - github
    - hooks.slack.com
strict: false
safe-outputs:
  noop:
  jobs:
    slack-digest-post:
      description: |
        Post the finalized weekday digest to Slack. Call this exactly once with the full
        message body when there is at least one qualifying PR. Do not call this when you noop.
      runs-on: ubuntu-latest
      output: "Digest posted to Slack."
      inputs:
        message:
          description: "Complete Slack message text (plain text; use newlines and *bold* sparingly)"
          required: true
          type: string
      steps:
        - name: Post digest to Slack
          env:
            SLACK_WEBHOOK_URL: "${{ secrets.SLACK_WEBHOOK_URL }}"
          run: |
            set -euo pipefail
            if [ ! -f "${GH_AW_AGENT_OUTPUT:-}" ]; then
              echo "GH_AW_AGENT_OUTPUT is not set or file missing"
              exit 1
            fi
            MESSAGE=$(jq -r '.items[] | select(.type == "slack_digest_post") | .message' "$GH_AW_AGENT_OUTPUT" | head -1)
            if [ -z "$MESSAGE" ] || [ "$MESSAGE" = "null" ]; then
              echo "No slack_digest_post item in agent output"
              exit 1
            fi
            PAYLOAD=$(jq -n --arg text "$MESSAGE" '{text: $text}')
            curl -fsS -X POST "$SLACK_WEBHOOK_URL" \
              -H 'Content-Type: application/json' \
              -d "$PAYLOAD"
timeout-minutes: 30
steps:
  - name: Fetch recently merged PRs
    env:
      GH_TOKEN: ${{ secrets.COPILOT_GITHUB_TOKEN }}
      TARGET_REPO: ${{ inputs.target-repo }}
      HOURS_BACK: ${{ inputs.hours-back }}
      SEARCH_QUERY: ${{ inputs.search-query }}
    run: |
      mkdir -p /tmp/gh-aw/alerting-v2-digest
      since=$(date -u -d "$HOURS_BACK hours ago" +%Y-%m-%d)
      q="repo:${TARGET_REPO} is:pr is:merged merged:>=${since} ${SEARCH_QUERY}"
      gh search prs --json number,title,url,labels,body,mergedAt,author \
        --limit 100 --sort merged --order desc -q "$q" \
        > /tmp/gh-aw/alerting-v2-digest/prs.json
      echo "PRs fetched: $(jq 'length' /tmp/gh-aw/alerting-v2-digest/prs.json)"
  - name: Repo-specific setup
    if: ${{ inputs.setup-commands != '' }}
    env:
      SETUP_COMMANDS: ${{ inputs.setup-commands }}
    run: eval "$SETUP_COMMANDS"
---

# Kibana Alerting digest (Slack)

You summarize merged pull requests for **${{ inputs.target-repo }}** so the docs team can track alerting-related work. The run focuses on PRs merged in roughly the last **${{ inputs.hours-back }}** hours (see pre-fetched list below).

## Pre-fetched data

- **PR list**: `/tmp/gh-aw/alerting-v2-digest/prs.json` — array of merged PRs from `gh search prs` using repo, merge window, and query terms `${{ inputs.search-query }}`.

Use `cat` and `jq` to inspect this file. Do not re-run broad searches unless you need to disambiguate a single PR (e.g. fetch one PR’s full diff summary via GitHub tools).

## Your task

1. **Filter out noise** — Drop PRs that are clearly internal-only or infrastructure-only, including (adapt as needed):
   - Labels or titles indicating CI, infra, build-only, test-only, refactor with no user-facing alerting behavior
   - Dependency-only bumps with no alerting feature change
   - Purely organizational or chore PRs with no product impact for alerting users
2. **Keep alerting relevance** — Prefer PRs that match **Alerting v2 / Rules v2** work in Kibana. Strong signals (use several; none is mandatory):
   - **Titles**: `[Alerting v2]`, `[Alerting V2]`, `[Rules v2]`, or sub-areas like `[Rule authoring]`, `[Rule management]`.
   - **Labels**: `author:actionable-obs`, `Feature:AlertingV2`, `Team:actionable-obs` (many PRs have the first; others apply too).
   - **Areas**: `alerting_v2`, `alerting-v2-schemas`, `alerting-v2-rule-form`, notification policies (API + UI), **`.rule-events`** / **`.alert-actions`**, OAS/route validation, rule list search/KQL, rule or **episode** details UX, recovery vs alert delay behavior.
   - **Calibration examples** (merged): [261820](https://github.com/elastic/kibana/pull/261820) (rule events in Discover), [262567](https://github.com/elastic/kibana/pull/262567) (OAS notification policies), [261526](https://github.com/elastic/kibana/pull/261526) (space_id on events/actions), [262381](https://github.com/elastic/kibana/pull/262381) (notification policies UI), [261955](https://github.com/elastic/kibana/pull/261955) (mappings/telemetry), [261874](https://github.com/elastic/kibana/pull/261874) (episode/recover filtering), [261982](https://github.com/elastic/kibana/pull/261982) (recovery delay naming), [262132](https://github.com/elastic/kibana/pull/262132) (Rules v2 hooks / details UX), [261154](https://github.com/elastic/kibana/pull/261154) (rule search fields).
   - **Team hint**: [rna-project-team](https://github.com/orgs/elastic/teams/rna-project-team) membership can support relevance when titles are ambiguous; resolve via GitHub API if needed.
   - **Docs-relevant “internal” work**: OAS/schema/mapping PRs can still matter for **API and docs consumers**—do not exclude them just because the summary emphasizes schemas or validation rather than UI.
3. **Categorize** each remaining PR into exactly one of:
   - **New feature** — new capabilities users can adopt
   - **Enhancement** — meaningful improvement to existing behavior
   - **Bug fix** — fixes incorrect or broken behavior
4. **Quality gate**
   - If **no** PRs qualify after filtering, call **`noop`** with a short message (for example: "No qualifying alerting PRs merged in this window.").
   - If one or more qualify, call **`slack_digest_post`** exactly once with a single `message` string.

## Slack message format

Build one `message` suitable for Slack incoming webhook `text` (plain text, newlines allowed). Use this structure:

```
*Kibana alerting digest* — merged last ~${{ inputs.hours-back }}h (${{ inputs.target-repo }})

*New features*
• <title> — <url> (short reason)

*Enhancements*
• ...

*Bug fixes*
• ...

_Qualifying PRs: N. Internal/infra PRs excluded._```

If a section is empty, omit its heading and bullet list entirely.

Append the messages footer when `${{ inputs.messages-footer }}` is non-empty:

```
${{ inputs.messages-footer }}
```

## Tooling rules

- Prefer evidence from PR title, body, and labels in the JSON.
- Do **not** post to GitHub (no `add-comment` or issues).
- Use **`slack_digest_post`** only when there is at least one qualifying PR; otherwise **`noop`**.

${{ inputs.additional-instructions }}
