## Reading Code in Other Repositories

When a check needs source code from a public repository, such as a UI label, a setting name, an event name, or a behavior claim, clone the repository with a sparse checkout and read it locally. Use `search_code` only as a fallback. A local `grep` covers every file in the directory, and `search_code` returns a few hits at a time.

1. Find the repository from the page's `products` front matter, the links and the description in the pull request or issue, and the repository the linked code is in. Public repositories only.
2. Clone it outside the workspace, with no file contents yet:
   `mkdir -p /tmp/code-refs && git clone --depth 1 --filter=blob:none --sparse --no-tags https://github.com/<owner>/<repo>.git /tmp/code-refs/<repo>`
3. Find the directory without downloading files. The clone already holds the full list of paths, so searching it is fast and free:
   `git -C /tmp/code-refs/<repo> ls-tree -r --name-only HEAD | grep -i '<name>'`
   Search for a file or directory name you expect, such as a feature name, a plugin name, or the part of a setting name before the last dot. Choose the directory that holds the matching files.
4. Check out that directory:
   `git -C /tmp/code-refs/<repo> sparse-checkout set <directory>`
   Use `sparse-checkout add <directory>` to add another one. Never check out a top-level directory such as `src`, `x-pack`, or `packages`: it downloads hundreds of megabytes. If the path list does not show the directory, because you only know a string that appears in file contents, call `search_code` and use the result paths to pick the directory.
5. Search with `grep -rn` or `rg` in that directory, and read files with `Read`.
6. Clone at most 2 repositories in the whole run. Reuse a clone for later checks.
7. For a claim about a specific version, clone that branch with `--branch <branch>`, for example `--branch 9.2`. Without `--branch`, the clone is the default branch, so say so when you cite it.
8. Cite the repository, the file path, the line, and the short commit hash from `git -C /tmp/code-refs/<repo> rev-parse --short HEAD`.

Never review, edit, or quote files from `/tmp/code-refs` as part of the pull request or issue you are working on. If a clone fails, because the repository is private, missing, or blocked, do not retry more than once. Record the check as `clone failed` with the reason, then use `search_code` as the fallback.
