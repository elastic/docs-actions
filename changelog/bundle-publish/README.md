# `changelog/bundle-publish`

Downloads a changelog bundle artifact and uploads it to the private S3 bucket.
A scrubber Lambda mirrors sanitized copies to the public CDN bucket.

Works with any create action that produces a `changelog-bundle` artifact containing
a single `.yml` file: `bundle-create-version`, `bundle-create-git-range`, or the
legacy `bundle-create`.

## Usage

```yaml
  bundle-publish:
    needs: bundle            # job that ran bundle-create-version or bundle-create-git-range
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write        # required for OIDC authentication with AWS
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

This action is the privileged half of the create → publish split. Keeping
`id-token: write` isolated to this job means the generate step runs without
cloud credentials, which limits the blast radius of a supply-chain compromise
in the tooling.

## Inputs

| Input | Required | Default | Description |
|---|---|---|---|
| `bundle-path` | **Yes** | — | Repo-relative path to the bundle `.yml` file. Typically `${{ needs.<job>.outputs.bundle-path }}` |
| `config` | No | `docs/changelog.yml` | Path to the changelog configuration file |
| `artifact-name` | No | `changelog-bundle` | Artifact name — must match the create action's `artifact-name` |
| `docs-builder-version` | No | `edge` | docs-builder version to install |
| `github-token` | No | `${{ github.token }}` | Token used by the docs-builder setup action |
| `aws-account-id` | No | `197730964718` | AWS account ID. Override only when OIDC trust has been provisioned for the target account |

## Caller requirements

- **Checkout first.** This action does not run `actions/checkout`. The caller's checkout must be the ref that owns `config`.
- **`id-token: write`** — required for OIDC authentication with AWS.
- **`contents: read`** — to read `config` from the checked-out repo.
- **`packages: read`** — to pull the `ghcr.io/elastic/docs-builder` image.

## Relationship to `bundle-upload`

`bundle-publish` is the successor to `bundle-upload@v1` for new callers. `bundle-upload@v1`
is frozen. Key difference: `bundle-publish` accepts `bundle-path` only (no `output` alias)
and is designed to pair with the new `bundle-create-version` / `bundle-create-git-range` actions.

## Risk

This action writes to `elastic-docs-v3-changelog-bundles-private`. Verify that the OIDC role
trust policy matches the calling job's subject claim before wiring up a new consumer — a job
rename can invalidate an existing claim silently.
