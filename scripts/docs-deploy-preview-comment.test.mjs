// Runs the inline "Comment on PR" script from docs-deploy.yml against a mocked GitHub client.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow = readFileSync(new URL('../.github/workflows/docs-deploy.yml', import.meta.url), 'utf8').split('\n');

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

const script = extractScript('Comment on PR');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const title = '## 🔍 Preview links for changed docs';
const previewUrl = 'https://docs-v3-preview.elastic.dev/elastic/repo/pull/1';

async function runComment({ files, comments = [], previewLinks = '' }) {
  const calls = [];
  const rest = {
    pulls: { listFiles: () => {} },
    issues: {
      // Only github.paginate returns comments, so a lookup that skips pagination finds none.
      listComments: async () => ({ data: [] }),
      updateComment: async (a) => calls.push({ op: 'update', id: a.comment_id, body: a.body }),
      createComment: async (a) => calls.push({ op: 'create', body: a.body }),
    },
  };
  const github = {
    rest,
    paginate: async (fn) => fn === rest.pulls.listFiles ? files.map(filename => ({ filename })) : comments,
  };
  process.env.PR_NUMBER = '1';
  process.env.PATH_PREFIX = '/elastic/repo/pull/1';
  process.env.DOCS_PATH = 'docs';
  process.env.PATH_PATTERN = '';
  process.env.PREVIEW_LINKS = previewLinks;
  await new AsyncFunction('github', 'context', script)(github, { repo: { owner: 'elastic', repo: 'repo' } });
  return calls;
}

const inProgress = { id: 42, user: { type: 'Bot' }, body: `${title}\n\n⏳ Building and deploying preview...` };
const otherComments = Array.from({ length: 40 }, (_, i) => ({ id: i, user: { type: 'User' }, body: 'lgtm' }));

test('replaces the in-progress comment when nothing is linkable', async () => {
  const calls = await runComment({ files: ['src/schema.ts'], comments: [...otherComments, inProgress] });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].op, 'update');
  assert.equal(calls[0].id, 42);
  assert.match(calls[0].body, /No changed pages to link to\./);
  assert.ok(calls[0].body.includes(`[Browse the full preview](${previewUrl})`));
});

test('lists preview-links before changed pages, escaped and encoded', async () => {
  const calls = await runComment({
    files: ['docs/guide.md'],
    comments: [inProgress],
    previewLinks: '/api/elasticsearch/next/\n\napi/get started\n',
  });
  assert.equal(calls[0].op, 'update');
  assert.deepEqual(calls[0].body.split('\n').slice(1), [
    `- [api/elasticsearch/next](${previewUrl}/api/elasticsearch/next)`,
    `- [api/get started](${previewUrl}/api/get%20started)`,
    `- [docs/guide.md](${previewUrl}/guide)`,
  ]);
});

test('says how many links were left out', async () => {
  const files = Array.from({ length: 100 }, (_, i) => `docs/page-${i}.md`);
  const calls = await runComment({ files, previewLinks: 'a\nb\nc\nd\ne' });
  assert.equal(calls[0].op, 'create');
  assert.match(calls[0].body, /Showing 100 of 105 links\. In total, 100 files changed\./);
});
