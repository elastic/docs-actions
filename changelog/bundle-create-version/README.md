# `changelog/bundle-create-version`

Creates a changelog bundle from a GitHub release using `docs-builder changelog gh-release`.
Uploads the result as an artifact so a separate `bundle-publish` job can upload it to S3
with OIDC credentials that never touch the generate step.

Use this action when you know the exact GitHub release tag and want the bundle created from
the release's merged PR set. For profile + commit-range bundling, use
[`changelog/bundle-create-git-range`](../bundle-create-git-range/).

## Usage

```yaml
jobs:
  bundle:
    if: github.event_name == 'release' && inputs.bundle-on-release
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: read
      pull-requests: read
    outputs:
      bundle-path: ${{ steps.create.outputs.bundle-path }}
    steps:
      - uses: actions/checkout@v4
        with:
          persist-credentials: false
      - id: create
        uses: elastic/docs-actions/changelog/bundle-create-version@v1
        with:
          config: ${{ inputs.config }}
          version: ${{ github.event.release.tag_name }}
          repo: ${{ github.event.repository.name }}
          owner: ${{ github.repository_owner }}

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
          config: ${{ inputs.config }}
          bundle-path: ${{ needs.bundle.outputs.bundle-path }}
```

The reusable `release-notes.yml` workflow uses this action automatically when
`bundle-on-release: true` is set. Add the above two jobs only when you need more
control than the reusable workflow provides.

## Inputs

| Input | Required | Default | Description |
|---|---|---|---|
| `config` | No | `docs/changelog.yml` | Path to the changelog configuration file |
| `version` | No | `latest` | GitHub release tag (e.g. `v9.2.0`) or `latest` |
| `repo` | No | *(from `GITHUB_REPOSITORY`)* | Repository name without owner |
| `owner` | No | *(from `GITHUB_REPOSITORY`)* | Repository owner |
| `strip-title-prefix` | No | `false` | Remove `[Prefix]:` from PR titles |
| `docs-builder-version` | No | `edge` | docs-builder version to install |
| `artifact-name` | No | `changelog-bundle` | Artifact name — must match `bundle-publish`'s `artifact-name` |
| `github-token` | No | `${{ github.token }}` | Token for fetching release data |

## Outputs

| Output | Description |
|---|---|
| `bundle-path` | Repo-relative path to the generated bundle `.yml` file |

Pass `bundle-path` to `needs.<job>.outputs.bundle-path` in the publish job.

## Caller requirements

- **Checkout first.** This action does not run `actions/checkout`. The caller's checkout must be the ref that owns `config`.
- **`contents: read`** — to read `config` from the checked-out repo.
- **`packages: read`** — to pull the `ghcr.io/elastic/docs-builder` image.
- **GitHub token** — to query the GitHub API for the release and its PRs.

`id-token: write` is **not** needed here — that permission belongs exclusively to the publish job.

## Relationship to `bundle-create`

`bundle-create-version` is the focused successor to `bundle-create@v1`'s gh-release path.
`bundle-create@v1` is frozen for `changelog-bundle.yml` and `docs-internal-workflows`; new
release-driven consumers should use this action instead.

Key differences:
- Native binary only — no Docker, no plan step, no image digest pinning
- Path is reported by docs-builder itself rather than predicted in advance
- One docs-builder install, not two
- Disjoint input surface — no profile/git-range inputs to cross-validate
