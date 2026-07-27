# Agentic workflows

AI-powered workflows for Elastic documentation tasks. Each directory contains a workflow source (`.md`), a trigger template (`example.yml`), and usage docs (`README.md`).

| Workflow | Description | Trigger | Safe output |
|----------|-------------|---------|-------------|
| [docs-review](docs-review/) | Review changed markdown files in pull requests (`docs/` by default, or repo-wide with `review-scope`) | `/docs-review`, PR checkbox menu | `create-pull-request-review-comment`, `submit-pull-request-review` |
| [docs-issue-scope](docs-issue-scope/) | Scope docs work from an issue plus linked PRs or commits | `/docs-issue-scope` | `add-comment`, `update-issue` |
| [issue-triage](issue-triage/) | Triage and refine an issue: classify, validate, rewrite the description, and apply labels | `/triage`, dispatch | `add-labels`, `add-comment`, `update-issue` |
| [issue-auto-triage](issue-auto-triage/) | Same triage and refinement logic, run automatically when an issue is opened | `issues: opened` | `add-labels`, `add-comment`, `update-issue` |
| [issue-size](issue-size/) | Estimate the cost and benefit of an issue, with a bill of materials | `/size`, dispatch | `add-labels`, `add-comment` |
| [docs-frontmatter-sweep](docs-frontmatter-sweep/) | Audit frontmatter on a rotating slice, or all markdown files under a selected subtree | `workflow_dispatch` | `create-issue` (label `docs-fix:frontmatter`) |
| [docs-quality-sweep](docs-quality-sweep/) | Orchestrator that fans out to all quality sweeps in parallel | `workflow_dispatch` | (per sub-workflow) |
| [docs-applies-to-sweep](docs-applies-to-sweep/) | Validate `applies_to` keys on a rotating slice, or all markdown files under a selected subtree | `workflow_dispatch` | `create-issue` (label `docs-fix:applies-to`) |
| [docs-openings-sweep](docs-openings-sweep/) | Audit page openings on a rotating slice, or all markdown files under a selected subtree | `workflow_dispatch` | `create-issue` (label `docs-fix:openings`) |
| [docs-style-sweep](docs-style-sweep/) | Audit style-guide compliance on a rotating slice, or all markdown files under a selected subtree | `workflow_dispatch` | `create-issue` (label `docs-fix:style`) |
| [docs-typos-sweep](docs-typos-sweep/) | Run codespell across the docs corpus, or one selected subtree, and emit a structured fix-issue | `workflow_dispatch` | `create-issue` (label `docs-fix:typos`) |
| [docs-staleness-sweep](docs-staleness-sweep/) | Flag stale content, stale screenshots, broken external links, and unsupported-version mentions on a rotating slice, or one selected subtree | `workflow_dispatch` | `create-issue` (label `docs-fix:staleness`) |
| [docs-coherence-sweep](docs-coherence-sweep/) | Detect duplicates and contradictions vs. published Elastic docs on a rotating slice, or one selected subtree | `workflow_dispatch` | `create-issue` (label `docs-fix:coherence`) |

## Installation

Copy a workflow's `example.yml` into your repository's `.github/workflows/` directory:

```bash
mkdir -p .github/workflows && curl -sL \
  https://raw.githubusercontent.com/elastic/docs-actions/v1/agentic-workflows/docs-issue-scope/example.yml \
  -o .github/workflows/docs-issue-scope.yml
```

These workflows use `COPILOT_GITHUB_TOKEN` for authentication. Pass `secrets.COPILOT_GITHUB_TOKEN` from the caller workflow as shown in the `example.yml` files. The quality-sweep orchestrator is the exception — it dispatches sibling workflows via `gh workflow run` and does not pass a token directly.

Skill imports are workflow-specific. Some workflows install APM skills from `elastic/elastic-docs-skills`, while others intentionally rely only on embedded rules and deterministic pre-steps.

For the sweep family, `docs-root` defines the default corpus, `target-path` narrows that corpus to one subtree under the root, and `scope-mode` controls whether the matched set is scanned in full or sharded. `target-files` overrides both to sweep an explicit list of files (ideal for post-merge "check only what changed" runs).

Every sweep finding carries a `confidence` rating (`high` / `medium` / `low`) alongside its `severity`. A fix-issue that contains any medium- or low-confidence finding is labeled `needs-human-review` and kept off the `good-for-ai` auto-delegation track, so uncertain output is not applied to the docs without a human sign-off.
