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

## Draft pull requests

Set `skip-drafts` on the `release-notes` job to skip the checks on draft pull requests. A draft then shows the `validate` job as skipped, and it gets no pull request comment. The downloadable caller sets it.

```yaml
on:
  pull_request:
    types: [opened, synchronize, reopened, edited, labeled, unlabeled, ready_for_review, converted_to_draft]

jobs:
  release-notes:
    uses: elastic/docs-actions/.github/workflows/release-notes.yml@v1
    with:
      skip-drafts: true
```

The caller must include `ready_for_review` and `converted_to_draft` in its `pull_request` event types:

- `ready_for_review` runs the checks when a draft is marked ready for review. Without it, nothing checks the pull request until the next push or label change. GitHub counts the skipped check as passing, so the pull request can merge unchecked.
- `converted_to_draft` replaces a failed check with a skipped one when a pull request goes back to draft.

An existing comment stays on a pull request that goes back to draft. The checks update it when the pull request is ready again.

The checks skip a run only when the pull request is still a draft when the run starts. GitHub can start the run for a push to a draft after the pull request is marked ready. Such a run reads the current state from the GitHub API and runs the checks.

Without `skip-drafts`, the checks run on drafts like on any other pull request.

## Require Impact and Action on breaking changes

Set `require-impact-action` on the `release-notes` job to fail pull requests that carry a `breaking-change` type label but whose description lacks an `Impact` or `Action` section. Use a heading (`## Impact`, `## Action`) or a label (`Impact: …`).

```yaml
jobs:
  release-notes:
    uses: elastic/docs-actions/.github/workflows/release-notes.yml@v1
    with:
      require-impact-action: true
```

The pull request comment names the missing sections. When both are present, the comment stays on breaking-change pull requests and shows the captured text, so authors can check it before bundling. The caller already runs on `edited` events, so adding the sections to the description clears the check.

## Comment when the checks pass

By default the pull request comment only appears when a check fails, or to show the captured Impact and Action of a breaking change. Set `comment-on-success` on the `release-notes` job to also comment when the checks pass:

```yaml
jobs:
  release-notes:
    uses: elastic/docs-actions/.github/workflows/release-notes.yml@v1
    with:
      comment-on-success: true
```

The comment says either that the pull request will be part of the release notes, with its type, products and areas, or that it will not be, with the reason (for example the label that excludes it). It is the same comment as the others, so a pull request never gets two: for a breaking change the captured Impact and Action are shown in it too.
