## Code Search Limits

GitHub limits code search (`search_code`) to 10 requests per minute. Other runs can share that limit, so a search can fail with a rate-limit error even when this run made few calls.

- Make at most 6 `search_code` calls in the whole run, and make them one at a time.
- Put several terms in one query when you can, with quoted phrases and `OR`, instead of one call per term.
- When you know the path of a file, read it with `get_file_contents`. Use `search_code` only to find where something occurs.
- When a search fails with a rate-limit error, do not retry at once. Finish other work first, then retry the same query once. If it fails again, record the check as rate limited and continue without it.
- Never describe a rate-limited search as a search that found nothing or as a check that passed. Say that it was rate limited.
