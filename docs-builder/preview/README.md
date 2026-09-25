# Documentation previews

The `docs-build.yml` and `docs-deploy.yml` reusable workflows build and publish documentation previews for pull requests. Each preview uses the pull request head commit and is published at a stable, per-PR path:

```text
https://docs-v3-preview.elastic.dev/<owner>/<repository>/pull/<number>
```

## Stacked pull requests

A stacked pull request targets the head branch of its parent pull request instead of a configured content-source branch such as `main`. When the immediate base branch is not a content source, the preview workflows follow the chain of open pull requests until they reach the root branch, use the root branch to check content-source eligibility, and build the child pull request's head commit. Because the child commit contains its parent commits, the resulting preview includes the stack up to that pull request.

The chain walk only starts when the immediate base is not a content source, and it stops at the repository default branch or at a semver branch such as `9.4`. A pull request that targets `main` directly is never treated as stacked, even if another open pull request uses `main` as its head.

The preview comment links to every parent pull request detected in the stack. Preview URLs, cleanup behavior, and artifact retention are unchanged. Each pull request still produces one build and one S3 prefix, so stack support does not add site builds or persistent storage.

To use a stack-aware preview:

1. Keep every parent pull request open.
2. Set each child pull request's base branch to its immediate parent's head branch.
3. After updating a parent branch, merge or rebase that update into each child branch whose preview should include it.
4. Open or synchronize the child pull request to trigger its preview.

## Troubleshooting

- If no preview is created, verify that the root of the stack targets a branch configured as a content source.
- If the workflow reports multiple open pull requests for one head branch, close the duplicate pull request or give it a different head branch.
- If a parent pull request was closed without merging, retarget the child to another open parent or to the configured root branch.
- If the preview does not include a recent parent change, update the child branch from its parent, and rerun the workflow.
