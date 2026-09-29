# Release notes caller workflows

These caller workflows connect a repository to the reusable release notes workflows in `elastic/docs-actions`.

Copy the required files to `.github/workflows/` in the target repository.

| File | Purpose | Required |
| --- | --- | --- |
| [`release-notes.yml`](release-notes.yml) | Validate pull requests and synchronize merged release note data. | Yes |
| [`release-notes-comments.yml`](release-notes-comments.yml) | Explain validation results in pull request comments. | No |
| [`release-notes-changelog-file.yml`](release-notes-changelog-file.yml) | Generate and commit changelog entry files when `require-changelog-file` is enabled. | No |

Download the required caller:

```bash
mkdir -p .github/workflows
curl -sSL https://raw.githubusercontent.com/elastic/docs-actions/v1/release-notes/release-notes.yml \
  -o .github/workflows/release-notes.yml
```

Download the pull request comments caller:

```bash
curl -sSL https://raw.githubusercontent.com/elastic/docs-actions/v1/release-notes/release-notes-comments.yml \
  -o .github/workflows/release-notes-comments.yml
```

Download the changelog file caller only when the repository enables `require-changelog-file`:

```bash
curl -sSL https://raw.githubusercontent.com/elastic/docs-actions/v1/release-notes/release-notes-changelog-file.yml \
  -o .github/workflows/release-notes-changelog-file.yml
```

The release notes and changelog file callers use the default `docs/changelog.yml` configuration path. Add the `config` input to those jobs when the repository uses another path. Refer to the source definitions for the supported inputs:

- [`release-notes.yml`](../.github/workflows/release-notes.yml)
- [`release-notes-comments.yml`](../.github/workflows/release-notes-comments.yml)
- [`release-notes-changelog-file.yml`](../.github/workflows/release-notes-changelog-file.yml)
