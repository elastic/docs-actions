# `changelog/release-serverless`

Bundles the release notes of a serverless promotion with
`docs-builder release serverless <service> <service-version>`.
docs-builder resolves the previous `production-noncanary-ds-5` version from
`elastic/serverless-gitops` history, reads each repository's `docs/changelog.yml`
at the promoted ref, and builds one bundle per repository from its commit range:
Kibana produces one bundle, Elasticsearch two (`elasticsearch-serverless` and its
`elasticsearch` submodule). The bundles are uploaded as one artifact, the `bundles/`
directory, for a separate publish job.

Use this from a quality-gate-triggered promotion workflow. For release-driven bundling use
[`changelog/bundle-create-version`](../bundle-create-version/).

## Usage

```yaml
jobs:
  bundle:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: read
    steps:
      - uses: elastic/docs-actions/changelog/release-serverless@v1
        with:
          service: elasticsearch
          service-version: ${{ inputs.service-version }}
          github-token: ${{ steps.token.outputs.token }}   # must read elastic/serverless-gitops

  publish:
    needs: bundle
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write
    steps:
      - uses: actions/download-artifact@v8
        with:
          name: changelog-bundle
          path: bundles
      # ... authenticate with AWS, then upload the whole directory:
      - run: docs-builder changelog upload --artifact-type bundle --target s3 --s3-bucket-name <bucket> --directory bundles
```

A service can produce several bundles, so publish the whole `bundles/` directory.
[`changelog/bundle-publish`](../bundle-publish/) takes a single file and cannot publish them all.
`changelog upload` scans the top level of the directory and keys each bundle by the products inside it.

With `dry-run: true`, the run report (resolved PRs with their entry source) goes to the job
summary, nothing is uploaded, and `bundle-paths` is empty.

## Inputs

| Input | Required | Default | Description |
|---|---|---|---|
| `service` | **Yes** | — | Serverless service as emitted by gpctl, for example `kibana` |
| `service-version` | **Yes** | — | Promoted endpoint ref (`SERVICE_VERSION`): a 12-character hash or a full SHA (12 to 40 hex characters) |
| `date` | No | *(UTC run date)* | Bundle version, `YYYY-MM-DD` |
| `dry-run` | No | `false` | Write the run report to the job summary; build and upload nothing |
| `docs-builder-version` | No | `edge` | docs-builder version to install. Needs a version with `release serverless` |
| `artifact-name` | No | `changelog-bundle` | Artifact name; it holds the whole `bundles/` directory |
| `github-token` | **Yes** | — | Token that reads `elastic/serverless-gitops` and the service repository |

## Outputs

| Output | Description |
|---|---|
| `bundle-paths` | Newline-separated paths of all generated bundles. Empty in dry-run |
| `start-ref` | Resolved previous endpoint ref |

## Caller requirements

- **A token that reads `elastic/serverless-gitops`.** The default `github.token` cannot: the
  repository is private. Use an ephemeral token, for example through Vault OIDC.
- **`contents: read`** and **`packages: read`**. No checkout is needed: docs-builder fetches
  the service's `docs/changelog.yml` itself.
- Supported services are defined in docs-builder. The service list is defined in docs-builder: `kibana` and `elasticsearch`.
