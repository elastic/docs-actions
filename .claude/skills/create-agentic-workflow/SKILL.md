---
name: create-agentic-workflow
version: 1.0.0
description: Scaffold a new gh-aw agentic workflow in docs-actions. Use when the user wants to add a new agentic workflow, create a docs automation, or build a new scheduled audit/fix workflow for Elastic documentation.
disable-model-invocation: true
argument-hint: <workflow-name>
allowed-tools: Read, Write, Bash(mkdir *), Bash(ls *), Glob, Grep, AskUserQuestion
---
<!-- Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
or more contributor license agreements. See the NOTICE file distributed with
this work for additional information regarding copyright
ownership. Elasticsearch B.V. licenses this file to you under
the Apache License, Version 2.0 (the "License"); you may
not use this file except in compliance with the License.
You may obtain a copy of the License at

	http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing,
software distributed under the License is distributed on an
"AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
KIND, either express or implied.  See the License for the
specific language governing permissions and limitations
under the License. -->

You are a workflow generator for the [elastic/docs-actions](https://github.com/elastic/docs-actions) repository. Your job is to scaffold a new gh-aw agentic workflow by creating the three required files and guiding the user through customization.

## Background

This repo uses [GitHub Agent Workflows](https://github.github.com/gh-aw/). Workflow `.md` sources live in `agentic-workflows/` as a library. A compile script copies them to `.github/workflows/` for the gh-aw compiler, which produces `.lock.yml` files that consumer repos call via `uses:`.

Each workflow needs three files:
1. `agentic-workflows/<name>/gh-aw-<name>.md` — workflow source (frontmatter + prompt)
2. `agentic-workflows/<name>/example.yml` — trigger template callers copy
3. `agentic-workflows/<name>/README.md` — usage documentation

## Process

### Step 1: Understand the purpose

If the user provided a name via `$ARGUMENTS`, acknowledge it. Either way, ask: **"What should this workflow do? Describe the documentation task it automates."**

Wait for a clear answer. If vague, ask follow-ups until you understand:
- What problem the workflow solves
- What it analyzes or produces
- When it should run (schedule, slash command, PR events, manual dispatch)

### Step 2: Collect details

Use `AskUserQuestion` to collect:

1. **Workflow name**: kebab-case (e.g., `docs-quality`, `docs-seo`). Suggest one based on the purpose. The compiled file will be `gh-aw-<name>.lock.yml`.
2. **Pattern**: Which base pattern?
   - **Scheduled Audit** — finds problems, creates issues (imports `scheduled-report.md`, safe output: `create-issue`)
   - **Scheduled Fix** — finds problems, creates PRs (safe output: `create-pull-request`)
   - **On-demand Check** — triggered by slash command or label, posts a comment (safe output: `add-comment`)
   - **Custom** — none of the above
3. **Trigger events**: schedule (cron), slash command, label, workflow_dispatch, PR events?
4. **MCP servers**: Does it need the Elastic Docs MCP server (`elastic-docs`)? Other MCP servers?
5. **Tools**: Which tools? Default: `github` (toolsets: repos, issues, pull_requests, search), `bash`, `web-fetch`

### Step 3: Generate the workflow source

Read an existing workflow for reference:
- `agentic-workflows/docs-check/gh-aw-docs-check.md` — on-demand check pattern

Generate `agentic-workflows/<name>/gh-aw-<name>.md` with proper frontmatter:

```yaml
---
description: |
  <one-line description>

imports:
  - gh-aw-fragments/docs-tools.md
  - gh-aw-fragments/formatting.md
  - gh-aw-fragments/rigor.md
  - gh-aw-fragments/mcp-pagination.md
  - gh-aw-fragments/messages-footer.md
  - gh-aw-fragments/safe-output-<type>.md
engine:
  id: copilot
on:
  roles: [admin, maintainer, write]
  <triggers...>
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
        description: "Footer appended to all agent comments and reviews"
        type: string
        required: false
        default: ""
    secrets:
      COPILOT_GITHUB_TOKEN:
        required: true
concurrency:
  group: <name>
  cancel-in-progress: true
permissions:
  contents: read
  issues: read
  pull-requests: read
tools:
  github:
    toolsets: [repos, issues, pull_requests, search]
  bash: true
  web-fetch:
network:
  allowed:
    - defaults
    - github
    - "www.elastic.co"
strict: false
safe-outputs:
  noop:
  <output-type>:
timeout-minutes: 30
steps:
  - name: Repo-specific setup
    if: ${{ inputs.setup-commands != '' }}
    env:
      SETUP_COMMANDS: ${{ inputs.setup-commands }}
    run: eval "$SETUP_COMMANDS"
---
```

Follow the frontmatter with the agent prompt in markdown. Structure it as:
1. **Role statement** — who the agent is and what it does
2. **Data gathering** — what to read, search, or fetch
3. **Analysis** — what to look for, how to evaluate findings
4. **What to skip** — explicit exclusions to reduce noise
5. **Quality gate** — when to noop vs. when to report (noop is the expected outcome)
6. **Output format** — exact format for the issue body, PR body, or comment

End with `${{ inputs.additional-instructions }}` so callers can inject repo-specific guidance.

### Step 4: Generate the trigger template

Create `agentic-workflows/<name>/example.yml`:

```yaml
name: <Display Name>
on:
  <event triggers based on step 2>

permissions:
  <minimum required permissions>

jobs:
  run:
    uses: elastic/docs-actions/.github/workflows/gh-aw-<name>.lock.yml@v1
    secrets:
      COPILOT_GITHUB_TOKEN: ${{ secrets.COPILOT_GITHUB_TOKEN }}
```

For scheduled audits, add `issues: write` to permissions. For fixes, add `contents: write` and `pull-requests: write`.

### Step 5: Generate the README

Create `agentic-workflows/<name>/README.md` following the pattern in `agentic-workflows/docs-check/README.md`:
- Description
- Triggers table
- Install section with curl one-liner
- Inputs table (standard inputs + any workflow-specific ones)
- Safe outputs table
- Example YAML with `additional-instructions`

### Step 6: Review with the user

Present all three files and ask: **"Does this look right? Want me to change anything?"**

Iterate until the user is happy.

### Step 7: Next steps

Tell the user:

> Run `make compile` to generate the `.lock.yml` file, then commit the source files and the generated lock file together.

Also remind them to update `agentic-workflows/README.md` to add the new workflow to the table.
