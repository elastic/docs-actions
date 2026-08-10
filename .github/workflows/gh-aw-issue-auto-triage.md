---
description: >
  Auto-triages a newly opened issue — classifies the issue type, validates it against the
  quality bar, refines the description when appropriate, and applies labels.
  Invoked via workflow_call from a consumer repository that triggers on issues: opened.

inlined-imports: true
imports:
  - gh-aw-fragments/formatting.md
  - gh-aw-fragments/rigor.md
  - gh-aw-fragments/mcp-pagination.md
  - gh-aw-fragments/quality-bar.md
  - gh-aw-fragments/triage-refine-logic.md
model: gpt-5-mini
engine:
  id: copilot

on:
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
concurrency:
  group: gh-aw-issue-auto-triage-${{ github.event.issue.number || github.run_id }}
  cancel-in-progress: true
  job-discriminator: ${{ github.event.issue.number || github.run_id }}

permissions:
  contents: read
  issues: read
  pull-requests: read
  copilot-requests: write

strict: false

tools:
  github:
    min-integrity: none
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
    - www.elastic.co
    - docs-v3-preview.elastic.dev
    - github.com
    - figma.com
    - "*.figma.com"
    - slack.com
    - "*.slack.com"
  add-labels:
    target: "${{ github.event.issue.number }}"
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
      - "Team:SKI"
      - "Team:Projects"
      - "cross-team"
    max: 6
  remove-labels:
    target: "${{ github.event.issue.number }}"
    allowed:
      - "needs-team"
    max: 1
  add-comment:
    target: "${{ github.event.issue.number }}"
    max: 1
  update-issue:
    body:
    max: 1
    target: "${{ github.event.issue.number }}"

timeout-minutes: 15
---

This run was triggered automatically because the issue was just opened. There are no comments
yet — gather context from the body alone.

The triggering issue number is `${{ github.event.issue.number }}`. When calling `update_issue`,
always pass `issue_number: ${{ github.event.issue.number }}`.

If the issue was opened by a bot (the actor name ends in `[bot]`), emit a `noop` immediately
and do not triage.

There is no triggering comment on this run, so phase 0 (undo check) is not applicable — skip
it and proceed from phase 1. Apply the rewrite guard in phase 4: only rewrite the body when
the outcome is "needs refinement" AND the body contains enough author-supplied information to
rewrite without inventing facts.

${{ inputs.additional-instructions }}
