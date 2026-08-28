---
description: |
  Reusable workflow that digests recent changes (merged PRs and commits) from
  one or more caller-configured source repositories and opens a draft PR that
  updates docs in a caller-configured target repository. The editorial guidance
  targets internal engineering handbooks: runbooks, architecture notes, and
  operational procedures for the team that builds the source repositories.
  Callers pass an ephemeral GitHub token to read source repos. The handbook
  PR is opened with the caller GITHUB_TOKEN, so the target must be the
  calling repository. No repository names are baked in.

inlined-imports: true
imports:
  - gh-aw-fragments/ste-100.md
model: claude-sonnet-5
engine:
  id: copilot
on:
  bots: ["github-actions[bot]"]
  workflow_call:
    inputs:
      source-repos:
        description: "Comma-separated owner/repo list to scan for changes"
        type: string
        required: true
      lookback-window:
        description: "How far back to look for changes, as a `date -d`-parsable expression"
        type: string
        required: false
        default: "7 days ago"
      target-repo:
        description: "Docs repository that receives the PR (owner/repo). Empty means the calling repository. Must be the calling repository, because create-pull-request uses GITHUB_TOKEN."
        type: string
        required: false
        default: ""
      docs-root:
        description: "Docs root directory inside the target repo"
        type: string
        required: false
        default: "docs/"
      repo-path-mapping:
        description: "Optional multiline mapping of 'source-repo -> docs-root-relative paths'. Empty means infer from the existing docs layout."
        type: string
        required: false
        default: ""
      title-prefix:
        description: "Prefix for created PR titles"
        type: string
        required: false
        default: "docs: source sync — "
      draft-prs:
        description: "Open the PR as a draft"
        type: boolean
        required: false
        default: true
      additional-instructions:
        description: "Extra instructions appended to the agent prompt"
        type: string
        required: false
        default: ""
      setup-commands:
        description: "Shell commands to run before the agent starts"
        type: string
        required: false
        default: ""
    secrets:
      source_sync_token:
        description: "Token for reading source repos (merged PRs and commits). Pass an ephemeral token, for example from elastic/ci-gh-actions/fetch-github-token. The handbook PR uses GITHUB_TOKEN."
        required: true
concurrency:
  group: gh-aw-docs-source-sync-${{ github.run_id }}
  cancel-in-progress: false
permissions:
  contents: read
  pull-requests: read
  issues: read
  copilot-requests: write
strict: false
checkout:
  - repository: ${{ inputs.target-repo || github.repository }}
    fetch-depth: 0
    current: true
tools:
  github:
    github-token: ${{ secrets.source_sync_token }}
    toolsets: [repos, pull_requests, search, issues]
  bash:
    - "cat *"
    - "ls *"
    - "find *"
    - "jq *"
    - "yq *"
  web-fetch:
network:
  allowed:
    - defaults
    - github
    - "docs-v3-preview.elastic.dev"
    - "elastic.co"
    - "ela.st"
    - "docs.bump.sh"
    - "search.elastic.co"
safe-outputs:
  noop:
  create-pull-request:
    title-prefix: ${{ inputs.title-prefix }}
    labels: [automation, docs-sync]
    draft: ${{ inputs.draft-prs }}
    max: 1
    if-no-changes: ignore
    target-repo: ${{ inputs.target-repo || github.repository }}
timeout-minutes: 30
steps:
  - name: Digest source repo changes
    env:
      GH_TOKEN: ${{ secrets.source_sync_token }}
      SOURCE_REPOS: ${{ inputs.source-repos }}
      LOOKBACK_WINDOW: ${{ inputs.lookback-window }}
      REPO_PATH_MAPPING: ${{ inputs.repo-path-mapping }}
    run: |
      set -eu
      mkdir -p /tmp/gh-aw/docs-source-sync

      if [ -z "$(printf '%s' "$SOURCE_REPOS" | tr -d '[:space:]')" ]; then
        echo "source-repos is empty; at least one owner/repo is required"
        exit 1
      fi

      SINCE_DATE=$(date -u -d "$LOOKBACK_WINDOW" +%Y-%m-%d)
      SINCE_ISO=$(date -u -d "$LOOKBACK_WINDOW" +%Y-%m-%dT%H:%M:%SZ)

      printf '%s' "$REPO_PATH_MAPPING" > /tmp/gh-aw/docs-source-sync/repo-path-mapping.txt

      {
        echo "# Source digests (since $SINCE_DATE)"
        echo
      } > /tmp/gh-aw/docs-source-sync/index.md

      printf '%s' "$SOURCE_REPOS" | tr ',' '\n' > /tmp/gh-aw/docs-source-sync/repos.raw

      TOTAL_CHANGES=0

      while IFS= read -r raw || [ -n "$raw" ]; do
        repo=$(printf '%s' "$raw" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')
        [ -z "$repo" ] && continue

        slug=$(printf '%s' "$repo" | tr '/' '-')
        digest="/tmp/gh-aw/docs-source-sync/${slug}.md"

        PRS_JSON=$(gh api search/issues --method GET -f "q=repo:$repo is:pr is:merged merged:>=$SINCE_DATE" -f per_page=50 2>/dev/null || echo '{"items":[]}')
        PR_COUNT=$(printf '%s' "$PRS_JSON" | jq '.items | length')

        COMMITS_JSON=$(gh api "repos/$repo/commits?since=$SINCE_ISO&per_page=100" 2>/dev/null || echo '[]')
        COMMIT_COUNT=$(printf '%s' "$COMMITS_JSON" | jq 'length' 2>/dev/null || echo 0)

        {
          echo "# $repo — changes since $SINCE_DATE"
          echo
          echo "## Merged pull requests ($PR_COUNT)"
          if [ "$PR_COUNT" -gt 0 ]; then
            printf '%s' "$PRS_JSON" | jq -r '.items[] | "- #\(.number) \(.title) (closed \(.closed_at)) \(.html_url)"'
          else
            echo "- none"
          fi
          echo
          echo "## Commits since $SINCE_DATE ($COMMIT_COUNT)"
          if [ "$COMMIT_COUNT" -gt 0 ]; then
            printf '%s' "$COMMITS_JSON" | jq -r '.[] | "- \(.sha[0:7]) \(.commit.message | split("\n")[0]) \(.html_url)"'
          else
            echo "- none"
          fi
        } > "$digest"

        echo "- [$repo]($slug.md): $PR_COUNT merged PRs, $COMMIT_COUNT commits" >> /tmp/gh-aw/docs-source-sync/index.md
        TOTAL_CHANGES=$(( TOTAL_CHANGES + PR_COUNT + COMMIT_COUNT ))
      done < /tmp/gh-aw/docs-source-sync/repos.raw

      if [ "$TOTAL_CHANGES" -eq 0 ]; then
        echo "empty" > /tmp/gh-aw/docs-source-sync/empty.marker
      fi

      echo "Digest complete: total_changes=$TOTAL_CHANGES since=$SINCE_DATE"
      cat /tmp/gh-aw/docs-source-sync/index.md

  - name: Repo-specific setup
    if: ${{ inputs.setup-commands != '' }}
    env:
      SETUP_COMMANDS: ${{ inputs.setup-commands }}
    run: eval "$SETUP_COMMANDS"
---

# Docs source sync agent

You keep an internal engineering handbook up to date with what changed recently in the repositories that the team builds and operates. You work from pre-fetched digests, not live scanning. You open at most one PR per run.

The reader is a teammate, not a customer. That teammate is onboarding, changing the build, deploying, or on call. The handbook holds runbooks, architecture notes, environment and access details, and operational procedures.

## Pre-fetched data

- `/tmp/gh-aw/docs-source-sync/index.md` — one line per source repo with merged-PR and commit counts.
- `/tmp/gh-aw/docs-source-sync/<owner>-<repo>.md` — one digest per source repo: merged pull requests and commits since the lookback window, with links.
- `/tmp/gh-aw/docs-source-sync/repo-path-mapping.txt` — optional caller-supplied mapping from source repo to preferred docs paths. May be empty.
- `/tmp/gh-aw/docs-source-sync/empty.marker` — present only when every digest was empty.

The target repository is checked out at the workspace root. The docs live under `${{ inputs.docs-root }}`.

If `/tmp/gh-aw/docs-source-sync/empty.marker` exists, call `noop` with the message `"No source changes since <since date>"` and stop.

## Step 1: Read the digests

Read `index.md`, then each per-repo digest file. For each merged PR and commit, decide whether it is documentation-relevant using the decision framework below. Use the GitHub tools to open a specific PR or commit only when the digest title and message do not give you enough information to decide.

## Step 2: Decision framework

Judge every change by one question: after this change, would a teammate who follows the page do the wrong thing, or fail to do the right thing?

This filter is not the one used for product documentation. A CI change, an infrastructure refactor, or a workflow rename is not internal churn to skip. It is the subject matter whenever the handbook documents that system.

1. **Ignore** a change only when it has no observable effect on how the team builds, runs, deploys, or operates the system. Examples: test-only changes, pure code cleanups, and dependency bumps that alter no command, config key, or documented behavior.
2. **Update** when a page describes a command, flag, config key, path, workflow name, environment, or permission that the change altered.
3. **Fix procedures** when a change breaks a step in a runbook, an on-call procedure, or a setup guide. A step that no longer works is a defect, even when the rest of the page is correct.
4. **Add** when the change introduces a service, environment, workflow, or procedure that the team must know about, and no page covers it.
5. **Delete or rewrite** when a change removes or renames something the docs still describe.

## Step 3: Map changes to docs paths

Read `/tmp/gh-aw/docs-source-sync/repo-path-mapping.txt`.

- If it is non-empty, use it first. Each line has the form `source-repo -> path, path (optional note)`. Prefer an existing page under one of the listed paths over creating a new page.
- If it is empty, infer the mapping yourself:
  1. Inventory the pages under `${{ inputs.docs-root }}`.
  2. Match each relevant change to the closest existing page by topic.
  3. Prefer updating an existing page over adding a new one.

## Step 4: Quality bar

Call `noop` when the digests are empty, or when no change affects what the handbook describes.

Open a PR only when a teammate would act on wrong information. Ask whether someone onboarding, deploying, or on call would be sent down the wrong path by the current text.

Skip speculative rewrites, wholesale copies of source-repo READMEs, and unreleased or speculative behavior.

Do not rewrite an existing page only to apply the Simplified Technical English writing standard above. Apply it to the **new and changed prose** this sync introduces. Leave unrelated paragraphs alone unless the changeset makes them factually wrong.

## Internal docs rules

The target docs are internal to the team. Apply these rules:

- Link internal resources when they help a teammate: internal repositories, workflow files, runbooks, and dashboards.
- Record the operational detail a teammate needs: exact commands, workflow names, environment names, and required permissions.
- Never write a credential, token, private key, or customer record into a page. Name the secret store instead.
- Do not add a marketing-style overview. State the purpose in one or two sentences, then give the procedure.

### Check the visibility of the target repository

Read the visibility of the target repository before you write.

If the target repository is public, do not copy any detail that appears only in a private source repository. This includes internal hostnames, infrastructure topology, incident detail, private repository paths, and internal-only URLs. Describe the change in general terms, or call `noop` and say what you withheld.

## Other edit rules

- Write docs-builder Markdown. See the [syntax reference](https://docs-v3-preview.elastic.dev/elastic/docs-builder/tree/main/syntax) for directives, admonitions, and frontmatter.
- Cite the source PRs or commits that justify each change in the PR body.
- Touch only paths under `${{ inputs.docs-root }}`.
- Update `docset.yml` or `_docset.yml` when you add or remove a page.
- Do not reorganize the existing table of contents. Some directories are absent from it on purpose.

## PR shape

- Title: `${{ inputs.title-prefix }}<YYYY-MM-DD>`.
- Body sections, in this order: Summary, Sources reviewed, Docs changes, Skipped changes, Test plan. Write the body in Simplified Technical English too.
- "Sources reviewed" lists every source repo from `index.md`, even ones with no resulting change.
- "Skipped changes" briefly says why you skipped anything a teammate might expect to see addressed.

## Done when

- You called `create_pull_request` with docs changes justified by the digests, or
- You called `noop` because the digests were empty, or because no change affected what the handbook describes.

${{ inputs.additional-instructions }}
