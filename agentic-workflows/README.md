# Agentic workflows

AI-powered workflows for Elastic documentation tasks. Each directory contains a workflow source (`.md`), a trigger template (`example.yml`), and usage docs (`README.md`).

| Workflow | Description | Trigger | Safe output |
|----------|-------------|---------|-------------|
| [docs-review](docs-review/) | Review changed markdown files in pull requests (`docs/` by default, or repo-wide with `review-scope`) | `/docs-review`, PR checkbox menu | `create-pull-request-review-comment`, `submit-pull-request-review` |
| [issue-scope](issue-scope/) | Scope docs impact and estimate cost/benefit for an issue in one comment | `/scope`, dispatch | `add-labels`, `add-comment` |
| [issue-triage](issue-triage/) | Route and quality-check an issue on demand: classify it, check it against the quality bar, and apply labels | `/triage`, dispatch | `add-labels`, `remove-labels`, `react-green`, `add-comment` |
| [issue-auto-triage](issue-auto-triage/) | Route and quality-check a new issue with per-project instructions | `issues: opened` | `add-labels`, `remove-labels`, `react-green`, `add-comment` |
| [docs-frontmatter-sweep](docs-frontmatter-sweep/) | Audit frontmatter on a rotating slice, or all markdown files under a selected subtree | `workflow_dispatch` | `create-issue` (label `docs-fix:frontmatter`) |
| [docs-quality-sweep](docs-quality-sweep/) | Orchestrator that fans out to all quality sweeps in parallel | `workflow_dispatch` | (per sub-workflow) |
| [docs-applies-to-sweep](docs-applies-to-sweep/) | Validate `applies_to` keys on a rotating slice, or all markdown files under a selected subtree | `workflow_dispatch` | `create-issue` (label `docs-fix:applies-to`) |
| [docs-openings-sweep](docs-openings-sweep/) | Audit page openings on a rotating slice, or all markdown files under a selected subtree | `workflow_dispatch` | `create-issue` (label `docs-fix:openings`) |
| [docs-style-sweep](docs-style-sweep/) | Audit style-guide compliance on a rotating slice, or all markdown files under a selected subtree | `workflow_dispatch` | `create-issue` (label `docs-fix:style`) |
| [docs-typos-sweep](docs-typos-sweep/) | Run codespell across the docs corpus, or one selected subtree, and emit a structured fix-issue | `workflow_dispatch` | `create-issue` (label `docs-fix:typos`) |
| [docs-staleness-sweep](docs-staleness-sweep/) | Flag stale content, stale screenshots, broken external links, and unsupported-version mentions on a rotating slice, or one selected subtree | `workflow_dispatch` | `create-issue` (label `docs-fix:staleness`) |
| [docs-coherence-sweep](docs-coherence-sweep/) | Detect duplicates and contradictions vs. published Elastic docs on a rotating slice, or one selected subtree | `workflow_dispatch` | `create-issue` (label `docs-fix:coherence`) |
| [docs-source-sync](docs-source-sync/) | Digest recent changes from caller-configured source repos and open a draft PR updating an internal engineering handbook in a caller-configured target repo | `workflow_call` (example: weekly `schedule`) | `create-pull-request` |

## Installation

Copy a workflow's `example.yml` into your repository's `.github/workflows/` directory:

```bash
mkdir -p .github/workflows && curl -sL \
  https://raw.githubusercontent.com/elastic/docs-actions/v1/agentic-workflows/issue-scope/example.yml \
  -o .github/workflows/docs-scope.yml
```

These workflows use the built-in `github.token` with `copilot-requests: write` permission for
authentication — no separate secret passthrough needed. The quality-sweep orchestrator is the
exception — it dispatches sibling workflows via `gh workflow run`.

Skill imports are workflow-specific. Some workflows install APM skills from `elastic/elastic-docs-skills`, while others intentionally rely only on embedded rules and deterministic pre-steps.

For the sweep family, `docs-root` defines the default corpus, `target-path` narrows that corpus to one subtree under the root, and `scope-mode` controls whether the matched set is scanned in full or sharded. `target-files` overrides both to sweep an explicit list of files (ideal for post-merge "check only what changed" runs).

Every sweep finding carries a `confidence` rating (`high` / `medium` / `low`) alongside its `severity`. A fix-issue that contains any medium- or low-confidence finding is labeled `needs-human-review` and kept off the `good-for-ai` auto-delegation track, so uncertain output is not applied to the docs without a human sign-off.
