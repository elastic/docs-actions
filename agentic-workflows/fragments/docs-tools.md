---
# Shared Elastic Docs MCP servers — no `on:` field (shared component, not a runnable workflow)
# Each workflow defines its own tools (github, bash, web-fetch) and base network allows (defaults, github).
# This fragment provides the Elastic Docs MCP server and common Elastic MCP tools.
mcp-servers:
  elastic-docs:
    url: "https://www.elastic.co/docs/_mcp/"
    allowed:
      - "SemanticSearch"
      - "GetDocumentByUrl"
      - "FindRelatedDocs"
      - "FindInconsistencies"
network:
  allowed:
    - "www.elastic.co"
---

## MCP Servers

- **`elastic-docs`** — the Elastic documentation MCP server. Provides tools for searching published documentation, retrieving pages by URL, finding related content, and detecting inconsistencies between code and docs.
  - `SemanticSearch` — search Elastic docs by topic or concept
  - `GetDocumentByUrl` — retrieve a specific documentation page
  - `FindRelatedDocs` — find pages related to a given topic or page
  - `FindInconsistencies` — detect mismatches between code and published docs
