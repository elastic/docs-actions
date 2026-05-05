# Docs quality sweep (orchestrator)

A `workflow_dispatch`-triggered orchestrator that fans out to all five docs quality sweep workflows in parallel jobs. Use this in your docs repo as the single entry point — one click runs frontmatter, applies_to, openings, style, and typos in one go (or any subset).

Each sweep is independent: a failure in one job doesn't kill the others, and each opens its own labeled fix-issue. There is no aggregated dashboard or quality score — those are deferred to a later iteration.

## Where to install

Install this in the repo where you want fix-issues to land. Recommended setup:

- Workflow runs in **`elastic/docs-content-internal`** (or your internal triage repo).
- Sweeps audit **`elastic/docs-content`** (or whatever public docs repo you set via `source-repo`).
- Fix-issues are filed in the **calling repo** via the auto-provided `GITHUB_TOKEN` — no cross-repo PAT or extra secret needed.

## Trigger

`workflow_dispatch` only. Add `schedule:` later once manual runs are validated.

## Install

```bash
mkdir -p .github/workflows && curl -sL \
  https://raw.githubusercontent.com/elastic/docs-actions/v1/agentic-workflows/docs-quality-sweep/example.yml \
  -o .github/workflows/docs-quality-sweep.yml
```

Ensure `COPILOT_GITHUB_TOKEN` is configured in the calling repo (this is the only secret needed).

Run via the Actions UI or:

```bash
gh workflow run docs-quality-sweep.yml \
  -f sweeps=all \
  -f source-repo=elastic/docs-content \
  -f docs-root=. \
  -f target-batch-size=100 \
  -f max-per-fix-issue=20
```

## Inputs

| Input | Default | Description |
|-------|---------|-------------|
| `sweeps` | `all` | Comma-separated list of sweep names: `frontmatter`, `applies-to`, `openings`, `style`, `typos`. Use `all` to run every sweep. |
| `source-repo` | `elastic/docs-content` | Repository to scan, as `owner/repo`. Set to empty to scan the calling repo. |
| `docs-root` | `.` | Root directory inside the source repo. `.` works for repos where docs live at the root (e.g., `elastic/docs-content`). Set to `docs/` for repos with a `docs/` subtree. |
| `target-batch-size` | `100` | Approximate pages per rotating slice (used by the four LLM-driven sweeps; not by typos). |
| `max-per-fix-issue` | `20` | Cap on findings per fix-issue — overflow surfaces in the next sweep. |
| `typos-codespell-args` | `""` | Extra flags passed to codespell (e.g., `--ignore-words=allowlist.txt`). |

## Outputs

Each sweep opens its own labeled fix-issue **in the calling repo** (or calls `noop` if it found nothing actionable):

| Sweep | Label |
|-------|-------|
| frontmatter | `docs-fix:frontmatter` |
| applies-to | `docs-fix:applies-to` |
| openings | `docs-fix:openings` |
| style | `docs-fix:style` |
| typos | `docs-fix:typos` |

All issues also carry the parent label `docs-quality-sweep`. Each sweep auto-closes its prior fix-issue (`close-older-issues: true`) before opening a new one, so the issue tracker doesn't accumulate stale runs.

## Running a subset

Pass a comma-separated list to `sweeps`:

```bash
gh workflow run docs-quality-sweep.yml -f sweeps=frontmatter,typos
```

## Adding a schedule

Once manual runs look right, append a cron trigger:

```yaml
on:
  workflow_dispatch:
    ...
  schedule:
    - cron: '0 9 * * MON'   # Mondays 9am UTC
```

Default `inputs` apply when `schedule` fires.

## Why five workflows instead of one mega-sweep

- Each sweep imports only the skills it needs, keeping prompts focused and findings high-signal.
- Independent failure isolation — a failing skill in one sweep doesn't take down the others.
- Independent cadence (you can schedule typos hourly and style monthly without coupling them).
- Per-category labels (`docs-fix:*`) make output routable — a future fix-agent can subscribe to one label and act on its findings without parsing a multi-section dashboard.
