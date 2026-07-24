# Docs quality sweep (orchestrator)

A `workflow_dispatch`-triggered orchestrator that fans out to all seven docs quality sweep workflows in parallel jobs. Use this in your docs repo as the single entry point: one click runs frontmatter, applies_to, openings, style, typos, staleness, and coherence in one go (or any subset).

Each sweep is independent: a failure in one job doesn't kill the others, and each opens its own labeled fix-issue.

## Where to find results

After the orchestrator dispatches the selected sweeps, its Actions summary lists a link to each child workflow run. Open a child run to review its logs and outcome.

The orchestrator does not wait for child runs or aggregate their findings. When a sweep finds actionable results, it opens its own labeled fix-issue in the calling repository. A sweep that finds nothing actionable reports `noop` in its child run.

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

Pass `DOCS_LITELLM_API_KEY` via a repository or organization secret. The caller job must forward it:

```yaml
    secrets:
      DOCS_LITELLM_API_KEY: ${{ secrets.DOCS_LITELLM_API_KEY }}
```

Run via the Actions UI or:

```bash
gh workflow run docs-quality-sweep.yml \
  -f sweeps=all \
  -f source-repo=elastic/docs-content \
  -f docs-root=. \
  -f target-path=/solutions/observability \
  -f scope-mode=shard \
  -f target-batch-size=100 \
  -f max-per-fix-issue=20
```

## Inputs

| Input | Default | Description |
|-------|---------|-------------|
| `sweeps` | `all` | Comma-separated list of sweep names: `frontmatter`, `applies-to`, `openings`, `style`, `typos`, `staleness`, `coherence`. Use `all` to run every sweep. |
| `source-repo` | `elastic/docs-content` | Repository to scan, as `owner/repo`. Set to empty to scan the calling repo. |
| `docs-root` | `.` | Root directory inside the source repo. `.` works for repos where docs live at the root (e.g., `elastic/docs-content`). Set to `docs/` for repos with a `docs/` subtree. |
| `target-path` | `""` | Optional `docs-root`-relative directory to sweep recursively. Accepts a leading slash, such as `/solutions/observability`. |
| `scope-mode` | `auto` | Scope behavior for the matched markdown files. `auto` preserves the existing behavior, `full` scans all matched files, and `shard` shards within the matched set. |
| `target-batch-size` | `100` | Approximate pages per rotating slice when `scope-mode` resolves to `shard`. |
| `max-per-fix-issue` | `20` | Cap on findings per fix-issue — overflow surfaces in the next sweep. |
| `typos-codespell-args` | `""` | Extra flags passed to codespell (e.g., `--ignore-words=allowlist.txt`). |
| `staleness-content-months` | `24` | Flag pages whose latest commit is older than this. |
| `coherence-batch-size` | `50` | Smaller per-slice cap for the coherence sweep, since each in-scope page produces multiple MCP fetches and LLM comparisons. |

## Outputs

Each sweep opens its own labeled fix-issue **in the calling repo** (or calls `noop` if it found nothing actionable):

| Sweep | Label |
|-------|-------|
| frontmatter | `docs-fix:frontmatter` |
| applies-to | `docs-fix:applies-to` |
| openings | `docs-fix:openings` |
| style | `docs-fix:style` |
| typos | `docs-fix:typos` |
| staleness | `docs-fix:staleness` |
| coherence | `docs-fix:coherence` |

All issues also carry the parent label `docs-quality-sweep`. Sweep issues stay open until maintainers close them or a fixing PR resolves them.

## Skill mapping

The orchestrator does not import APM skills directly. Each child sweep owns its own skill mapping so only strong workflow-to-skill matches are installed, and workflows without a strong public `elastic-docs-skills` match can keep relying on embedded rules and deterministic pre-steps.

## Running a subset

Pass a comma-separated list to `sweeps`:

```bash
gh workflow run docs-quality-sweep.yml -f sweeps=frontmatter,typos
```

## Running a subtree

Pass `target-path` to scope the sweep to one subtree under `docs-root`:

```bash
gh workflow run docs-quality-sweep.yml \
  -f sweeps=all \
  -f source-repo=elastic/docs-content \
  -f docs-root=. \
  -f target-path=/solutions/observability \
  -f scope-mode=full
```

To shard within a large subtree instead of scanning it all at once:

```bash
gh workflow run docs-quality-sweep.yml \
  -f sweeps=all \
  -f source-repo=elastic/docs-content \
  -f docs-root=. \
  -f target-path=/solutions/observability \
  -f scope-mode=shard \
  -f target-batch-size=100
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

## Why seven workflows instead of one mega-sweep

- Each sweep owns a focused, self-contained prompt so findings stay high-signal.
- Independent failure isolation — a failure in one sweep doesn't take down the others.
- Independent cadence (you can schedule typos hourly and coherence monthly without coupling them).
- Per-category labels (`docs-fix:*`) make output routable — a future fix-agent can subscribe to one label and act on its findings without parsing a multi-section dashboard.
