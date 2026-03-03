# Changelog automation

Automatically generate and commit changelog entries for pull requests.

When a PR is opened or labeled, the system generates a changelog YAML file based on the PR title and type label, commits it to the PR branch, and posts a comment with a link to view or edit the entry.

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

### 2. Create the workflow

Add the following:

**`.github/workflows/changelog-generate.yml`**

```yaml
name: changelog-generate

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
  generate:
    uses: elastic/docs-actions/.github/workflows/changelog-generate.yml@v1
```

**`.github/workflows/changelog-commit.yml`**

```yaml
name: changelog-commit

on:
  workflow_run:
    workflows: [changelog-generate]
    types:
      - completed

permissions:
  actions: read
  contents: write
  pull-requests: write

jobs:
  commit:
    uses: elastic/docs-actions/.github/workflows/changelog-commit.yml@v1
    with:
      run-id: ${{ github.event.workflow_run.id }}
```

> **Important:** The `name` in the generate workflow (`changelog-generate`) must match the `workflows:` reference in the commit workflow. If you rename one, rename the other.

The two-workflow design is required because the generate workflow runs with read-only permissions (from the PR context), while the commit workflow runs with write permissions (from `workflow_run`, which uses the base branch's permissions). This is a [standard pattern](https://securitylab.github.com/research/github-actions-preventing-pwn-requests/) for safely writing to PR branches from forks.

### 3. Create the labels

Make sure the GitHub labels referenced in your `docs/changelog.yml` exist in your repository. You also need a `changelog:skip` label for PRs that should not generate a changelog entry.

## How it works

```
PR opened/labeled/title edited
       |
       v
generate job
       |
       +-- skip if changelog:skip label is present
       +-- skip if last commit is from the bot (prevents loops)
       +-- skip if changelog file was manually edited
       |
       +-- runs: docs-builder changelog add
       +-- uploads result as artifact
       |
       v
commit job
       |
       +-- re-validates PR state (labels, head SHA)
       +-- downloads artifact
       +-- commits changelog file to PR branch
       +-- posts PR comment with view/edit links
```

## Inputs

### Generate workflow

| Input                  | Description                              | Default              |
|------------------------|------------------------------------------|----------------------|
| `config`               | Path to changelog configuration file     | `docs/changelog.yml` |
| `strip-title-prefix`   | Remove `[Prefix]:` from PR titles       | `false`              |
| `changelog-dir`        | Directory for changelog entry files      | `docs/changelog`     |
| `docs-builder-version` | docs-builder version to install          | `edge`               |

### Commit workflow

| Input          | Description                                             | Default  |
|----------------|---------------------------------------------------------|----------|
| `run-id`       | Workflow run ID to download the changelog artifact from | required |
| `comment-only` | Post as PR comment instead of committing to the branch  | `false`  |

### Comment-only mode

If you prefer not to have bot commits on your PR branches, pass `comment-only: true` to the commit workflow. The changelog entry will be posted as a PR comment instead of being committed to the branch:

```yaml
jobs:
  commit:
    uses: elastic/docs-actions/.github/workflows/changelog-commit.yml@v1
    with:
      run-id: ${{ github.event.workflow_run.id }}
      comment-only: true
```

## Skipping changelog generation

Add the `changelog:skip` label to a PR to skip changelog generation entirely. The generate action will exit early and no artifact or commit is produced.

## Manual edits

If a human edits the changelog file directly (i.e., the last commit to `docs/changelog/{PR_NUMBER}.yaml` is not from `github-actions[bot]`), the automation will not overwrite it. This lets authors customize the generated entry without it being regenerated on the next push.

## Output

Each PR produces a file at `docs/changelog/{PR_NUMBER}.yaml` on the PR branch. These files are consumed by `docs-builder` during documentation builds to produce a rendered changelog page.

## Advanced: using composite actions directly

The reusable workflows are thin wrappers around two composite actions. If you need more control, you can use them directly in your own workflow steps:

- `elastic/docs-actions/changelog/generate@v1` -- generates the changelog and uploads an artifact
- `elastic/docs-actions/changelog/commit@v1` -- downloads the artifact and commits or comments

See the individual action files for their full input/output definitions.
