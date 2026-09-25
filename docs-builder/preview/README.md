# Documentation previews

The `docs-build.yml` and `docs-deploy.yml` reusable workflows build and publish documentation previews for pull requests. Each preview uses the pull request head commit and is published at a stable, per-PR path:

```text
https://docs-v3-preview.elastic.dev/<owner>/<repository>/pull/<number>
```

## Stacked pull requests

A pull request in a [GitHub stack](https://docs.github.com/en/pull-requests/reference/stacked-pull-requests) targets the branch of the pull request below it instead of a content-source branch such as `main`. GitHub exposes the branch the whole stack lands on as `pull_request.stack.base.ref`, and the preview workflows match against that branch instead of the immediate base. The pull request's own head commit is what gets built, so the preview shows that layer together with every layer below it.

The `stack` field is only set when the pull requests are linked as a stack. A pull request that merely targets another pull request's branch is not stacked, and its preview is skipped as before. To link existing pull requests, use the **Create stack** option when opening the pull request, accept the banner GitHub shows on pull requests whose branches line up, or use `gh stack submit`.

The preview comment states the pull request's position in the stack and the branch the stack targets. Preview URLs, cleanup behavior, and artifact retention are unchanged. Each pull request still produces one build and one S3 prefix, so stack support does not add site builds or persistent storage.

## Troubleshooting

- If no preview is created for a pull request that targets another pull request's branch, check that the pull requests are linked as a stack. The stack map appears in the pull request header when they are.
- If no preview is created for a linked stack, verify that the stack targets a branch configured as a content source.
- If the preview does not include a recent change from a lower layer, rebase the stack with **Rebase stack** in the merge box or `gh stack rebase`, then push.
