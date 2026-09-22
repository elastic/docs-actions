'use strict';

const assert = require('node:assert/strict');
const { describe, it } = require('node:test');

const { detectDocsRoot } = require('./detect-docs-root.js');

describe('detectDocsRoot', () => {
  it('returns the fallback when a changed file already matches it', () => {
    assert.equal(detectDocsRoot(['docs/section/page.md'], 'docs'), 'docs');
  });

  it('infers the top-level directory when files share one', () => {
    const files = [
      'new-docs/section/page.md',
      'new-docs/other/page.md',
    ];
    assert.equal(detectDocsRoot(files, 'docs'), 'new-docs');
  });

  it('strips only the top-level dir for a single nested file (the original bug)', () => {
    const files = ['new-docs/internal/how-we-handle-dependency-updates/index.md'];
    assert.equal(detectDocsRoot(files, 'docs'), 'new-docs');
  });

  it('falls back when files span multiple top-level directories', () => {
    const files = ['new-docs/page.md', 'other/page.md'];
    assert.equal(detectDocsRoot(files, 'docs'), 'docs');
  });

  it('falls back for an empty file list', () => {
    assert.equal(detectDocsRoot([], 'docs'), 'docs');
  });
});
