# Docs source sync

Digests merged pull requests and commits from one or more source repositories over a lookback window, then opens a draft PR that updates docs in a target repository. The workflow has no fixed repository names — the caller configures everything.

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

Edit the `sync` job's `with:` block to set your own `source-repos`, `target-repo`, `docs-root`, and `repo-path-mapping`.

### Token

This workflow takes a token as a `secrets.github_token` input instead of using the ambient `GITHUB_TOKEN`, because it usually needs read access to repositories other than the one it runs in. The example fetches an ephemeral token via [`elastic/ci-gh-actions/fetch-github-token`](https://github.com/elastic/ci-gh-actions/tree/main/fetch-github-token):

- Add `permissions.id-token: write` on the token-fetch job, as shown in `example.yml`.
- Set up a TokenPolicy (in `elastic/catalog-info`) that grants the ephemeral token read access to every `source-repos` entry and contents + pull-requests write access to `target-repo`.

A classic PAT with equivalent scopes also works if your organization does not use `fetch-github-token`.

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
| `noop` | — | Used when the digests are empty or every change is internal-only. |
| `create-pull-request` | 1 | Draft by default, labeled `automation`, `docs-sync`, opened against `target-repo`. |

Default [protected files](https://github.com/github/gh-aw/blob/main/docs/src/content/docs/reference/safe-outputs-pull-requests.md#protected-files) (lockfiles, `README.md`, `CODEOWNERS`, and similar) still apply — edits to those trigger a review request instead of landing directly, even though this workflow does not set an `allowed-files` restriction.

## How it works

1. **Pre-step** — validates `source-repos`, resolves the lookback window, and writes one digest per source repo (merged PRs via the GitHub search API, commits via the commits API) plus an `index.md` summary to `/tmp/gh-aw/docs-source-sync/`.
2. **Agent** — reads the digests, classifies each change as ignore / update / add / delete-or-rewrite, maps it to a docs path using `repo-path-mapping` (or infers one), and either opens a PR or calls `noop`.

The agent writes new and changed prose in [Simplified Technical English](../../.github/workflows/gh-aw-fragments/ste-100.md), and does not rewrite existing prose only to conform to that standard.

## Repo → docs mapping

- With `repo-path-mapping` set, the agent uses it first and prefers an existing page under a listed path over a new one.
- Without it, the agent inventories `docs-root`, matches each change to the closest existing page by topic, and prefers updating that page over adding a new one.

## Example: weekly docs-eng-team sync

`example.yml` configures this workflow to run every Monday, pulling changes from `elastic/docs-builder`, `elastic/docs-infra`, and `elastic/docs-internal-workflows` into `elastic/docs-eng-team`'s `docs/` tree. Copy it as-is, or change the `with:` block to point at different repositories.
