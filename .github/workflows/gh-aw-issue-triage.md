---
description: >
  Triages and refines an issue in one pass — classifies the issue type, validates it against the
  quality bar, rewrites the description when it needs it, and applies labels.
  Triggered by a /triage slash command, or via workflow_call from a consumer repository.

inlined-imports: true
imports:
  - gh-aw-fragments/formatting.md
  - gh-aw-fragments/rigor.md
  - gh-aw-fragments/mcp-pagination.md
  - gh-aw-fragments/quality-bar.md
  - gh-aw-fragments/triage-refine-logic.md
engine:
  id: copilot

on:
  roles: [admin, maintainer, write]
  reaction: eyes
  status-comment: true
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
    secrets:
      COPILOT_GITHUB_TOKEN:
        required: false
concurrency:
  group: gh-aw-issue-triage-${{ github.event.issue.number || github.event.pull_request.number || github.run_id }}
  cancel-in-progress: true
  job-discriminator: ${{ github.event.issue.number || github.event.pull_request.number || github.run_id }}

permissions:
  copilot-requests: write
  contents: read
  issues: read
  pull-requests: read

strict: false

tools:
  github:
    toolsets: [issues, repos]
  bash: ["date"]

network:
  allowed:
    - defaults
    - github
    - "www.elastic.co"
    - "docs-v3-preview.elastic.dev"
    - "figma.com"
    - "*.figma.com"
    - "slack.com"
    - "*.slack.com"

steps:
  - name: Repo-specific setup
    env:
      SETUP_COMMANDS: ${{ inputs.setup-commands }}
    run: |
      if [ -n "$SETUP_COMMANDS" ]; then
        eval "$SETUP_COMMANDS"
      fi

safe-outputs:
  allowed-domains:
    - www.elastic.co
    - docs-v3-preview.elastic.dev
    - github.com
    - figma.com
    - "*.figma.com"
    - slack.com
    - "*.slack.com"
  add-labels:
    allowed:
      - "triaged"
      - "human-needed"
      - "bug"
      - "enhancement"
      - "question"
      - "documentation"
      - "Team:Admin"
      - "Team:Developer"
      - "Team:DocsEng"
      - "Team:Experience"
      - "Team:Ingest"
      - "Team:Projects"
      - "cross-team"
    max: 6
  remove-labels:
    allowed:
      - "needs-team"
    max: 1
  add-comment:
    max: 1
    hide-older-comments: true
  update-issue:
    body:
    max: 1
    target: "*"
  messages:
    run-started: "👀 TriageBot is triaging issue #${{ github.event.issue.number }}… [{run_url}]({run_url})"
    run-success: "✅ TriageBot finished. [{run_url}]({run_url})"
    run-failure: "❌ TriageBot failed. [{run_url}]({run_url}) — check the logs."

timeout-minutes: 15
---

This run was triggered by a `/triage` slash command from a team member, or by a consumer
workflow that calls this reusable workflow. The workflow triages **and** refines the issue in a
single pass — classifying, validating, rewriting the description if needed, and applying labels.

If the command was `/triage undo`, follow phase 0 (undo check) and stop.

When calling `update_issue`, always pass `issue_number: ${{ github.event.issue.number }}`.

${{ inputs.additional-instructions }}
