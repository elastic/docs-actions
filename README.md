# docs-actions

Reusable GitHub Actions and agentic workflows for Elastic documentation.

## Composite actions

| Action | Description |
|--------|-------------|
| [`aws/auth`](aws/auth/) | AWS role assumption for docs deployments |
| [`changelog/submit`](changelog/submit/) | Generate and commit changelog entries |
| [`changelog/validate`](changelog/validate/) | Gate PRs on changelog label presence |
| [`codex/build`](codex/build/) | Build codex documentation with docs-builder |
| [`codex/update-link-index`](codex/update-link-index/) | Update cross-repo link index |
| [`docs-builder/setup`](docs-builder/setup/) | Install the docs-builder CLI |
| [`git/setup`](git/setup/) | Configure git user and token auth |

Usage:

```yaml
- uses: elastic/docs-actions/docs-builder/setup@v1
- run: docs-builder --version
```

## Agentic workflows

AI-powered [GitHub Agent Workflows](https://github.github.com/gh-aw/) for documentation tasks.

| Workflow | Description | Trigger | Safe output |
|----------|-------------|---------|-------------|
| [docs-review](agentic-workflows/docs-review/) | Review changed markdown files under `docs/` in pull requests | `/docs-review`, PR checkbox menu | `create-pull-request-review-comment`, `submit-pull-request-review` |
| [issue-triage](agentic-workflows/issue-triage/) | Triage issues by applying team labels | `/triage`, dispatch | `add-labels` |
| [docs-quality-sweep](agentic-workflows/docs-quality-sweep/) | Fan out to the docs quality sweeps in parallel | `workflow_dispatch` | Per sweep |

Quick install:

```bash
mkdir -p .github/workflows && curl -sL \
  https://raw.githubusercontent.com/elastic/docs-actions/v1/agentic-workflows/docs-review/example.yml \
  -o .github/workflows/docs-review.yml
```

Agentic workflows in this repo use `COPILOT_GITHUB_TOKEN`.

## Development

See [agentic-workflows/DEVELOPING.md](agentic-workflows/DEVELOPING.md) for agentic workflow development.

```bash
make setup     # install gh-aw compiler + actionlint
make compile   # compile workflow sources to lock files
make lint      # validate trigger files
```

## License

Apache 2.0 — see [LICENSE](https://github.com/elastic/docs-actions/blob/main/LICENSE).
