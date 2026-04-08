#!/usr/bin/env bash
# Compile agentic workflow sources into lock files.
#
# Workflow .md sources live in agentic-workflows/ as a library. The gh-aw compiler
# expects them in .github/workflows/, so this script:
#   1. Copies fragments and .md files into .github/workflows/
#   2. Runs gh-aw compile
#   3. Removes fragments (lock files and .md sources remain)
#
# Usage:
#   ./scripts/compile.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

if ! gh aw --help >/dev/null 2>&1; then
  echo "Error: gh-aw extension not installed. Run 'make setup' first."
  exit 1
fi

WORKFLOWS_DIR="$REPO_ROOT/agentic-workflows"
TARGET_DIR="$REPO_ROOT/.github/workflows"

# Fragments are only needed during compilation and can be removed after.
# Workflow .md sources must remain — gh-aw verifies the lock file's
# frontmatter hash against the .md source at runtime.
cleanup() {
  rm -rf "$TARGET_DIR/gh-aw-fragments"
}
trap cleanup EXIT

# Step 1: Copy fragments
if [ -d "$WORKFLOWS_DIR/fragments" ]; then
  mkdir -p "$TARGET_DIR/gh-aw-fragments"
  cp "$WORKFLOWS_DIR/fragments/"*.md "$TARGET_DIR/gh-aw-fragments/"
  echo "Copied fragments → .github/workflows/gh-aw-fragments/"
fi

# Step 2: Copy workflow .md files
for md_file in "$WORKFLOWS_DIR"/*/gh-aw-*.md; do
  [ -f "$md_file" ] || continue
  basename="$(basename "$md_file")"
  cp "$md_file" "$TARGET_DIR/$basename"
  echo "Copied $(basename "$(dirname "$md_file")")/$basename → .github/workflows/"
done

# Step 3: Compile
echo ""
echo "Compiling..."
gh aw compile

# Cleanup happens via trap — fragments are removed.
# .md sources and .lock.yml files remain in .github/workflows/
echo ""
echo "Done. Lock files are in .github/workflows/"
