'use strict';

/**
 * Returns the docs root directory to use when building preview URLs.
 *
 * - '.' and '' mean docs are at the repo root; returns '' so no prefix is stripped.
 * - Returns `fallback` when any changed file already starts with it.
 * - Otherwise infers the root from the single top-level directory shared by all
 *   files that contain a path separator; root-level files (e.g. CHANGELOG.md)
 *   are excluded so they do not poison detection in mixed change sets.
 * - Falls back when the remaining files span more than one top-level directory.
 *
 * @param {string[]} files - Repo-relative paths of changed Markdown files.
 * @param {string} fallback - Configured docs root (e.g. "docs").
 * @returns {string}
 */
function detectDocsRoot(files, fallback) {
  // '.' and '' both mean "repo root" — no prefix to strip.
  if (fallback === '.' || fallback === '') return '';

  if (files.some(f => f.startsWith(fallback + '/'))) return fallback;

  // Exclude root-level files (no '/') before inferring the top-level dir.
  // Files like CHANGELOG.md or README.md are not doc pages and should not
  // influence which directory is considered the docs root.
  const dirFiles = files.filter(f => f.includes('/'));
  if (dirFiles.length === 0) return fallback;

  const topDirs = [...new Set(dirFiles.map(f => f.split('/')[0]))];
  return topDirs.length === 1 ? topDirs[0] : fallback;
}

module.exports = { detectDocsRoot };
