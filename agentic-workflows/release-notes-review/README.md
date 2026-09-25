# Release notes review

Reviews one changelog entry after the changelog-file workflow creates or evaluates it. The agent
checks the title, type-label mapping, and description. It posts one pull request comment only when
it finds a clear problem.

The workflow follows the Elastic [changelog content-type guidance](https://www.elastic.co/docs/contribute-docs/content-types/changelogs).
It checks user focus, clear titles, useful descriptions, and required impact and action content.

## Trigger

| Event | Description |
| --- | --- |
| `workflow_run` | Starts after the consumer workflow named `release-notes-changelog-file` completes. |

The caller must run after the changelog-file workflow. The caller downloads that run's
`changelog-staging` artifact to get the pull request number. The agent downloads the same artifact
to review the generated entry.

GitHub permits this sequence: pull request workflow, changelog-file `workflow_run`, then this
review `workflow_run`. Do not add another `workflow_run` stage after this one.

## Install

Copy the trigger template into the consumer repository:

```bash
mkdir -p .github/workflows && curl -sL \
  https://raw.githubusercontent.com/elastic/docs-actions/v1/agentic-workflows/release-notes-review/example.yml \
  -o .github/workflows/release-notes-review.yml
```

The `workflows` value in the template must match the name of the consumer workflow that calls
`release-notes-changelog-file.yml`.

The caller needs the following permissions:

- `actions: read` to download `changelog-staging`.
- `contents: read` to read the changelog configuration.
- `issues: write` and `pull-requests: write` to post the pull request comment.
- `discussions: write` for the gh-aw safe-output jobs.
- `copilot-requests: write` for agentic workflow support.

Set the `OPENROUTER_API_KEY` repository or organization secret. The workflow uses the Claude
engine through OpenRouter.

## Inputs

| Input | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `pr-number` | string | Yes | — | Pull request that owns the entry. |
| `source-run-id` | string | Yes | — | Changelog-file run that uploaded the staging artifact. |
| `config` | string | No | `docs/changelog.yml` | Changelog configuration path. |
| `staging-artifact-name` | string | No | `changelog-staging` | Generated entry artifact name. |
| `additional-instructions` | string | No | `""` | Extra repository guidance. |
| `setup-commands` | string | No | `""` | Commands that run before the review. |

## Safe outputs

| Output | Max | Description |
| --- | --- | --- |
| `noop` | 1 | Ends the run when no clear finding exists. |
| `add-comment` | 1 | Posts one non-blocking pull request comment. Older workflow comments are hidden. |

## Review rules

The agent reports only high-confidence findings. It does not post a success comment.

- Titles must be user-facing, specific, concise, and no more than 80 characters.
- Titles use a strong present-tense imperative verb.
- Entry type must match the user-visible change and a configured GitHub label.
- Breaking changes need `impact` and `action` fields.
- Descriptions are optional. If present, they add user value and use third-person present tense.
- The agent does not review unrelated pull request changes.

## Example

```yaml
name: Release notes review

on:
  workflow_run:
    workflows: [release-notes-changelog-file]
    types: [completed]

permissions:
  actions: read
  contents: read
  discussions: write
  issues: write
  pull-requests: write
  copilot-requests: write

jobs:
  prepare:
    if: >-
      github.event.workflow_run.conclusion != 'cancelled' &&
      github.event.workflow_run.event == 'workflow_run'
    runs-on: ubuntu-latest
    outputs:
      pr-number: ${{ steps.context.outputs.pr-number }}
    steps:
      - id: context
        env:
          GH_TOKEN: ${{ github.token }}
        run: |
          mkdir -p /tmp/changelog-staging
          gh run download "${{ github.event.workflow_run.id }}" \
            --repo "$GITHUB_REPOSITORY" \
            --name changelog-staging \
            --dir /tmp/changelog-staging
          echo "pr-number=$(jq -r '.pr_number' /tmp/changelog-staging/metadata.json)" >> "$GITHUB_OUTPUT"

  review:
    needs: prepare
    if: needs.prepare.outputs.pr-number != ''
    uses: elastic/docs-actions/.github/workflows/gh-aw-release-notes-review.lock.yml@v1
    with:
      pr-number: ${{ needs.prepare.outputs.pr-number }}
      source-run-id: ${{ github.event.workflow_run.id }}
      additional-instructions: |
        Use the product terminology from this repository's changelog configuration.
    secrets:
      OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}
```
