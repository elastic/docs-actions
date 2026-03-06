# Changelog automation

Automatically generate and submit changelog entries for pull requests.

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

### 2. Create the workflows

Add two workflow files to your repository:

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

**`.github/workflows/changelog-submit.yml`**

```yaml
name: changelog-submit

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
  submit:
    uses: elastic/docs-actions/.github/workflows/changelog-submit.yml@v1
```

> **Important:** The `name` in the generate workflow (`changelog-generate`) must match the `workflows:` reference in the submit workflow. If you rename one, rename the other.

The two-workflow design is required because the generate workflow runs with read-only permissions (from the PR context), while the submit workflow runs with write permissions (from `workflow_run`, which uses the base branch's permissions). This is a [standard pattern](https://securitylab.github.com/research/github-actions-preventing-pwn-requests/) for safely handling PR branches, including those from forks.

### 3. Create the labels

Make sure the GitHub labels referenced in your `docs/changelog.yml` exist in your repository. To allow PRs to skip changelog generation, configure `rules.create.exclude` in your changelog config with the appropriate label(s).

## How it works

```
PR opened/labeled/title edited
       |
       v
generate workflow (read-only)
       |
       +-- skip if labels match rules.create exclusion rules
       +-- skip if last commit is from the bot (prevents loops)
       +-- skip if changelog file was manually edited
       +-- skip if only the PR body was edited (not the title)
       |
       +-- resolves title and type from PR metadata + config
       +-- runs: docs-builder changelog add
       +-- uploads result as artifact
       |
       v
submit workflow (write permissions, via workflow_run)
       |
       +-- downloads artifact
       +-- re-validates PR state (labels, head SHA, fork detection)
       +-- commits changelog file to PR branch
       +-- posts PR comment with view/edit links
       |
       +-- fork PRs: posts changelog as comment instead
       +-- no-label PRs: posts comment listing available labels
```

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

When all products are blocked by the create rules, the generate action will exit early and no artifact or commit is produced.

## Manual edits

If a human edits the changelog file directly (i.e., the last commit to `docs/changelog/{PR_NUMBER}.yaml` is not from `github-actions[bot]`), the automation will not overwrite it. This lets authors customize the generated entry without it being regenerated on the next push.

## Output

Each PR produces a file at `docs/changelog/{PR_NUMBER}.yaml` on the PR branch. These files are consumed by `docs-builder` during documentation builds to produce a rendered changelog page.
