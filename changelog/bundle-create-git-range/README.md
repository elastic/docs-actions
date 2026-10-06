# `changelog/bundle-create-git-range`

Creates a changelog bundle for a profile and a git commit range using
`docs-builder changelog bundle <profile> <version> --start-git-ref <start> --end-git-ref <end>`.
docs-builder derives the PR list from the range itself (GitHub compare API + GraphQL
`associatedPullRequests`) and sources each PR's entry pool-first, with PR-metadata fallback.
The result is uploaded as an artifact so a separate [`bundle-publish`](../bundle-publish/) job
can upload it to S3 with OIDC credentials that never touch the generate step.

Use this for date-promotion products (for example Serverless) where the release is a pair of
published endpoint refs, not a GitHub release tag. For release-driven bundling use
[`changelog/bundle-create-version`](../bundle-create-version/).

## Usage

```yaml
jobs:
  bundle:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: read
    outputs:
      bundle-path: ${{ steps.create.outputs.bundle-path }}
    steps:
      - uses: actions/checkout@v4          # the checkout must provide docs/changelog.yml
        with:
          persist-credentials: false
      - id: create
        uses: elastic/docs-actions/changelog/bundle-create-git-range@v1
        with:
          profile: serverless-release
          version: 2026-10-06
          start-git-ref: 03c0df903631
          end-git-ref: 7dd981dcd7d3

  bundle-publish:
    needs: bundle
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write
      packages: read
    steps:
      - uses: actions/checkout@v4
        with:
          persist-credentials: false
      - uses: elastic/docs-actions/changelog/bundle-publish@v1
        with:
          bundle-path: ${{ needs.bundle.outputs.bundle-path }}
```

To preview a promotion without building a bundle, set `dry-run: true`. The run report
(resolved PR list with the per-PR entry source: pool, inferred, or missing) is written to the
job summary, nothing is uploaded, and `bundle-path` is empty.

## Inputs

| Input | Required | Default | Description |
|---|---|---|---|
| `profile` | **Yes** | — | Profile name from `bundle.profiles` in `changelog.yml`. It must not set a `products` pattern or `source: github_release` |
| `version` | **Yes** | — | Version for `{version}` substitution and the file name, for example a date |
| `start-git-ref` | **Yes** | — | Previously published endpoint ref (exclusive). Never inferred |
| `end-git-ref` | **Yes** | — | Currently published endpoint ref (inclusive). Recorded as the bundle `git_ref` |
| `dry-run` | No | `false` | Write the run report to the job summary; build and upload nothing |
| `repo` | No | *(from config)* | Repository name, forwarded only when set |
| `owner` | No | *(from config)* | Repository owner, forwarded only when set |
| `docs-builder-version` | No | `edge` | docs-builder version to install |
| `artifact-name` | No | `changelog-bundle` | Artifact name — must match `bundle-publish`'s `artifact-name` |
| `github-token` | No | `${{ github.token }}` | Token used for the compare and GraphQL APIs |

## Outputs

| Output | Description |
|---|---|
| `bundle-path` | Repo-relative path to the generated bundle `.yml` file. Empty in dry-run |

The file name follows docs-builder's `{repo}-{product}-{version}.yaml` convention, written under the
profile's or `bundle.output_directory`.

## Caller requirements

- **The workspace must contain `docs/changelog.yml`** (or `changelog.yml`). This action does not run
  `actions/checkout` and does not take a `config` input: in profile mode docs-builder discovers the
  config itself. A caller that bundles a different repository can fetch that repository's
  `docs/changelog.yml` at `end-git-ref` into the workspace first.
- **`contents: read`** and **`packages: read`**.
- **A GitHub token that can read the repository that owns the commit range.** The GraphQL API does
  not accept anonymous requests.

`id-token: write` is **not** needed here — that permission belongs exclusively to the publish job.

## Relationship to `bundle-create`

`bundle-create-git-range` is the focused successor to `bundle-create@v1`'s commit-range path
(`bundle-create@v1` is frozen). Differences: native binary only (no Docker, no plan step, no image
digest pinning), the path is reported by docs-builder rather than predicted, and the input surface
covers commit-range mode only.
