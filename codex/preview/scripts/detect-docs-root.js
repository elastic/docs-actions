'use strict';

/**
 * Returns the docs root directory to use when building preview URLs.
 *
 * Uses `fallback` when any changed file already starts with it.
 * Otherwise infers the root from the single top-level directory that
 * all changed files share; falls back when they span more than one.
 *
 * @param {string[]} files - Repo-relative paths of changed Markdown files.
 * @param {string} fallback - Configured docs root (e.g. "docs").
 * @returns {string}
 */
function detectDocsRoot(files, fallback) {
  if (files.some(f => f.startsWith(fallback + '/'))) return fallback;
  const topDirs = [...new Set(files.map(f => f.split('/')[0]).filter(Boolean))];
  return topDirs.length === 1 ? topDirs[0] : fallback;
}

module.exports = { detectDocsRoot };
