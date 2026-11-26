// Licensed to Elasticsearch B.V under one or more agreements.
// Elasticsearch B.V licenses this file to you under the Apache 2.0 License.
// See the LICENSE file in the project root for more information

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { MARKER, planLabels, publish } = require('./publish.js');

const LIGHT = 'review: light';
const FULL = 'review: full';
const SHA = 'a'.repeat(40);

function fakeGithub({ labels = [], comments = [], headSha = SHA, existingLabels = [LIGHT, FULL] } = {}) {
  const calls = [];
  const record = (name) => async (args) => {
    calls.push([name, args]);
    return { data: {} };
  };
  const notFound = () => Object.assign(new Error('Not Found'), { status: 404 });
  return {
    calls,
    paginate: async () => comments,
    rest: {
      pulls: {
        get: async () => ({ data: { head: { sha: headSha }, labels: labels.map((name) => ({ name })) } }),
      },
      issues: {
        listComments: () => {},
        getLabel: async ({ name }) => {
          if (!existingLabels.includes(name)) throw notFound();
          return { data: { name } };
        },
        createLabel: record('createLabel'),
        addLabels: record('addLabels'),
        removeLabel: record('removeLabel'),
        createComment: record('createComment'),
        updateComment: record('updateComment'),
        deleteComment: record('deleteComment'),
      },
    },
  };
}

const core = { info() {}, notice() {}, warning() {} };
const context = { repo: { owner: 'elastic', repo: 'docs-content' } };

function decision(tier, extra = {}) {
  return { tier, head_sha: SHA, bot_labels: [], ...extra };
}

async function run(github, dec, body = `${MARKER}\nbody`) {
  return publish({ github, context, core, prNumber: 5, decision: dec, body, lightLabel: LIGHT, fullLabel: FULL });
}

test('planLabels adds the tier label and removes the other one', () => {
  assert.deepEqual(planLabels({ tier: 'full', botLabels: [], current: [LIGHT], lightLabel: LIGHT, fullLabel: FULL }),
    { add: [FULL], remove: [LIGHT] });
  assert.deepEqual(planLabels({ tier: 'light', botLabels: [], current: [LIGHT], lightLabel: LIGHT, fullLabel: FULL }),
    { add: [], remove: [] });
  assert.deepEqual(planLabels({ tier: 'skip', botLabels: [FULL], current: [FULL, LIGHT], lightLabel: LIGHT, fullLabel: FULL }),
    { add: [], remove: [FULL] });
});

test('creates a comment and adds the label', async () => {
  const github = fakeGithub();
  const result = await run(github, decision('full'));
  assert.equal(result.status, 'created');
  assert.deepEqual(github.calls.map(([name]) => name), ['addLabels', 'createComment']);
});

test('updates only the bot comment that has the marker', async () => {
  const github = fakeGithub({
    labels: [FULL],
    comments: [
      { id: 1, user: { login: 'octocat' }, body: `${MARKER}\nfake` },
      { id: 2, user: { login: 'github-actions[bot]' }, body: `${MARKER}\nold` },
    ],
  });
  const result = await run(github, decision('full'));
  assert.equal(result.status, 'updated');
  assert.deepEqual(github.calls, [['updateComment', { owner: 'elastic', repo: 'docs-content', comment_id: 2, body: `${MARKER}\nbody` }]]);
});

test('does not touch the PR when the head moved', async () => {
  const github = fakeGithub({ headSha: 'b'.repeat(40) });
  const result = await run(github, decision('full'));
  assert.equal(result.status, 'stale');
  assert.deepEqual(github.calls, []);
});

test('skip deletes the comment and removes bot labels only', async () => {
  const github = fakeGithub({
    labels: [LIGHT],
    comments: [{ id: 9, user: { login: 'github-actions[bot]' }, body: `${MARKER}\nold` }],
  });
  const result = await run(github, decision('skip', { bot_labels: [LIGHT] }));
  assert.equal(result.status, 'deleted');
  assert.deepEqual(github.calls.map(([name]) => name), ['removeLabel', 'deleteComment']);
});

test('creates a missing label before it adds it', async () => {
  const github = fakeGithub({ existingLabels: [] });
  await run(github, decision('light'));
  assert.deepEqual(github.calls.map(([name]) => name), ['createLabel', 'addLabels', 'createComment']);
});
