# Review classifier

The review classifier labels each docs pull request as **light review** or **full review**. It posts one comment with a link to the matching [review checklist](https://codex.elastic.dev/r/docs-content-internal/processes/docs-review-checklists) and lists the rules that asked for a full review. The rules are deterministic: they use the diff, file paths, and GitHub metadata only, with no LLM. The spec is [elastic/docs-content-internal#1943](https://github.com/elastic/docs-content-internal/issues/1943).

Each repository keeps its rules in its own config file, `.github/review-classifier.yml`. To change a threshold, turn off a trigger, or add a custom rule, change that file. No docs-actions release is necessary.

## How it works

The classifier runs in two phases, the same way as the Vale lint and report actions, so it is safe for fork pull requests:

1. [`review-classifier.yml`](../.github/workflows/review-classifier.yml) runs with read-only permissions. It loads the config, checks out the PR head, reads the base version of each changed file from git, and runs [`classify.py`](classify.py). It writes a preview to the job summary and uploads a `review-classification` artifact that contains data only. When Vale is on (the default), it also runs [`vale/lint`](../vale/lint/) on the changed Markdown files.
2. [`review-classifier-comment.yml`](../.github/workflows/review-classifier-comment.yml) runs on `workflow_run`. It loads the same config, validates the artifact with [`render.py`](render.py), builds the comment from fixed templates, and updates one comment and the review labels with [`scripts/publish.js`](scripts/publish.js).

If the PR head changed after the classification, the comment workflow does nothing. The next classification run posts the result for the new head.

## Set up a repository

Copy the two callers to `.github/workflows/`, and the example config to `.github/review-classifier.yml`:

```bash
base=https://raw.githubusercontent.com/elastic/docs-actions/v1/review-classifier
mkdir -p .github/workflows
curl -sSL "$base/review-classifier.yml" -o .github/workflows/review-classifier.yml
curl -sSL "$base/review-classifier-comment.yml" -o .github/workflows/review-classifier-comment.yml
curl -sSL "$base/config.yml" -o .github/review-classifier.yml
```

| File | Purpose |
| --- | --- |
| [`review-classifier.yml`](review-classifier.yml) | Classify a PR. Starts in dry-run mode: run it manually with a PR number. |
| [`review-classifier-comment.yml`](review-classifier-comment.yml) | Post the comment and labels after a classification run that is not a dry run. |
| [`config.yml`](config.yml) | The rules. Every key is optional, and the example shows the defaults. |

If a repository has no config file, the classifier uses the defaults. To use another path, set the `config` input in both callers.

### Dry run and automatic mode

The caller starts with `workflow_dispatch` only. Run it from the **Actions** tab with a PR number:

- With `dry-run: true` (the default), the run writes the result to the job summary. It posts no comment and changes no labels.
- With `dry-run: false`, the comment workflow posts the comment and labels on that PR.

When the results look right, uncomment the `pull_request` trigger in `review-classifier.yml` to classify every PR automatically.

## Where the config comes from

Both phases read the config from the **default branch**, never from the PR head. A PR therefore cannot change the rules that classify it, and a rule change applies after it merges.

A `workflow_dispatch` run reads the config from the branch that it runs on. To test a rule change, push it to a branch, and then run a dry run from that branch on an existing PR. Only users with write access can start a dispatch run.

An invalid config fails the run with an error that names the key, for example `unknown key(s) in triggers: new-pages`.

## Full review triggers

One trigger is enough for a full review. Files that match `skip-paths` do not count for any trigger. Each trigger has a key under `triggers:` in the config. Set a key to `false` to turn off that trigger.

| Trigger | Condition | Options |
| --- | --- | --- |
| `new-page` | A page is added. | |
| `page-deleted` | A page is deleted. | |
| `redirect-added` | A redirect file (`redirect-files`) has a new source path. Changes to existing redirects do not count. | |
| `large-scope` | More than `max-files` files change. | `max-files` (5) |
| `images-changed` | `min-images` or more image files are added, changed, or deleted. | `min-images` (3) |
| `shared-snippet` | A new or changed snippet is included, directly or through other snippets, by pages in more than one folder. | `scope` (`top-level`) |
| `substantial-change` | A heading is added, removed, or renamed, or the changed lines reach the threshold percent of the base page: 20% up to 199 lines, 10% up to 500 lines, and 5% for larger pages. | `headings` (`true`), `thresholds` |
| `applies-to-modified` | An existing `applies_to` value is changed or removed. New values do not count. | |
| `external-link-added` | A new URL in prose points outside `allowed-hosts`. | `allowed-hosts` |

If only files that match `skip-paths` change (always `.github/**` and `**/*.csv`), the classifier posts no comment. Generated and reference files are not skipped.

### Custom rules

A custom rule asks for a full review when a changed file matches one of its paths. The `label` text appears in the comment, followed by the file name:

```yaml
custom:
  - id: security-pages
    label: Security page changed
    paths: ['deploy-manage/security/**']
    statuses: [added, modified]   # Optional. Default: all statuses.
```

### Rule details

Some details that the issue does not specify:

- **Pages and snippets.** A page is a `.md` file that is not a snippet. Set `pages-exclude-snippets: false` to count new and deleted snippets as pages too.
- **Renames.** A renamed page is not a new page or a deleted page. A move without edits is a light review, unless it adds a redirect. For an edited rename, the classifier compares the new file with the old path.
- **Headings.** The classifier ignores lines in code blocks and in frontmatter. A renamed heading counts as a change.
- **Changed lines.** The classifier ignores whitespace changes, blank lines, and text that is only rewrapped.
- **`applies_to`.** The classifier compares values from frontmatter, inline roles, directive options, and `{applies_to}` blocks. It ignores changes to key order and indentation.
- **Links.** The classifier ignores URLs in code blocks and inline code, and URLs that were already on the page.
- **Snippet folders.** With `scope: top-level` (the default), a folder is the first directory under the docset root. With `directory`, each directory counts.

## Labels and overrides

The comment workflow sets the light or full label (by default `review: light` and `review: full`) to show the final tier. It removes the other label. Set other names under `labels:` in the config.

To override the classification, apply the other label yourself. The classifier checks who applied each label: a label from a person is an override, and a label from `github-actions[bot]` is not. When both labels come from people, the full review label wins. If you remove a label that the bot applied, the next run adds it again. The comment shows when a label overrides the rules, for example:

> **Light review** *(manually overridden — full review was triggered by: substantial page change)*

Labels are advisory. They do not change merge requirements or assign reviewers. Create both labels in the repository before you enable the workflow. If a label is missing, the workflow tries to create it.

## Vale

When `vale.enabled` is `true`, the comment includes a short Vale summary: counts by severity on changed lines, and the first `vale.max-findings` (10) errors and warnings. Errors map to the **Language** checklist item. Warnings and suggestions map to **Style**. Vale findings are advisory.

In a dry run started from `workflow_dispatch`, Vale lints all lines of the changed files. The comment workflow filters the findings to changed lines with the line ranges in the classification artifact.

## Backtest

[`backtest.py`](backtest.py) runs the rules against recently merged PRs in a local clone and prints the rate of each trigger. It reads YAML config files with `yq`, or with PyYAML when `yq` is not installed:

```bash
git -C ../docs-content fetch origin main
python3 review-classifier/backtest.py --repo elastic/docs-content --repo-root ../docs-content \
  --limit 200 --config ../docs-content/.github/review-classifier.yml
```

## Tests

```bash
cd review-classifier
python3 -m unittest test_classify test_render
node --test scripts/publish.test.js
```
