## Reading Code in Other Repositories

When a check needs source code from a public repository, such as a UI label, a setting name, an event name, or a behavior claim, clone the repository with a sparse checkout and read it locally. Do not start with `search_code`. GitHub limits code search to 10 requests per minute, shared with other runs, and local `grep` has no limit.

1. Find the repository from the page's `products` front matter, the links in the pull request, and the pull request description. Public repositories only.
2. Clone it outside the workspace, with no file contents yet:
   `mkdir -p /tmp/code-refs && git clone --depth 1 --filter=blob:none --sparse --no-tags https://github.com/<owner>/<repo>.git /tmp/code-refs/<repo>`
3. Check out one directory that holds the code you need:
   `git -C /tmp/code-refs/<repo> sparse-checkout set <directory>`
   Use `sparse-checkout add <directory>` to add another one. Never check out a top-level directory such as `src`, `x-pack`, or `packages`: it downloads hundreds of megabytes. If you cannot name a narrower directory, read a known file with `get_file_contents`, or make one `search_code` call to find the directory from the result paths only, then check that directory out.
4. Search with `grep -rn` or `rg` in that directory, and read files with `Read`.
5. Clone at most 2 repositories in the whole run. Reuse a clone for later checks.
6. For a claim about a specific version, clone that branch with `--branch <branch>`, for example `--branch 9.2`. Without `--branch`, the clone is the default branch, so say so when you cite it.
7. Cite the repository, the file path, the line, and the short commit hash from `git -C /tmp/code-refs/<repo> rev-parse --short HEAD`.

Never review, edit, or quote files from `/tmp/code-refs` as part of the pull request. If a clone fails, because the repository is private, missing, or blocked, do not retry more than once. Record the check as `clone failed` with the reason, then continue with the `search_code` budget above.
