# Agentic workflows

AI-powered workflows for Elastic documentation tasks. Each directory contains a workflow source (`.md`), a trigger template (`example.yml`), and usage docs (`README.md`).

| Workflow | Description | Trigger | Safe output |
|----------|-------------|---------|-------------|
| [docs-review](docs-review/) | Review changed markdown files in pull requests (`docs/` by default, or repo-wide with `review-scope`) | `/docs-review`, PR checkbox menu | `create-pull-request-review-comment`, `submit-pull-request-review` |
| [docs-issue-scope](docs-issue-scope/) | Scope docs work from an issue plus linked PRs or commits | `/docs-issue-scope` | `add-comment`, `update-issue` |
| [issue-triage](issue-triage/) | Triage issues by applying team labels | `/docs-triage`, dispatch | `add-labels`, `remove-labels` |
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

These workflows now use the built-in GitHub token path. Add `permissions.copilot-requests: write` to the caller workflow, and do not pass `COPILOT_GITHUB_TOKEN` unless you are intentionally overriding the default auth path.

Skill imports are workflow-specific. Some workflows install APM skills from `elastic/elastic-docs-skills`, while others intentionally rely only on embedded rules and deterministic pre-steps.

For the sweep family, `docs-root` defines the default corpus, `target-path` narrows that corpus to one subtree under the root, and `scope-mode` controls whether the matched set is scanned in full or sharded.
