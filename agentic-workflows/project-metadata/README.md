# Project metadata

Analyzes one selected GitHub issue and fills eligible empty fields on an existing GitHub Project
item. The caller owns a profile that defines the project, eligible repositories and labels,
writable fields, option restrictions, and field-specific guidance.

The workflow never scans a full project, adds an issue to a project, overwrites a populated field,
or creates fields and options. It posts no issue comment. Its result appears in the workflow run
summary.

## Trigger

| Event | Description |
|-------|-------------|
| `workflow_dispatch` | A caller selects one issue URL, one profile, and dry-run or write mode. |

The reusable workflow itself uses `workflow_call`. The trigger above is defined by the caller.

## Install

Copy the example caller and profile into the consumer repository:

```bash
mkdir -p .github/workflows .github/project-metadata
curl -sL \
  https://raw.githubusercontent.com/elastic/docs-actions/v1/agentic-workflows/project-metadata/example.yml \
  -o .github/workflows/project-metadata.yml
curl -sL \
  https://raw.githubusercontent.com/elastic/docs-actions/v1/agentic-workflows/project-metadata/project-profile.example.yml \
  -o .github/project-metadata/default.yml
```

Edit the profile before the first run. Keep the first runs in dry-run mode.

## Inputs

| Input | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `issue-url` | string | Yes | — | Full `https://github.com/OWNER/REPO/issues/NUMBER` URL for the one issue to process. |
| `profile-path` | string | No | `.github/project-metadata/default.yml` | Repository-relative path to the selected profile. |
| `dry-run` | boolean | No | `true` | Validate and report proposals without changing project fields. |
| `additional-instructions` | string | No | `""` | Extra analysis guidance. It cannot override the profile or write safeguards. |

## Secrets

| Secret | Required | Description |
|--------|----------|-------------|
| `OPENROUTER_API_KEY` | Yes | Model credential used by the Claude engine. |
| `PROJECT_TOKEN` | Yes | GitHub App installation token or PAT with project read/write access and issue read access for every eligible repository. |

The normal `GITHUB_TOKEN` cannot read or update organization project fields. Prefer a GitHub App
installation token. A deterministic preparation step reads the selected project's current schema
and item values. Only deterministic workflow steps receive the credential directly. The agent
receives the prepared project context without receiving the credential.

## Profile

The profile is a versioned YAML file in the caller repository. See
[`project-profile.example.yml`](project-profile.example.yml).

| Key | Purpose |
|-----|---------|
| `project.owner` and `project.number` | Identify the existing organization project. |
| `eligibility.repositories` | Allowlist issue repositories. |
| `eligibility.required_labels` | Require every listed label before analysis. |
| `fields.<name>.type` | Support `single_select` or `date`. |
| `fields.<name>.enabled` | Allow or disable proposals for that exact field name. |
| `allowed_options` | Optional allowlist for a single-select field. |
| `excluded_options` | Optional denylist for a single-select field. |
| `guidance` | Team-specific evidence and selection rules used by the agent. |

The workflow resolves current fields and options from GitHub on every run. Do not store IDs or
option lists in the profile.

## Eligibility and write safeguards

The issue must be open, come from an allowlisted repository, have every required label, and be an
active item on the configured project. At least one enabled field must be empty for a change to
be possible.

The agent proposes exact current option names and supplies evidence for each value. A deterministic
job then checks the issue, project membership, profile, field type, current options, and current
field values again. It rejects duplicate, disabled, unknown, excluded, invalid, or unsupported
values. Immediately before each write, it confirms that the field is still empty.

Supported field types are single select and date (`YYYY-MM-DD`). Each field is independent, so an
ambiguous Release does not prevent a clear Area from being set.

## Result

The workflow run summary records:

- The issue, selected profile, and mode
- The agent's short analysis
- Each proposed field, value, and evidence
- Whether the result was applied, previewed, or skipped because the field gained a value

When the issue is ineligible, the summary lists the exact reasons and no write occurs.
