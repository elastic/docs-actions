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
  group: gh-aw-issue-triage-${{ github.event.issue.number || github.event.pull_request.number || github.run_id }}
  cancel-in-progress: true
  job-discriminator: ${{ github.event.issue.number || github.event.pull_request.number || github.run_id }}

permissions:
  actions: write
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
  - name: Prepare triage undo from edit history
    env:
      COMMENT_BODY: ${{ github.event.comment.body || '' }}
      GH_TOKEN: ${{ github.token }}
      ISSUE_NUMBER: ${{ github.event.issue.number || 0 }}
      REPOSITORY: ${{ github.repository }}
    run: |
      if [[ "$COMMENT_BODY" != /triage\ undo* ]]; then
        exit 0
      fi

      mkdir -p /tmp/gh-aw/agent

      query='query($owner: String!, $name: String!, $number: Int!) {
        repository(owner: $owner, name: $name) {
          issue(number: $number) {
            userContentEdits(first: 100) {
              nodes {
                editedAt
                editor {
                  login
                }
                diff
              }
            }
          }
        }
      }'

      owner="${REPOSITORY%%/*}"
      name="${REPOSITORY#*/}"
      response_path="/tmp/gh-aw/agent/triage-undo-edits.json"
      gh api graphql \
        -f query="$query" \
        -f owner="$owner" \
        -f name="$name" \
        -F number="$ISSUE_NUMBER" > "$response_path"

      node <<'NODE'
      const fs = require('fs');

      const responsePath = '/tmp/gh-aw/agent/triage-undo-edits.json';
      const bodyPath = '/tmp/gh-aw/agent/triage-undo-original-body.md';
      const metadataPath = '/tmp/gh-aw/agent/triage-undo-original-body.json';
      const response = JSON.parse(fs.readFileSync(responsePath, 'utf8'));
      const edits = response?.data?.repository?.issue?.userContentEdits?.nodes ?? [];
      const sorted = edits
        .filter((edit) => typeof edit.diff === 'string' && edit.diff.trim().length > 0)
        .sort((a, b) => new Date(a.editedAt) - new Date(b.editedAt));

      const selected =
        sorted.find((edit) => edit.editor?.login !== 'github-actions') ??
        sorted[0];

      if (!selected) {
        process.exit(0);
      }

      fs.writeFileSync(bodyPath, selected.diff, 'utf8');
      fs.writeFileSync(
        metadataPath,
        JSON.stringify(
          {
            editedAt: selected.editedAt,
            editor: selected.editor?.login ?? null,
            source: 'github-user-content-edits',
          },
          null,
          2,
        ),
        'utf8',
      );
      NODE

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
      - "Team:Experience"
      - "Team:Ingest"
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
    hide-older-comments: true
  update-issue:
    body:
    max: 1
    target: "${{ github.event.issue.number }}"
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
