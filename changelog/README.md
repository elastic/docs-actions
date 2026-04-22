# Changelog automation

Automatically generate and submit changelog entries for pull requests.

When a PR is opened or labeled, the system validates the PR metadata, then generates a changelog YAML file based on the PR title and type label, commits it to the PR branch, and posts a comment with a link to view or edit the entry.

## Setup

### 1. Add the changelog configuration

Create `docs/changelog.yml` in your repository by running `docs-builder changelog init`.

By default, you will get a file with this structure:

```yaml
pivot:
  types:
    enhancement:
      labels:
        - enhancement
        - feature
    bug:
      labels:
        - bug
    breaking:
      labels:
        - breaking
    deprecation:
      labels:
        - deprecation
```

Each key under `pivot.types` is a changelog type. The `labels` list defines which GitHub labels map to that type. When a PR has one of these labels, the changelog entry is categorized accordingly.

### 2. Create the workflows

Add two workflow files to your repository:

**`.github/workflows/changelog-validate.yml`**

```yaml
name: changelog-validate

on:
  pull_request:
    types:
      - opened
      - synchronize
      - reopened
      - edited
      - labeled
      - unlabeled

permissions:
  contents: read

jobs:
  validate:
    uses: elastic/docs-actions/.github/workflows/changelog-validate.yml@v1
```

**`.github/workflows/changelog-submit.yml`**

```yaml
name: changelog-submit

on:
  workflow_run:
    workflows: [changelog-validate]
    types:
      - completed

permissions:
  contents: write
  pull-requests: write

jobs:
  submit:
    uses: elastic/docs-actions/.github/workflows/changelog-submit.yml@v1
```

If your changelog configuration is not at `docs/changelog.yml`, pass the path explicitly to both workflows:

```yaml
# In the validate job:
jobs:
  validate:
    uses: elastic/docs-actions/.github/workflows/changelog-validate.yml@v1
    with:
      config: path/to/changelog.yml

# In the submit job:
jobs:
  submit:
    uses: elastic/docs-actions/.github/workflows/changelog-submit.yml@v1
    with:
      config: path/to/changelog.yml
```

> **Important:** The `name` in the validate workflow (`changelog-validate`) must match the `workflows:` reference in the submit workflow. If you rename one, rename the other.

The two-workflow design separates trust boundaries. The validate workflow runs with read-only permissions in the PR context, acting as a lightweight gate. The submit workflow runs with write permissions via `workflow_run` (which uses the base branch's permissions) and performs all generation and commit operations in a trusted context. This follows the [standard pattern](https://securitylab.github.com/research/github-actions-preventing-pwn-requests/) for safely handling PR branches, including those from forks.

### 3. Create the labels

Make sure the GitHub labels referenced in your `docs/changelog.yml` exist in your repository. You can control which PRs generate changelog entries using `rules.create` in your config -- either by excluding PRs with certain labels or by requiring specific labels to be present. For details, see [Rules for creation and publishing](https://elastic.github.io/docs-builder/contribute/changelog/#rules-for-creation-and-publishing).

## How it works

```
PR opened/labeled/title edited
       │
       v
validate workflow (read-only, lightweight gate)
       │
       ├── runs docs-builder changelog evaluate-pr
       │     with PR-event-specific context (event action, title changes)
       │
       ├── pass (exit 0): proceed, skipped, manually-edited
       └── fail (exit 1): no-label, no-title, error

       │ (any conclusion except cancelled)
       v
submit workflow (write permissions, via workflow_run)
       │
       ├── resolves PR number from workflow_run context
       ├── fetches current PR data (title, labels, state) from API
       ├── checks out PR branch (or base repo for forks)
       ├── reads changelog config from base branch
       ├── verifies checkout SHA matches expected head
       │
       ├── re-runs docs-builder changelog evaluate-pr
       │     (without event-specific flags — gate already handled those)
       │
       ├── if "proceed":
       │     ├── runs docs-builder changelog add
       │     ├── commits changelog file to PR branch
       │     └── posts PR comment with view/edit links
       │
       ├── if "no-label":
       │     └── posts PR comment listing available type labels and skip labels
       │
       └── otherwise (skipped, manually-edited): no-op
```

The evaluate logic runs twice — once as a gate (with event-specific checks like body-only edit and bot-loop detection), and once in the trusted submit context to drive behavior. This is intentional: the second evaluation uses fresh PR data from the API, so it correctly handles label or title changes between the two runs. The submit workflow runs for any non-cancelled validate conclusion, so it can post actionable feedback (e.g., listing available labels) even when validate fails.

### Comment-only mode

If you prefer not to have bot commits on your PR branches, pass `comment-only: true` to the submit workflow. The changelog content will be posted as a PR comment instead:

```yaml
jobs:
  submit:
    uses: elastic/docs-actions/.github/workflows/changelog-submit.yml@v1
    with:
      comment-only: true
```

Fork PRs automatically use comment-only mode since the workflow token cannot push to fork branches.

## Skipping changelog generation

Configure `rules.create` in your `docs/changelog.yml` to control which PRs generate changelog entries. For example, to skip PRs with a `changelog:skip` label:

```yaml
rules:
  create:
    exclude: "changelog:skip"
```

When all products are blocked by the create rules, the validate action passes with `skipped` status (so CI stays green) and the submit action exits without generating. If no matching type label is found (including when labels exist but none correspond to a configured type or skip rule), validate fails with `no-label` and submit posts a comment listing the available type labels and skip labels (if configured), so contributors know how to opt out of changelog generation. You can also use `include` mode or per-product overrides. See [Rules for creation and publishing](https://elastic.github.io/docs-builder/contribute/changelog/#rules-for-creation-and-publishing) for the full reference.

## Manual edits

If a human edits the changelog file directly (i.e., the last commit to the changelog file is not from `github-actions[bot]`), the automation will not overwrite it. This lets authors customize the generated entry without it being regenerated on the next push.

## Output

Each PR produces a file at `docs/changelog/{filename}.yaml` on the PR branch (where the filename is determined by the `docs-builder changelog add` command). These files are consumed by `docs-builder` during documentation builds to produce a rendered changelog page.

## Uploading to S3

Changelog files on the default branch can be uploaded to the `elastic-docs-v3-changelog-bundles` S3 bucket under `{product}/changelogs/{filename}.yaml`, preserving the original filename as determined by the repository's `filename` strategy in `changelog.yml`. This makes them available for release bundling workflows.

### 1. Add the upload workflow

**`.github/workflows/changelog-upload.yml`**

```yaml
name: changelog-upload

on:
  push:
    branches: [main, master]
    paths:
      - 'docs/changelog/**'
      - 'docs/changelog.yml'

permissions: {}

jobs:
  upload:
    uses: elastic/docs-actions/.github/workflows/changelog-upload.yml@v1
```

The `paths` filter is optional — it avoids running the workflow on pushes that don't touch changelog files. If your changelog directory or config lives elsewhere, adjust the paths accordingly.

If your changelog configuration is not at `docs/changelog.yml`, pass the path explicitly:

```yaml
jobs:
  upload:
    uses: elastic/docs-actions/.github/workflows/changelog-upload.yml@v1
    with:
      config: path/to/changelog.yml
```

### 2. Enable OIDC access

The upload workflow authenticates to AWS via GitHub Actions OIDC. Your repository must be listed in the `elastic-docs-v3-changelog-bundles` infrastructure to have an IAM role provisioned. Contact the docs-engineering team to add your repository.

### How it works

On each push to `main` or `master`, the upload workflow:

1. Checks out the pushed commit
2. Sets up `docs-builder` and authenticates with AWS via OIDC
3. Runs `docs-builder changelog upload`, which reads your `changelog.yml`, discovers changelog YAML files in the configured directory, and incrementally uploads them to `{product}/changelogs/{filename}.yaml` in the bucket — only files whose content has changed are transferred

If the changelog directory has no files (for example, because changelog generation was skipped), the command exits silently without error.

The workflow uses a per-repository concurrency group so that rapid successive pushes queue rather than run in parallel. If a run is already in progress when a new push arrives, the in-progress run completes before the next one starts. Since `docs-builder` performs incremental uploads (skipping unchanged objects), re-runs are cheap.

> **Note:** The composite action accepts an `aws-account-id` input (default: the Elastic docs account). Overriding this is only valid when OIDC trust and IAM roles have been provisioned for the target account. In practice, most repositories should use the default.

> **Note:** The `github-token` input defaults to the workflow's `GITHUB_TOKEN`, which is scoped to the job's declared permissions. Do not substitute a broader PAT unless `docs-builder/setup` explicitly requires it.
