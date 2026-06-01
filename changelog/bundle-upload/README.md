# Changelog bundle upload

Downloads a changelog bundle artifact and uploads it to the `elastic-docs-v3-changelog-bundles` S3 bucket. Uses OIDC for AWS authentication and docs-builder's incremental upload (only files whose content has changed are transferred).

## Prerequisites

Your repository must be listed in the `elastic-docs-v3-changelog-bundles` infrastructure to have an IAM role provisioned for OIDC-based S3 uploads. Contact the docs-engineering team to add your repository.

## Inputs

| Name                   | Description                                                                                           | Required | Default               |
|------------------------|-------------------------------------------------------------------------------------------------------|----------|-----------------------|
| `output`               | Output file path for the bundle, relative to repo root. Must match the path used by bundle-create     | `true`   |                       |
| `config`               | Path to changelog.yml configuration file                                                              | `false`  | `docs/changelog.yml`  |
| `artifact-name`        | Name of the artifact uploaded by bundle-create                                                        | `false`  | `changelog-bundle`    |
| `docs-builder-version` | docs-builder version (e.g. 0.1.100, latest, edge)                                                    | `false`  | `edge`                |
| `github-token`         | GitHub token (used by docs-builder setup). Use the default GITHUB_TOKEN; do not substitute a broader PAT | `false`  | `${{ github.token }}` |
| `aws-account-id`       | AWS account ID. Only override if OIDC trust and IAM roles have been provisioned for the target account | `false`  | `197730964718`        |

## Usage

```yaml
steps:
  - uses: elastic/docs-actions/changelog/bundle-upload@v1
    with:
      output: docs/releases/v9.2.0.yaml
```

This action is typically used as the second job in the `changelog-bundle.yml` reusable workflow, after `bundle-create` generates the artifact. The S3 key for each bundle is `{product}/bundle/{filename}`, where the product is read from the bundle's YAML `products` array.
