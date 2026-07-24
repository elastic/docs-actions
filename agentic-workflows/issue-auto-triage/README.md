# Issue auto-triage

Runs the same triage and refinement logic as [issue-triage](../issue-triage/), automatically when an issue is opened. It classifies the issue type, validates the description against a quality bar, refines it when appropriate, and applies labels. When it rewrites, it preserves valid allowed-domain links and meaningful uncertainty from the author.

Because there are no comments yet, it works from the issue body alone and applies a stricter rewrite guard: it only rewrites the description when the body already contains enough author-supplied information to do so without inventing facts. Issues opened by a bot are skipped.

The workflow accepts issue content from public community contributors as untrusted input. Its GitHub tools use `min-integrity: none` so community-authored issues can be triaged, while all writes remain constrained by the configured safe outputs. Findings-only runs update a marker-delimited managed block and never replace the author's full issue body.

## Triggers

| Event | Description |
|-------|-------------|
| `issues: opened` | The caller workflow fires on issue open and invokes the reusable workflow. |

## Install

```bash
mkdir -p .github/workflows && curl -sL \
  https://raw.githubusercontent.com/elastic/docs-actions/v1/agentic-workflows/issue-auto-triage/example.yml \
  -o .github/workflows/docs-auto-triage.yml
```

Use `secrets: inherit` on the caller job to forward the `DOCS_LITELLM_API_KEY` org secret:

```yaml
    secrets: inherit
```

## Inputs

| Input | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `additional-instructions` | string | No | `""` | Team mapping, label rules, CODEOWNERS paths. |
| `setup-commands` | string | No | `""` | Shell commands to run before the agent starts. |

## Safe outputs

| Output | Max | Description |
|--------|-----|-------------|
| `add-labels` | 6 | Apply classification labels and any team or area labels that already exist in the repo. |
| `remove-labels` | 1 | Remove `needs-team` once the issue has been triaged, when that label exists. |
| `add-comment` | 1 | Ask the author for missing information when the issue needs a human. |
| `update-issue` | 1 | Record a triage findings block and, when appropriate, a refined description. |

Classification labels for `add-labels`: `triaged`, `human-needed`, `bug`, `enhancement`, `question`, and `documentation`. The workflow also allows the `Team:*` and `cross-team` labels for routing. It only applies labels that already exist in the target repository, and it never invents labels.

There is no undo path, because an issue-open event has no triggering comment.

## Example

The `example.yml` includes a sample team mapping via `additional-instructions`. Customize the mapping for your repo's team structure.
