# Docs source sync

Digests merged pull requests and commits from one or more source repositories over a lookback window, then opens a draft PR that updates docs in a target repository. The workflow has no fixed repository names — the caller configures everything.

## Intended audience: internal engineering docs

The editorial guidance in the agent prompt targets an **internal engineering handbook**: runbooks, on-call procedures, architecture notes, environment and access details, and build or deployment guides. The reader it writes for is a teammate, not a customer.

This matters, because the filter is the opposite of the one a product-docs sync would use. A CI change, an infrastructure refactor, or a workflow rename is treated as subject matter, not as churn to skip, whenever the handbook documents that system.

If you point this workflow at public product documentation, override the guidance through `additional-instructions`. The agent also checks the visibility of `target-repo` and refuses to copy private-source detail — internal hostnames, infrastructure topology, incident detail, internal-only URLs — into a public target.

## Triggers

| Event | Description |
|-------|-------------|
| `workflow_call` | Called from a caller workflow that supplies inputs and a token |

The example below wires this up behind a weekly `schedule` plus a manual `workflow_dispatch`, but any caller trigger works.

## Install

```bash
mkdir -p .github/workflows && curl -sL \
  https://raw.githubusercontent.com/elastic/docs-actions/v1/agentic-workflows/docs-source-sync/example.yml \
  -o .github/workflows/docs-source-sync.yml
```

Edit the `sync` job's `with:` block to set your own `source-repos`, `docs-root`, and `repo-path-mapping`. Leave `target-repo` empty so the PR opens in the calling repository.

### Token

The handbook PR is opened with the caller `GITHUB_TOKEN`. Set `contents: write` and `pull-requests: write` on the caller, as shown in `example.yml`. The `target-repo` must be the calling repository.

The workflow also takes a `secrets.source_sync_token` input to read source repositories other than the caller. The example fetches an ephemeral token via [`elastic/ci-gh-actions/fetch-github-token`](https://github.com/elastic/ci-gh-actions/tree/main/fetch-github-token):

- Add `permissions.id-token: write` on the token-fetch job, as shown in `example.yml`.
- Set up a TokenPolicy (in `elastic/catalog-info`) that grants the ephemeral token **read** access to every `source-repos` entry (`contents`, `pull_requests`, and `issues`). The token does not need write access, and it does not need access to the calling repository.

A classic PAT with equivalent **read** scopes also works if your organization does not use `fetch-github-token`.

## Inputs

| Input | Default | Description |
|-------|---------|-------------|
| `source-repos` | *(required)* | Comma-separated `owner/repo` list to scan for changes. |
| `lookback-window` | `7 days ago` | How far back to look, as a `date -d`-parsable expression. |
| `target-repo` | `""` → calling repository | Docs repository that receives the PR. |
| `docs-root` | `docs/` | Docs root directory inside `target-repo`. |
| `repo-path-mapping` | `""` | Multiline `source-repo -> docs-root-relative paths` mapping. Empty means the agent infers a mapping from the existing docs layout. |
| `title-prefix` | `docs: source sync — ` | Prefix for the created PR title. |
| `draft-prs` | `true` | Open the PR as a draft. |
| `additional-instructions` | `""` | Extra instructions appended to the agent prompt. |
| `setup-commands` | `""` | Shell commands to run before the agent starts. |

## Safe outputs

| Output | Max | Notes |
|--------|-----|-------|
| `noop` | — | Used when the digests are empty, or when no change affects what the docs describe. |
| `create-pull-request` | 1 | Draft by default, labeled `automation`, `docs-sync`, opened against `target-repo`. |

Default [protected files](https://github.com/github/gh-aw/blob/main/docs/src/content/docs/reference/safe-outputs-pull-requests.md#protected-files) (lockfiles, `README.md`, `CODEOWNERS`, and similar) still apply — edits to those trigger a review request instead of landing directly, even though this workflow does not set an `allowed-files` restriction.

## How it works

1. **Pre-step** — validates `source-repos`, resolves the lookback window, and writes one digest per source repo (merged PRs via the GitHub search API, commits via the commits API) plus an `index.md` summary to `/tmp/gh-aw/docs-source-sync/`.
2. **Agent** — reads the digests, classifies each change as ignore / update / fix-procedure / add / delete-or-rewrite, maps it to a docs path using `repo-path-mapping` (or infers one), and either opens a PR or calls `noop`.

A change is only ignored when it has no observable effect on how the team builds, runs, deploys, or operates the system. Broken runbook steps are treated as defects in their own right, even when the rest of the page is correct.

The agent writes new and changed prose in [Simplified Technical English](../../.github/workflows/gh-aw-fragments/ste-100.md), and does not rewrite existing prose only to conform to that standard.

## Repo → docs mapping

- With `repo-path-mapping` set, the agent uses it first and prefers an existing page under a listed path over a new one.
- Without it, the agent inventories `docs-root`, matches each change to the closest existing page by topic, and prefers updating that page over adding a new one.

## Example: weekly docs-eng-team sync

`example.yml` configures this workflow to run every Monday, and on manual `workflow_dispatch`, pulling changes from `elastic/docs-builder`, `elastic/docs-infra`, `elastic/docs-internal-workflows`, `elastic/docs-actions`, `elastic/codex-environments`, and `elastic/codex-link-index` into the calling repository's handbook under `docs/`. Copy it into `elastic/docs-eng-team`, or change the `with:` block to point at different repositories.

The mapping in the example follows the handbook's own layout:

| Source repo | Docs paths |
|-------------|-----------|
| `elastic/docs-builder` | `build-system/`, `getting-started/` |
| `elastic/docs-infra` | `infrastructure/`, `operations/` |
| `elastic/docs-internal-workflows` | `content-pipeline/`, `release-notes/` |
| `elastic/docs-actions` | `github-actions/` |
| `elastic/codex-environments` | `getting-started/`, `infrastructure/` |
| `elastic/codex-link-index` | `build-system/` |
