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

Changelog files can be uploaded to S3 from a push to any branch. Files land in a **private bucket** (`elastic-docs-v3-changelog-bundles-private`), which is the internal source of truth. A scrubber Lambda automatically mirrors sanitized copies (with private repository references removed) to the **public bucket** served via CloudFront CDN. Changelog entries are uploaded once per authoring org/repo/branch under `changelog/{org}/{repo}/{branch}/{filename}.yaml` (the owner and repo are resolved from `--owner`/`--repo`, `bundle.owner`/`bundle.repo` in `changelog.yml`, or the git remote origin; the branch from `--branch`, defaulting to the pushed branch). The branch is stored verbatim, so a branch name with `/` (e.g. `feature/foo`) becomes additional key segments.

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

As PRs merge, individual changelog entries pile up on your default branch (and, once uploaded, in S3). A **bundle** is a single, fully-resolved YAML file that collects the entries matching a filter — a release version, a promotion report, or an explicit list of PRs — with each entry's full content inlined. Downstream tooling renders a release changelog from the bundle alone, without needing the original entry files.

Setting up bundling comes down to two choices: **how the bundle is delivered** and **how its entries are selected**. Pick one row from each table below, then follow the matching recipe.

### 1. Choose how the bundle is delivered

| Your goal | Workflow | What you get |
| --- | --- | --- |
| Make the bundle available to docs rendering | [`changelog-bundle.yml`](#setup-1) | Uploads the bundle to S3 (`bundle/{product}/{file}`) |
| Commit the bundle into your repository | [`changelog-bundle-pr.yml`](#bundle-pr-workflow-opt-in) | Opens a PR with the scrubbed bundle fetched from the CDN |
| Both | run `changelog-bundle.yml`, then `changelog-bundle-pr.yml` | Upload first, then open the PR |

The PR workflow is **fetch-only**: it downloads the already-uploaded, scrubbed bundle instead of regenerating it, so the committed file is exactly what was published (private references removed). It therefore requires `changelog-bundle.yml` to have uploaded the bundle first.

### 2. Choose how entries are selected

Pick exactly one filter source — `release-version`, `report`, `prs`, and `prs-artifact` are mutually exclusive. `profile` combines with `version`, and optionally with `report` or `prs-artifact` as the filter source.

| Situation | Mode | Key inputs |
| --- | --- | --- |
| You accumulate entry files and tag releases (most teams) | **Profile** _(recommended)_ | `profile` + `version` |
| You generate the shipped-PR list at release time (e.g. from a commit range) | **Profile + PR list** | `profile` + `version` + `prs-artifact` |
| You build changelogs from a GitHub release's notes rather than entry files | **gh-release** | `mode: gh-release` + `repo` + `version` |
| You want everything in a given release tag | **Option** | `release-version` (+ `output`) |
| You want everything in a Buildkite promotion report | **Option** | `report` (+ `output`) |
| You want a specific set of PRs | **Option** | `prs` or `prs-artifact` (+ `output`) |

Each mode has a complete, copy-pasteable workflow file under [Setup](#setup-1).

### Where bundle entries come from

By default, the bundle command sources the individual changelog entries from the **public CDN**, scoped to the bundle's product(s), rather than from the local `bundle.directory`. This means a bundle reflects the same sanitized entries that have been published to S3, and a repository can produce a bundle without keeping every entry file checked out locally.

CDN sourcing locates each authoring pool's entry registry (`changelog/{org}/{repo}/{branch}/registry.json`) — repo from `--repo`/`bundle.repo`/git remote, org from `--owner`/`bundle.owner` (default `elastic`), branch from `--branch`/`bundle.branch` (default `main`) — to discover that pool's published entries. When the source repo can't be resolved (e.g. an option-mode PR/issue-only filter), the command automatically falls back to local sourcing.

To always source entries from the local `bundle.directory` instead, set `use_local_changelogs: true` in the `bundle` section of your `docs/changelog.yml`. Passing an explicit `--directory`/`output` also forces local sourcing.

```yaml
bundle:
  directory: docs/changelog
  output_directory: docs/releases
  use_local_changelogs: true  # opt out of CDN sourcing; use local entry files
```

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

Each recipe below is a complete `changelog-bundle.yml` caller for one selection mode (S3-upload delivery). To also commit the bundle to your repo, add the [Bundle PR workflow](#bundle-pr-workflow-opt-in) afterwards.

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

#### Profile-based bundling from a PR list (`prs-artifact`)

For releases where the source of truth is a PR list produced at release time (for example, derived from a start/end commit range), generate the list in a preceding job, upload it as a workflow artifact, and pass the artifact name via `prs-artifact`. The artifact must contain exactly one newline-delimited file of fully-qualified GitHub PR URLs — or issue URLs, but not a mix of both:

```txt
https://github.com/elastic/my-repo/pull/123
https://github.com/elastic/my-repo/pull/456
```

In profile mode, `version` is required alongside `prs-artifact`: it drives `{version}`/`{lifecycle}` substitution in the profile's `output` and `output_products` patterns, and the resolved output path depends on it.

The profile supplies the output pattern and product metadata. It must **not** define a `products` pattern — a products filter cannot be combined with a PR-list filter:

```yaml
bundle:
  directory: docs/changelog
  output_directory: docs/releases
  resolve: true
  repo: my-repo
  owner: elastic
  profiles:
    my-release:
      output: "{version}.yaml"
      output_products: "my-product {version} {lifecycle}"
```

**`.github/workflows/changelog-bundle.yml`**

```yaml
name: changelog-bundle

on:
  workflow_dispatch:
    inputs:
      version:
        description: 'Release version (e.g. 9.2.0 or 2026-07-07)'
        required: true

permissions: {}

jobs:
  discover-prs:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v6
        with:
          persist-credentials: false
      - name: Build PR list
        run: |
          # Replace with your discovery logic (e.g. derive the merged PRs
          # from a start/end commit range). One fully-qualified URL per line.
          printf '%s\n' \
            "https://github.com/elastic/my-repo/pull/123" \
            "https://github.com/elastic/my-repo/pull/456" > prs.txt
      - uses: actions/upload-artifact@v7
        with:
          name: release-prs
          path: prs.txt
          if-no-files-found: error
          retention-days: 1

  bundle:
    needs: discover-prs
    permissions:
      contents: read    # checkout and read release data
      packages: read    # pull the docs-builder image from GHCR
      id-token: write   # OIDC token for AWS authentication on the upload job
    uses: elastic/docs-actions/.github/workflows/changelog-bundle.yml@v1
    with:
      profile: my-release
      version: ${{ inputs.version }}
      prs-artifact: release-prs
```

The `version` input drives `{version}`/`{lifecycle}` substitution in the profile's `output` and `output_products` patterns; the artifact supplies the filter. Because the artifact is downloaded inside the reusable workflow, the PR list never needs to be committed to the repository.

> **Note:** `{lifecycle}` is inferred from semver-style prerelease monikers (`9.2.0` → `ga`, `9.2.0-beta.1` → `beta`). Date-based targets such as `2026-07-07` are treated as having a prerelease suffix and infer `preview`, so for date-based releases omit `{lifecycle}` from your patterns (e.g. `output_products: "my-product {version}"`).

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

You can also use option-based filtering instead of profiles. The `release-version`, `report`, `prs`, and `prs-artifact` inputs are supported. Option mode has no profile to derive the bundle's product metadata from, so the products are inferred from the matched changelog entries; prefer profile mode when you need explicit `output_products`.

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

**Specific set of PRs:**

Pass a short list inline with `prs` (comma-separated URLs or numbers, or a path to a newline-delimited file committed to the repository):

```yaml
    uses: elastic/docs-actions/.github/workflows/changelog-bundle.yml@v1
    with:
      prs: "https://github.com/elastic/my-repo/pull/123,https://github.com/elastic/my-repo/pull/456"
      output: docs/releases/my-bundle.yaml
```

For PR lists generated during the run, upload the list file as an artifact and pass `prs-artifact` instead — see [Profile-based bundling from a PR list](#profile-based-bundling-from-a-pr-list-prs-artifact), which also works with `output` in option mode.

#### Custom config path

If your changelog configuration is not at `docs/changelog.yml`, pass the path explicitly:

```yaml
    with:
      config: path/to/changelog.yml
      profile: my-release
      version: ${{ github.event.release.tag_name }}
```

### Output

The primary workflow (`changelog-bundle.yml`) uploads the bundle to the `elastic-docs-v3-changelog-bundles` S3 bucket under `bundle/{product}/{filename}`. The bundle is available to downstream rendering workflows immediately after upload.

> **Note:** Bundles are keyed by product, so a shared product (e.g. `cloud-serverless`) bundled by more than one repository shares the `bundle/{product}/` prefix. To avoid one repo's bundle overwriting another's, give each bundle a repo-qualified filename such as `{repo}-{dateOrVersion}.yaml` (e.g. `my-repo-2026-03.yaml`).

### Bundle PR workflow (opt-in)

For teams that need the bundle committed into the repository, use the PR workflow. Unlike the primary workflow, it does **not** generate the bundle: it downloads the already-uploaded, scrubbed copy from the public CDN and opens a pull request with it. This guarantees the committed file matches what was published to S3 (private references removed), rather than a freshly-regenerated local copy.

Because it is fetch-only, `changelog-bundle.yml` must have run and uploaded the bundle first. The fetch step polls the CDN with exponential backoff (up to ~10 minutes) to absorb scrubbing and CloudFront propagation latency, failing the job if the bundle never appears.

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
  bundle-pr:
    permissions:
      contents: write       # commit the bundle file and push the branch
      pull-requests: write  # open or update the bundle PR
      packages: read        # pull the docs-builder image from GHCR (plan step)
    uses: elastic/docs-actions/.github/workflows/changelog-bundle-pr.yml@v1
    with:
      profile: my-release
      version: ${{ inputs.version }}
```

The PR workflow opens a pull request on a branch named `changelog-bundle/<bundle-name>` (e.g. `changelog-bundle/v9.2.0`). If a PR already exists for that branch, the bundle is updated in place. If the fetched bundle is identical to what's already in the repository, no commit or PR is created.

> **Note:** Locating the bundle on the CDN requires a resolvable product, so the PR workflow only supports profile (or product-scoped option) mode — the same constraint as CDN entry sourcing above. PR/issue-only filters that resolve no product cannot be fetched from the CDN.

> **Note:** The PR workflow does not upload to S3; it consumes what `changelog-bundle.yml` already uploaded. If you need both S3 upload and a PR, run the primary workflow first, then this one. To compose the steps yourself, use the composite actions (`bundle-fetch` then `bundle-pr`) directly.
