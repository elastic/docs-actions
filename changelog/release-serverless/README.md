# `changelog/release-serverless`

Bundles the release notes of a serverless promotion with
`docs-builder release serverless bundle <service> <service-version>`.
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
    outputs:
      bundle-path: ${{ steps.create.outputs.bundle-path }}
    steps:
      - id: create
        uses: elastic/docs-actions/changelog/release-serverless@v1
        with:
          service: kibana
          service-version: ${{ inputs.service-version }}
          dry-run: true
          github-token: ${{ steps.token.outputs.token }}   # must read elastic/serverless-gitops
```

With `dry-run: true`, the run report (resolved PRs with their entry source) goes to the job
summary, nothing is uploaded, and `bundle-path` is empty.

## Inputs

| Input | Required | Default | Description |
|---|---|---|---|
| `service` | **Yes** | — | Serverless service as emitted by gpctl, for example `kibana` |
| `service-version` | **Yes** | — | Promoted endpoint ref (`SERVICE_VERSION`), 12 characters or a full SHA |
| `date` | No | *(UTC run date)* | Bundle version, `YYYY-MM-DD` |
| `dry-run` | No | `false` | Write the run report to the job summary; build and upload nothing |
| `docs-builder-version` | No | `edge` | docs-builder version to install. Needs a version with `release serverless` |
| `artifact-name` | No | `changelog-bundle` | Artifact name; it holds the whole `bundles/` directory |
| `github-token` | **Yes** | — | Token that reads `elastic/serverless-gitops` and the service repository |

## Outputs

| Output | Description |
|---|---|
| `bundle-path` | Path to the first generated bundle `.yml` file. Empty in dry-run |
| `bundle-paths` | Newline-separated paths of all generated bundles. Empty in dry-run |
| `start-ref` | Resolved previous endpoint ref |

## Caller requirements

- **A token that reads `elastic/serverless-gitops`.** The default `github.token` cannot: the
  repository is private. Use an ephemeral token, for example through Vault OIDC.
- **`contents: read`** and **`packages: read`**. No checkout is needed: docs-builder fetches
  the service's `docs/changelog.yml` itself.
- Supported services are defined in docs-builder. The service list is defined in docs-builder: `kibana` and `elasticsearch`.
