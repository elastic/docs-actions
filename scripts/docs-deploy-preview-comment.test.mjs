// Runs the inline preview comment scripts from docs-deploy.yml against a mocked GitHub client.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow = readFileSync(new URL('../.github/workflows/docs-deploy.yml', import.meta.url), 'utf8').split('\n');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

function extractScript(stepName) {
  const step = workflow.findIndex(l => l.trim() === `- name: ${stepName}`);
  assert.notEqual(step, -1, `step "${stepName}" not found`);
  const start = workflow.findIndex((l, i) => i > step && l.trim() === 'script: |') + 1;
  const indent = workflow[start].match(/^ */)[0].length;
  const lines = [];
  for (let i = start; i < workflow.length; i++) {
    const line = workflow[i];
    if (line.trim() !== '' && line.match(/^ */)[0].length < indent) break;
    lines.push(line.slice(indent));
  }
  return lines.join('\n');
}

const title = '## 🔍 Preview links for changed docs';
const previewUrl = 'https://docs-v3-preview.elastic.dev/elastic/repo/pull/1';
const inProgress = { id: 42, user: { type: 'Bot' }, body: `${title}\n\n⏳ Building and deploying preview...` };
// 40 comments push the preview comment past the first page of 30.
const busyPr = [...Array.from({ length: 40 }, (_, i) => ({ id: i, user: { type: 'User' }, body: 'lgtm' })), inProgress];

async function runStep(stepName, { files = [], comments = [], previewLinks = '' }) {
  const calls = [];
  const rest = {
    pulls: { listFiles: () => {} },
    issues: {
      // Only github.paginate returns comments, so a lookup that reads one page finds none.
      listComments: async () => ({ data: [] }),
      updateComment: async (a) => calls.push({ op: 'update', id: a.comment_id, body: a.body }),
      createComment: async (a) => calls.push({ op: 'create', body: a.body }),
    },
  };
  const github = {
    rest,
    paginate: async (fn) => fn === rest.pulls.listFiles ? files.map(filename => ({ filename })) : comments,
  };
  Object.assign(process.env, {
    PR_NUMBER: '1',
    PATH_PREFIX: '/elastic/repo/pull/1',
    DOCS_PATH: 'docs',
    PATH_PATTERN: '',
    PREVIEW_LINKS: previewLinks,
  });
  const context = { repo: { owner: 'elastic', repo: 'repo' }, runId: 7 };
  await new AsyncFunction('github', 'context', extractScript(stepName))(github, context);
  return calls;
}

test('pre-comment updates the existing comment past the first page', async () => {
  const calls = await runStep('Update comment to in-progress', { comments: busyPr });
  assert.deepEqual(calls.map(c => [c.op, c.id]), [['update', 42]]);
});

test('comment replaces the in-progress comment when nothing is linkable', async () => {
  const calls = await runStep('Comment on PR', { files: ['src/schema.ts'], comments: busyPr });
  assert.deepEqual(calls.map(c => [c.op, c.id]), [['update', 42]]);
  assert.ok(calls[0].body.includes(`No direct page links are available.\n[Browse the full preview](${previewUrl})`));
  assert.doesNotMatch(calls[0].body, /only changes snippets/);
});

test('comment keeps the snippet explanation for snippet-only PRs', async () => {
  const calls = await runStep('Comment on PR', { files: ['docs/_snippets/note.md', 'docs/data.csv'] });
  assert.deepEqual(calls.map(c => c.op), ['create']);
  assert.match(calls[0].body, /This PR only changes snippets or data files\./);
});

test('comment lists preview-links first, with escaped labels and raw destinations', async () => {
  const calls = await runStep('Comment on PR', {
    files: ['docs/guide.md'],
    previewLinks: '/api/elasticsearch/next/\n\napi/get started\napi/[beta]\napi/get%20started\napi/<x>\n',
  });
  assert.deepEqual(calls.map(c => c.op), ['create']);
  assert.deepEqual(calls[0].body.split('\n').slice(1), [
    `- [api/elasticsearch/next](<${previewUrl}/api/elasticsearch/next>)`,
    `- [api/get started](<${previewUrl}/api/get started>)`,
    `- [api/\\[beta\\]](<${previewUrl}/api/[beta]>)`,
    `- [api/get%20started](<${previewUrl}/api/get%20started>)`,
    `- [api/\\<x\\>](<${previewUrl}/api/%3Cx%3E>)`,
    `- [docs/guide.md](<${previewUrl}/guide>)`,
  ]);
});

test('comment says how many links were left out', async () => {
  const files = Array.from({ length: 100 }, (_, i) => `docs/page-${i}.md`);
  const calls = await runStep('Comment on PR', { files, previewLinks: 'a\nb\nc\nd\ne' });
  assert.deepEqual(calls.map(c => c.op), ['create']);
  assert.match(calls[0].body, /Showing 100 of 105 links\. In total, 100 files changed\./);
});
