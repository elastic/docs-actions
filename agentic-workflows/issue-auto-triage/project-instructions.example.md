# Project triage instructions

Use this file for repository-specific routing and issue-quality guidance. The reusable workflow
reads it from `.github/triage-instructions.md` by default.

This file complements conventional repository instructions such as `AGENTS.md` and
`.github/copilot-instructions.md`, which the Copilot engine already loads. Do not duplicate broad
authoring or contribution guidance here.

## Ownership

| Team label | Owns | Paths and keywords |
|---|---|---|
| `Team:Admin` | Elasticsearch administration, cluster management, cloud, and deployment docs | `deploy-manage/`, `cloud-account/`, `manage-data/` except `manage-data/ingest/`, `serverless/`, deployment and Elasticsearch troubleshooting |
| `Team:SKI` | Kibana, Observability, Security, and ingest docs | `solutions/observability/`, `solutions/security/`, Kibana, Fleet, Elastic Agent, integrations, APM, OpenTelemetry, `manage-data/ingest/` |
| `Team:Developer` | Elasticsearch development and search docs | `solutions/search/`, Elasticsearch APIs and clients, ES|QL, Query DSL, relevance, vector and semantic search, inference, connectors, machine learning |
| `Team:DocsEng` | Documentation infrastructure | `.github/`, docs build and CI failures, website rendering, broken navigation |
| `Team:Projects` | Documentation initiatives | `get-started/`, content strategy, information architecture, internal documentation projects |

Apply only labels that already exist in this repository. If ownership spans multiple teams, use
`cross-team`. For shared paths, select the team whose subject matter best matches the issue. If
ownership is unclear, omit the team label.

## Project vocabulary

- Treat requests about guides, tutorials, and reference content as `documentation`.
- Treat build, tooling, or rendering failures as `bug` when current behavior is broken.

## Quality expectations

- A documentation request should have a clear, specific title and identify the affected page or
  section.
- It should explain what needs to change and provide a testable desired outcome or definition of
  done.
- Relevant links and resources should be included when they are needed to validate or scope the
  request.
- Screenshots and implementation suggestions are helpful but not required unless the issue cannot
  be understood without them.

These instructions must not change the outcome templates, safe-output limits, security rules,
green reaction-only behavior, or the rule that `human-needed` is the only label for red issues.
