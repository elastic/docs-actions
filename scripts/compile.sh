#!/usr/bin/env bash
# Compile agentic workflow sources into lock files.
#
# Workflow .md sources live in workflows/ as a library. The gh-aw compiler
# expects them in .github/workflows/, so this script:
#   1. Copies fragments and .md files into .github/workflows/
#   2. Runs gh-aw compile
#   3. Removes the copies (lock files remain)
#
# Usage:
#   ./scripts/compile.sh [path-to-gh-aw-binary]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

GH_AW="${1:-bin/gh-aw}"

if [ ! -x "$GH_AW" ]; then
  echo "Error: gh-aw binary not found at $GH_AW"
  echo "Run 'make setup' first, or pass the path: ./scripts/compile.sh /path/to/gh-aw"
  exit 1
fi

WORKFLOWS_DIR="$REPO_ROOT/workflows"
TARGET_DIR="$REPO_ROOT/.github/workflows"

# Track what we copy so we can clean up
COPIED_FILES=()

cleanup() {
  for f in "${COPIED_FILES[@]}"; do
    rm -f "$f"
  done
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
  COPIED_FILES+=("$TARGET_DIR/$basename")
  echo "Copied $(basename "$(dirname "$md_file")")/$basename → .github/workflows/"
done

if [ ${#COPIED_FILES[@]} -eq 0 ]; then
  echo "No workflow .md files found in $WORKFLOWS_DIR"
  exit 0
fi

# Step 3: Compile
echo ""
echo "Compiling..."
"$GH_AW" compile

# Cleanup happens via trap — .md copies and fragments are removed,
# .lock.yml files remain in .github/workflows/
echo ""
echo "Done. Lock files are in .github/workflows/"
