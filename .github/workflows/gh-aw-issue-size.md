---
description: >
  Estimates the cost and benefit of an issue — effort, ownership, dependencies, audience, and a
  bill of materials splitting AI-suitable from human work. Triggered by a /size slash command, or
  via workflow_call from a consumer repository.

inlined-imports: true
imports:
  - gh-aw-fragments/formatting.md
  - gh-aw-fragments/rigor.md
  - gh-aw-fragments/mcp-pagination.md
  - gh-aw-fragments/size-logic.md
model: gpt-5-mini
engine:
  id: copilot

on:
  roles: [admin, maintainer, write]
  reaction: eyes
  status-comment: true
  workflow_call:
    inputs:
      additional-instructions:
        description: "Repo-specific instructions — ownership mapping, label rules, CODEOWNERS paths"
        type: string
        required: false
        default: ""
      setup-commands:
        description: "Shell commands to run before the agent starts"
        type: string
        required: false
        default: ""
concurrency:
  group: gh-aw-issue-size-${{ github.event.issue.number || github.run_id }}
  cancel-in-progress: true
  job-discriminator: ${{ github.event.issue.number || github.run_id }}

permissions:
  actions: read
  contents: read
  issues: read
  pull-requests: read
  copilot-requests: write

strict: false

tools:
  github:
    toolsets: [issues, repos]
  bash: ["date"]

network:
  allowed:
    - defaults
    - github
    - "figma.com"
    - "*.figma.com"
    - "slack.com"
    - "*.slack.com"
    - "ela.st"
    - "docs.bump.sh"
    - "search.elastic.co"

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
    - figma.com
    - "*.figma.com"
    - slack.com
    - "*.slack.com"
  add-labels:
    allowed:
      - "hours"
      - "weeks: <1"
      - "weeks: 1"
      - "weeks: 2"
      - "weeks: 4+"
      - "good-for-ai"
    max: 2
  add-comment:
    max: 1
    hide-older-comments: true

timeout-minutes: 15
---

This run was triggered by a `/size` slash command from a team member, or by a consumer workflow
that calls this reusable workflow. Estimate the cost and benefit of the issue and post a single
cost-and-benefit comment.

${{ inputs.additional-instructions }}