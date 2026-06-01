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

permissions: {}

jobs:
  validate:
    permissions:
      contents: read  # docs-builder reads changelog config from the PR
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

permissions: {}

jobs:
  submit:
    permissions:
      contents: write       # commit the generated changelog file to the PR branch
      pull-requests: write  # post the changelog comment on the PR
      id-token: write       # OIDC token for the org-membership check on fork PRs
      packages: read        # pull the docs-builder edge image from GHCR
    uses: elastic/docs-actions/.github/workflows/changelog-submit.yml@v1
```

> **Important:** All four permissions above are required. The calling job's `permissions:` block is the ceiling for the reusable workflow — its jobs internally request these scopes and the call is rejected at validation time if any are omitted, with errors like `is requesting 'id-token: write', but is only allowed 'id-token: none'`. Keeping `permissions: {}` at the workflow level ensures unrelated jobs in the same caller file don't get these scopes.

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

### Fork PRs

Fork PRs always use comment-only mode. The workflow's `GITHUB_TOKEN` is scoped to the upstream repository and cannot push to fork branches; the `maintainer_can_modify` setting only grants push access to *human* upstream maintainers, not to bot tokens. Rather than rely on a PAT or App workaround, fork PRs receive the changelog as a comment, and on merge the upload workflow regenerates the entry from the live PR record (title, labels) using `docs-builder changelog add --prs <N>` (see [Fork PRs and S3](#fork-prs-and-s3)). The comment body is informational only — editing it does not affect what is uploaded.

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

Changelog files on the default branch can be uploaded to S3. Files land in a **private bucket** (`elastic-docs-v3-changelog-bundles-private`), which is the internal source of truth. A scrubber Lambda automatically mirrors sanitized copies (with private repository references removed) to the **public bucket** served via CloudFront CDN. Changelogs are uploaded under `{product}/changelog/{filename}.yaml`.

### 1. Add the upload workflow

**`.github/workflows/changelog-upload.yml`**

```yaml
name: changelog-upload

on:
  push:
    branches: [main, master]

permissions: {}

jobs:
  upload:
    permissions:
      contents: read        # checkout the pushed commit
      id-token: write       # OIDC token for AWS authentication
      pull-requests: read   # look up the merged PRs for the pushed commit so fork-PR entries can be regenerated
    uses: elastic/docs-actions/.github/workflows/changelog-upload.yml@v1
```

> **Important:** All three permissions above are required. The calling job's `permissions:` block is the ceiling for the reusable workflow — its jobs internally request these scopes and the call is rejected at validation time if any are omitted, with errors like `is requesting 'id-token: write', but is only allowed 'id-token: none'`.

> **Note:** Do **not** add a `paths:` filter to this workflow. Fork-PR merge commits don't touch `docs/changelog/**` (the entry never gets committed to the PR branch), so a paths filter would suppress exactly the runs that need to regenerate the fork-PR entry. `docs-builder changelog upload` is incremental — runs that have nothing to upload are cheap.

If your changelog configuration is not at `docs/changelog.yml`, pass the path explicitly:

```yaml
jobs:
  upload:
    uses: elastic/docs-actions/.github/workflows/changelog-upload.yml@v1
    with:
      config: path/to/changelog.yml
```

### 2. Enable OIDC access

The upload workflow authenticates to AWS via GitHub Actions OIDC. Your repository must be listed in the changelog bundles infrastructure to have an IAM role provisioned. Contact the docs-engineering team to add your repository.

### How it works

On each push to `main` or `master`, the upload workflow:

1. Checks out the pushed commit
2. Sets up `docs-builder`
3. Looks up the merged PRs for the pushed commit; for each merged **fork** PR, runs `docs-builder changelog add --prs <N> --use-pr-number --concise --config <config>` to regenerate the entry from the live PR record (title, labels) and writes it into the bundle directory
4. Authenticates with AWS via OIDC
5. Runs `docs-builder changelog upload`, which reads your `changelog.yml`, discovers YAML files in the configured directory (committed entries plus any regenerated fork-PR entries), and incrementally uploads them to the **private** S3 bucket — only files whose content has changed are transferred
6. An SQS-triggered Lambda scrubs private repository references and writes sanitized copies to the **public** bucket behind CloudFront

If the directory has no files and no fork PRs are associated, the command exits silently without error.

The workflow uses a per-repository concurrency group so that rapid successive pushes queue rather than run in parallel. If a run is already in progress when a new push arrives, the in-progress run completes before the next one starts. Since `docs-builder` performs incremental uploads (skipping unchanged objects), re-runs are cheap.

### Fork PRs and S3

Fork PRs cannot commit to their PR branch (see [Fork PRs](#fork-prs)), so the changelog entry never lands on the PR branch. Instead, when the fork PR merges, the upload workflow:

- Calls `GET /repos/{owner}/{repo}/commits/{sha}/pulls` to find merged fork PRs
- For each one, runs `docs-builder changelog add --prs <N> --use-pr-number --concise --owner <owner> --repo <repo> --config <config>`, which reads the live PR title and labels from the GitHub API, applies the `pivot.types` and `rules.create` mappings from your `changelog.yml`, and writes the YAML into `bundle.directory`
- Lets the normal `docs-builder changelog upload` step pick it up

The entry is always regenerated from the *current* PR state at merge time, so any title or label edits made between submit-time preview and merge are reflected in what is uploaded. There is no artifact courier and no expiry window: a fork PR that merges months after the preview comment was posted still produces a correct entry.

> **Note:** The composite action accepts an `aws-account-id` input (default: the Elastic docs account). Overriding this is only valid when OIDC trust and IAM roles have been provisioned for the target account. In practice, most repositories should use the default.

> **Note:** The `github-token` input defaults to the workflow's `GITHUB_TOKEN`, which is scoped to the job's declared permissions. Do not substitute a broader PAT unless `docs-builder/setup` explicitly requires it.

## Bundling changelogs

Individual changelog files accumulate on the default branch as PRs merge. The bundle action generates a fully-resolved YAML file containing only the changelog entries that match a given filter, then uploads it to the `elastic-docs-v3-changelog-bundles` S3 bucket.

Two reusable workflows are available:

- **`changelog-bundle.yml`** (primary) — generates a bundle and uploads it to S3. Used for release-triggered workflows.
- **`changelog-bundle-pr.yml`** (opt-in) — generates a bundle and opens a pull request. Used for teams that need a committed bundle before a tag exists.

The bundle always includes the full content of each matching entry, so downstream consumers can render changelogs without access to the original files.

### Prerequisites

Your `docs/changelog.yml` must include a `bundle` section so docs-builder knows where to find changelog files. Setting `bundle.repo` and `bundle.owner` ensures PR and issue links are generated correctly in the bundle output.

```yaml
bundle:
  directory: docs/changelog
  output_directory: docs/releases
  repo: my-repo
  owner: elastic
```

Your repository must also be listed in the `elastic-docs-v3-changelog-bundles` infrastructure to have an IAM role provisioned for OIDC-based S3 uploads. Contact the docs-engineering team to add your repository.

### Setup

#### Profile-based bundling with S3 upload (`on: release`)

The recommended setup for stack and product releases. The caller triggers on `release`, passes a profile and version, and the bundle is uploaded to S3 automatically.

```yaml
bundle:
  directory: docs/changelog
  output_directory: docs/releases
  resolve: true
  repo: my-repo
  owner: elastic
  profiles:
    my-release:
      products: "my-product {version} {lifecycle}"
      output: "{version}.yaml"
```

**`.github/workflows/changelog-bundle.yml`**

```yaml
name: changelog-bundle

on:
  release:
    types: [published]

permissions: {}

jobs:
  bundle:
    permissions:
      contents: read    # checkout and read release data
      packages: read    # pull the docs-builder image from GHCR
      id-token: write   # OIDC token for AWS authentication on the upload job
    uses: elastic/docs-actions/.github/workflows/changelog-bundle.yml@v1
    with:
      profile: my-release
      version: ${{ github.event.release.tag_name }}
```

The `output` input is not needed — the action resolves the output path from `bundle.output_directory` and the profile's `output` pattern via the `--plan` step.

#### GitHub release mode (`mode: gh-release`)

For repositories that do not use the validate/submit workflow to accumulate individual changelog files, `gh-release` mode creates changelogs directly from a GitHub release's notes and bundles them in a single step.

**`.github/workflows/changelog-bundle.yml`**

```yaml
name: changelog-bundle

on:
  release:
    types: [published]

permissions: {}

jobs:
  bundle:
    permissions:
      contents: read    # checkout and read release data
      packages: read    # pull the docs-builder image from GHCR
      id-token: write   # OIDC token for AWS authentication on the upload job
    uses: elastic/docs-actions/.github/workflows/changelog-bundle.yml@v1
    with:
      mode: gh-release
      repo: my-repo
      version: ${{ github.event.release.tag_name }}
```

#### Option-based bundling with S3 upload

You can also use option-based filtering instead of profiles. The `release-version`, `report`, and `prs` inputs are supported.

**Stack / product releases:**

```yaml
name: changelog-bundle

on:
  release:
    types: [published]

permissions: {}

jobs:
  bundle:
    permissions:
      contents: read    # checkout and read release data
      packages: read    # pull the docs-builder image from GHCR
      id-token: write   # OIDC token for AWS authentication on the upload job
    uses: elastic/docs-actions/.github/workflows/changelog-bundle.yml@v1
    with:
      release-version: ${{ github.event.release.tag_name }}
      output: docs/releases/${{ github.event.release.tag_name }}.yaml
```

**Serverless / scheduled releases:**

```yaml
name: changelog-bundle

on:
  schedule:
    # At 08:00 AM, Monday through Friday
    - cron: '0 8 * * 1-5'

permissions: {}

jobs:
  discover-report:
    runs-on: ubuntu-latest
    outputs:
      report-url: ${{ steps.discover.outputs.report-url }}
      release-date: ${{ steps.discover.outputs.release-date }}
    steps:
      - id: discover
        run: echo "# your logic to find the latest promotion report"

  bundle:
    needs: discover-report
    permissions:
      contents: read    # checkout and read release data
      packages: read    # pull the docs-builder image from GHCR
      id-token: write   # OIDC token for AWS authentication on the upload job
    uses: elastic/docs-actions/.github/workflows/changelog-bundle.yml@v1
    with:
      report: ${{ needs.discover-report.outputs.report-url }}
      output: docs/releases/${{ needs.discover-report.outputs.release-date }}.yaml
```

#### Custom config path

If your changelog configuration is not at `docs/changelog.yml`, pass the path explicitly:

```yaml
    with:
      config: path/to/changelog.yml
      profile: my-release
      version: ${{ github.event.release.tag_name }}
```

### Output

The primary workflow (`changelog-bundle.yml`) uploads the bundle to the `elastic-docs-v3-changelog-bundles` S3 bucket under `{product}/bundle/{filename}`. The bundle is available to downstream rendering workflows immediately after upload.

### Bundle PR workflow (opt-in)

For teams that need a committed bundle file before a tag exists (e.g. feature-freeze branches), use the PR workflow instead. This generates the bundle and opens a pull request.

**`.github/workflows/changelog-bundle-pr.yml`**

```yaml
name: changelog-bundle-pr

on:
  workflow_dispatch:
    inputs:
      version:
        description: 'Version string (e.g. 9.2.0)'
        required: true

permissions: {}

jobs:
  bundle:
    permissions:
      contents: write       # commit the bundle file and push the branch
      pull-requests: write  # open or update the bundle PR
      packages: read        # pull the docs-builder image from GHCR
    uses: elastic/docs-actions/.github/workflows/changelog-bundle-pr.yml@v1
    with:
      profile: my-release
      version: ${{ inputs.version }}
```

The PR workflow opens a pull request on a branch named `changelog-bundle/<bundle-name>` (e.g. `changelog-bundle/v9.2.0`). If a PR already exists for that branch, the bundle is updated in place. If the generated bundle is identical to what's already in the repository, no commit or PR is created.

> **Note:** The PR workflow does not upload to S3. If you need both S3 upload and a PR, run both workflows or use the composite actions (`bundle-create`, `bundle-upload`, `bundle-pr`) directly.
