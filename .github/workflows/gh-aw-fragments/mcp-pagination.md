## MCP Pagination

MCP tool responses have a **25,000 token limit**. When responses exceed this limit, the call fails and you must retry with pagination — wasting turns and tokens. Use proactive pagination to stay under the limit.

### Recommended `perPage` Values

- **5-10**: For detailed items (PR diffs, files with patches, issues with comments)
- **20-30**: For medium-detail lists (commits, review comments, issue lists)
- **50-100**: For simple list operations (branches, labels, tags)

### Pagination Pattern

When you need all results from a paginated API:

1. Fetch the first page with a conservative `perPage` value
2. Process the results before fetching the next page
3. Continue fetching pages until you receive fewer results than `perPage` (indicating the last page)

If you see `MCP tool response exceeds maximum allowed tokens`, retry with a smaller `perPage` value (halve it).
