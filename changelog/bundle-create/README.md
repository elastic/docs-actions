# Changelog bundle create

Checks out the repository, runs docs-builder in Docker to generate a fully-resolved bundle file, and uploads the result as an artifact. Supports option-based filtering (release-version, report, prs), profile-based bundling, and gh-release mode (creates changelogs from a GitHub release). Uses `--network none` where possible.

## Modes

- **`bundle`** (default) — runs `docs-builder changelog bundle` with profile or option-based filtering.
- **`gh-release`** — runs `docs-builder changelog gh-release` to create changelogs directly from a GitHub release's notes. Requires `repo` and optionally `version` (defaults to `latest`).

## Entry sourcing

In `bundle` mode, the individual changelog entries are sourced from the **public CDN** by default (scoped to the bundle's product), so the local entry files don't need to be checked out. The Docker run enables network access only when the `--plan` step reports `needs_network: true`; otherwise it runs with `--network none`.

CDN sourcing requires a resolvable product. When none can be resolved (e.g. an option-mode PR/issue-only filter) the command falls back to the local `bundle.directory`, which must then contain the entries. To force local sourcing, set `use_local_changelogs: true` in `changelog.yml` or pass an explicit `output` path.

## Inputs

| Name                   | Description                                                                                         | Required | Default               |
|------------------------|-----------------------------------------------------------------------------------------------------|----------|-----------------------|
| `mode`                 | Operation mode: `bundle` or `gh-release`                                                            | `false`  | `bundle`              |
| `config`               | Path to changelog.yml configuration file                                                            | `false`  | `docs/changelog.yml`  |
| `profile`              | Bundle profile name (bundle mode only)                                                              | `false`  |                       |
| `version`              | Version string (e.g. 9.2.0). Profile substitution in bundle mode; release tag in gh-release mode    | `false`  |                       |
| `release-version`      | GitHub release tag for PR filtering (bundle mode, option-based only)                                | `false`  |                       |
| `report`               | Buildkite promotion report URL or local file path                                                   | `false`  |                       |
| `prs`                  | Comma-separated PR URLs/numbers, or path to a newline-delimited file                                | `false`  |                       |
| `output`               | Output file path, relative to repo root                                                             | `false`  |                       |
| `repo`                 | GitHub repository name. Required for gh-release mode                                                | `false`  |                       |
| `owner`                | GitHub repository owner                                                                             | `false`  |                       |
| `strip-title-prefix`   | Remove `[Prefix]:` from PR titles (gh-release mode only)                                           | `false`  | `false`               |
| `docs-builder-version` | docs-builder version (e.g. 0.1.100, latest, edge)                                                  | `false`  | `edge`                |
| `artifact-name`        | Name for the uploaded artifact                                                                      | `false`  | `changelog-bundle`    |
| `github-token`         | GitHub token                                                                                        | `false`  | `${{ github.token }}` |

## Outputs

| Name     | Description                              |
|----------|------------------------------------------|
| `output` | Resolved output file path for the bundle |

## Usage

Bundle mode (profile):
```yaml
steps:
  - uses: elastic/docs-actions/changelog/bundle-create@v1
    with:
      profile: elasticsearch-release
      version: 9.2.0
```

Bundle mode (option-based):
```yaml
steps:
  - uses: elastic/docs-actions/changelog/bundle-create@v1
    with:
      release-version: v9.2.0
      output: docs/releases/v9.2.0.yaml
```

GitHub release mode:
```yaml
steps:
  - uses: elastic/docs-actions/changelog/bundle-create@v1
    with:
      mode: gh-release
      repo: elasticsearch
      version: v9.2.0
```
