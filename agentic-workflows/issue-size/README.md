# Issue size

Estimates the cost and benefit of an issue. It reads the issue, its linked code or docs, and `CODEOWNERS`, then posts a single comment that covers effort, ownership, dependencies, the audience that benefits, the confidence behind the benefit estimate, and a bill of materials that splits the work into AI-suitable and human tasks.

## Triggers

| Event | Description |
|-------|-------------|
| `/size` | Slash command on an issue comment. |
| `workflow_dispatch` | Manual trigger. |

## Install

```bash
mkdir -p .github/workflows && curl -sL \
  https://raw.githubusercontent.com/elastic/docs-actions/v1/agentic-workflows/issue-size/example.yml \
  -o .github/workflows/docs-size.yml
```

Add `copilot-requests: write` to the caller job `permissions:` block — no secret passthrough needed.

## Inputs

| Input | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `additional-instructions` | string | No | `""` | Ownership mapping, label rules, CODEOWNERS paths. |
| `setup-commands` | string | No | `""` | Shell commands to run before the agent starts. |

## Safe outputs

| Output | Max | Description |
|--------|-----|-------------|
| `noop` | — | Posts a short comment when the description doesn't provide enough information to estimate cost or benefit. |
| `add-labels` | 2 | Apply one effort bucket and, when the work is fully AI-suitable, `good-for-ai`. |
| `add-comment` | 1 | Post the cost-and-benefit estimate. |

Effort labels for `add-labels`: `hours`, `weeks: <1`, `weeks: 1`, `weeks: 2`, and `weeks: 4+`, plus `good-for-ai`. The workflow only applies labels that already exist in the target repository, and it never invents labels.

## How it works

1. It reviews any prior TriageBot, RefineBot, or SizeBot blocks in the issue body to sharpen the estimate.
2. It reads the issue, its comments, linked code or docs, and `CODEOWNERS`.
3. If the issue is too vague to assess, it emits `noop` with a short comment suggesting `/triage` first.
4. Otherwise it estimates cost (effort, ownership, dependencies) and benefit (audience, degree, confidence, synergies), treating benefit as an evidence-based orientation rather than a precise measurement.
5. It applies the matching effort label, adds `good-for-ai` when every task is AI-suitable and the effort is small, and posts a single cost-and-benefit comment. It does not edit the issue body.
