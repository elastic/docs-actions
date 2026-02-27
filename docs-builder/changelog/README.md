# Changelog automation

Automatically generate and commit changelog entries for pull requests using [docs-builder](https://github.com/elastic/docs-builder/).

When a PR is opened or labeled, the system generates a changelog YAML file based on the PR title and type label, commits it to the PR branch, and posts a comment with a link to view or edit the entry.

## Setup

### 1. Add the changelog configuration

Create `docs/changelog.yml` in your repository:

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

### 2. Create the workflow files

Add two workflow files to your repository:

**`.github/workflows/docs-changelog-generate.yml`**

```yaml
name: docs-changelog-generate

on:
  pull_request:
    types:
      - opened
      - synchronize
      - reopened
      - labeled
      - unlabeled

jobs:
  changelog:
    uses: elastic/docs-actions/.github/workflows/docs-changelog-generate.yml@v1
```

**`.github/workflows/docs-changelog-commit.yml`**

```yaml
name: docs-changelog-commit

on:
  workflow_run:
    workflows: [docs-changelog-generate]
    types:
      - completed

permissions:
  contents: write
  pull-requests: write

jobs:
  changelog:
    if: github.event.workflow_run.event == 'pull_request'
    uses: elastic/docs-actions/.github/workflows/docs-changelog-commit.yml@v1
    with:
      run-id: ${{ github.event.workflow_run.id }}
```

> **Important:** The `name` in the generate workflow (`docs-changelog-generate`) must match the `workflows:` reference in the commit workflow. If you rename one, rename the other.

### 3. Create the labels

Make sure the GitHub labels referenced in your `docs/changelog.yml` exist in your repository. You also need a `changelog:skip` label for PRs that should not generate a changelog entry.

## How it works

```
PR opened/labeled
       |
       v
docs-changelog-generate workflow
       |
       +-- skip if changelog:skip label is present
       +-- skip if last commit is from the bot (prevents loops)
       +-- skip if changelog file was manually edited
       |
       +-- runs: docs-builder changelog add
       +-- uploads result as artifact
       |
       v
docs-changelog-commit workflow (triggered by workflow_run)
       |
       +-- re-validates PR state (labels, head SHA)
       +-- downloads artifact
       +-- commits changelog file to PR branch
       +-- posts PR comment with view/edit links
```

The two-workflow design is required because the generate workflow runs with read-only permissions (from the PR context), while the commit workflow runs with write permissions (from `workflow_run`, which uses the base branch's permissions). This is a [standard pattern](https://securitylab.github.com/research/github-actions-preventing-pwn-requests/) for safely writing to PR branches from forks.

## Customization

Both workflows accept optional inputs via `workflow_call`:

| Input                | Workflow  | Description                              | Default              |
|----------------------|-----------|------------------------------------------|----------------------|
| `config`             | generate  | Path to changelog configuration file     | `docs/changelog.yml` |
| `strip-title-prefix` | generate  | Remove `[Prefix]:` from PR titles       | `false`              |

Example with custom config path:

```yaml
jobs:
  changelog:
    uses: elastic/docs-actions/.github/workflows/docs-changelog-generate.yml@v1
    with:
      config: .changelog/config.yml
```

## Skipping changelog generation

Add the `changelog:skip` label to a PR to skip changelog generation entirely. The generate workflow will exit early and no artifact or commit is produced.

## Manual edits

If a human edits the changelog file directly (i.e., the last commit to `docs/changelog/{PR_NUMBER}.yaml` is not from `github-actions[bot]`), the automation will not overwrite it. This lets authors customize the generated entry without it being regenerated on the next push.

## Output

Each PR produces a file at `docs/changelog/{PR_NUMBER}.yaml` on the PR branch. These files are consumed by `docs-builder` during documentation builds to produce a rendered changelog page.
