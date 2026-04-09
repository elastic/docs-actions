---
description: >
  Triages issues by analyzing content and applying the appropriate team label.
  Triggered by typing /triage on an issue comment, or manually via workflow_dispatch.

inlined-imports: true
imports:
  - gh-aw-fragments/formatting.md
  - gh-aw-fragments/rigor.md
  - gh-aw-fragments/mcp-pagination.md
  - gh-aw-fragments/messages-footer.md
engine:
  id: copilot

on:
  roles: [admin, maintainer, write]
  workflow_call:
    inputs:
      additional-instructions:
        description: "Repo-specific instructions — team mapping, label rules, CODEOWNERS paths"
        type: string
        required: false
        default: ""
      setup-commands:
        description: "Shell commands to run before the agent starts"
        type: string
        required: false
        default: ""
      messages-footer:
        description: "Footer appended to all agent comments"
        type: string
        required: false
        default: ""
    secrets:
      COPILOT_GITHUB_TOKEN:
        required: true

concurrency:
  group: issue-triage
  cancel-in-progress: true

permissions:
  contents: read
  issues: read

strict: true

tools:
  github:
    toolsets: [issues, labels, repos]
  bash:
    - "cat *"
    - "jq *"
    - "gh api *"

mcp-servers:
  elastic-docs:
    url: "https://www.elastic.co/docs/_mcp/"
    allowed: ["*"]

network:
  allowed:
    - defaults
    - github
    - "www.elastic.co"

steps:
  - name: Fetch issue data
    env:
      GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      EVENT_NAME: ${{ github.event_name }}
      ISSUE_NUMBER: ${{ github.event.issue.number }}
      REPO: ${{ github.repository }}
    run: |
      mkdir -p /tmp/gh-aw/triage-data

      if [ "$EVENT_NAME" = "workflow_dispatch" ]; then
        # Batch mode: fetch all open needs-team issues
        gh issue list --repo "$REPO" \
          --label "needs-team" \
          --state open \
          --json number,title,body,labels,author,createdAt,url \
          --limit 25 \
          > /tmp/gh-aw/triage-data/issues.json
      else
        # Slash command mode: fetch the triggering issue
        gh issue view "$ISSUE_NUMBER" \
          --repo "$REPO" \
          --json number,title,body,labels,author,createdAt,url \
          | jq '[.]' > /tmp/gh-aw/triage-data/issues.json
      fi

      echo "Issues to triage: $(jq 'length' /tmp/gh-aw/triage-data/issues.json)"

  - name: Fetch CODEOWNERS
    env:
      GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      REPO: ${{ github.repository }}
    run: |
      gh api "repos/$REPO/contents/.github/CODEOWNERS" \
        --jq '.content' | base64 -d > /tmp/gh-aw/triage-data/CODEOWNERS || true
      echo "CODEOWNERS fetched."

  - name: Repo-specific setup
    if: ${{ inputs.setup-commands != '' }}
    env:
      SETUP_COMMANDS: ${{ inputs.setup-commands }}
    run: eval "$SETUP_COMMANDS"

safe-outputs:
  noop:
  add-labels:
    allowed:
      - "Team:Admin"
      - "Team:Developer"
      - "Team:DocsEng"
      - "Team:Experience"
      - "Team:Ingest"
      - "Team:Projects"
      - "cross-team"
    max: 30

timeout-minutes: 10
---

# Issue Triage Agent

You are a triage agent for ${{ github.repository }}. Your job is to read issues and apply the correct team label based on the issue content.

## Pre-Downloaded Data

- **Issues**: `/tmp/gh-aw/triage-data/issues.json` — the issue(s) to triage.
- **CODEOWNERS**: `/tmp/gh-aw/triage-data/CODEOWNERS` — maps file paths to owning teams.

Use `cat` and `jq` to read these files.

If the issues JSON contains an empty array (`[]`), call `noop` with message "No issues to triage" and stop.

## Available Tools

You have access to the **Elastic Docs MCP server** (`elastic-docs`). Use it to:
- **`search_docs`**: Search published Elastic documentation by keyword or topic. Use this to understand what area of the product an issue relates to.
- **`get_document_by_url`**: Retrieve a specific docs page by URL. Use this when an issue links to a specific page — fetch it to understand its content and which product area it belongs to.
- **`find_related_docs`**: Find docs related to a topic. Use this when the issue is vague and you need more context.

You also have access to **`gh api`** via bash. Use it to fetch CODEOWNERS from other repos when an issue references docs stored outside the current repository.

## Rules

1. **One primary team label per issue.** Pick the best fit.
2. **Add `cross-team`** alongside the primary label only if the issue clearly spans multiple teams.
3. **URL paths are the strongest signal.** If the issue references a specific `elastic.co/docs/` or `elastic.co/guide/` URL, extract the path and match against CODEOWNERS and the team mapping. Use `get_document_by_url` from the Elastic Docs MCP server to fetch the page and confirm which product area it covers.
4. **Use the Elastic Docs MCP server** to gather context. If the issue mentions a topic but no URL, use `search_docs` to find the relevant docs and determine which team owns that area.
5. **When ambiguous, prefer the team that owns the most relevant page.** Do not guess — use the tools available to you to gather evidence.
6. **Docs in other repos**: If the issue references documentation stored outside the current repository, use `gh api repos/{owner}/{repo}/contents/.github/CODEOWNERS` to fetch that repo's CODEOWNERS and identify the owning team. Map the result back to the team labels if possible.
7. **Fallback**: If you genuinely cannot determine the owning team, apply `cross-team` so the issue stays visible.
8. **Do NOT add comments.** Only apply labels.

## Process

For each issue in the JSON:

1. Read the title, body, and existing labels
2. If the issue already has a `Team:*` label, skip it
3. Look for URLs pointing to specific docs pages — extract the path and match against the CODEOWNERS file and the team mapping
4. Use the Elastic Docs MCP server to fetch referenced pages or search for related docs to confirm the product area
5. If the issue references docs in another repo, fetch that repo's CODEOWNERS via `gh api` to identify the owning team
6. Look for product/feature keywords in the title and body
7. Determine the best-fit team label
8. Apply the label using `add_labels`

When done with all issues, if no labels were needed, call `noop` with a brief explanation.

${{ inputs.additional-instructions }}
