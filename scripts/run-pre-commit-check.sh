#!/usr/bin/env bash

set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
snapshot_index="$(mktemp "${TMPDIR:-/tmp}/docs-actions-lint-index.XXXXXX")"
snapshot_worktree="$(mktemp -d "${TMPDIR:-/tmp}/docs-actions-lint-worktree.XXXXXX")"
worktree_registered=false

cleanup() {
  if [[ "${worktree_registered}" == true ]]; then
    git -C "${repo_root}" worktree remove --force "${snapshot_worktree}" >/dev/null 2>&1 || true
  else
    rmdir "${snapshot_worktree}" >/dev/null 2>&1 || true
  fi
  rm -f "${snapshot_index}"
}
trap cleanup EXIT

cd "${repo_root}"

# Build a temporary index from the current checkout. This includes staged,
# unstaged, deleted, and untracked files without changing the real index.
cp "$(git rev-parse --git-path index)" "${snapshot_index}"
GIT_INDEX_FILE="${snapshot_index}" git add --all
snapshot_tree="$(GIT_INDEX_FILE="${snapshot_index}" git write-tree)"

# Force real symlinks in the disposable checkout. This keeps the check correct
# even when the active checkout uses core.symlinks=false.
git -c core.symlinks=true worktree add --detach "${snapshot_worktree}" HEAD >/dev/null
worktree_registered=true
git -C "${snapshot_worktree}" -c core.symlinks=true read-tree --reset -u "${snapshot_tree}"

echo "Running pre-commit in an isolated snapshot..."
(
  cd "${snapshot_worktree}"
  pre-commit run --all-files --show-diff-on-failure
)
