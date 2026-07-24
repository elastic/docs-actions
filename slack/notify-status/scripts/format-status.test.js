'use strict';

const assert = require('node:assert/strict');
const { describe, it } = require('node:test');

const {
  buildStatusMessage,
  formatMentionToken,
  formatMentions,
  normalizeStatus,
  statusColor,
} = require('./format-status.js');

describe('normalizeStatus', () => {
  it('normalizes known statuses', () => {
    assert.equal(normalizeStatus('Success'), 'success');
    assert.equal(normalizeStatus(' FAILURE '), 'failure');
  });

  it('returns unknown for empty values', () => {
    assert.equal(normalizeStatus(''), 'unknown');
  });
});

describe('formatMentionToken', () => {
  it('wraps Slack user IDs', () => {
    assert.equal(formatMentionToken('U0123456789'), '<@U0123456789>');
  });

  it('wraps Slack subteam IDs', () => {
    assert.equal(formatMentionToken('S0123456789'), '<!subteam^S0123456789>');
  });

  it('passes through formatted tokens', () => {
    assert.equal(formatMentionToken('<@U0123456789>'), '<@U0123456789>');
    assert.equal(
      formatMentionToken('<!subteam^S0123456789|@docs-team>'),
      '<!subteam^S0123456789|@docs-team>'
    );
  });
});

describe('formatMentions', () => {
  it('joins comma-separated mentions', () => {
    assert.equal(
      formatMentions('U0123456789, S0987654321'),
      '<@U0123456789> <!subteam^S0987654321>'
    );
  });
});

describe('statusColor', () => {
  it('maps terminal statuses to Slack colors', () => {
    assert.equal(statusColor('success'), '#2EB67D');
    assert.equal(statusColor('failure'), '#E01E5A');
    assert.equal(statusColor('cancelled'), '#ECB22E');
    assert.equal(statusColor('unknown'), '#9CA3AF');
  });
});

describe('buildStatusMessage', () => {
  it('builds a rich colored attachment with metadata blocks', () => {
    const message = buildStatusMessage({
      status: 'failure',
      description: 'Deploy failed during smoke tests.',
      mention: 'U0123456789',
      repository: 'elastic/docs-actions',
      workflow: 'test-slack-notify-status',
      ref: 'main',
      eventName: 'pull_request',
      pullRequestNumber: '245',
      pullRequestUrl: 'https://github.com/elastic/docs-actions/pull/245',
      runUrl: 'https://github.com/elastic/docs-actions/actions/runs/1',
    });

    const attachment = message.attachments[0];
    const serialized = JSON.stringify(message);

    assert.equal(message.text, 'Workflow failed');
    assert.equal(attachment.color, '#E01E5A');
    assert.equal(attachment.fallback, 'Workflow failed · elastic/docs-actions');
    assert.equal(attachment.blocks.some((block) => block.type === 'header'), false);
    assert.equal(attachment.blocks.some((block) => block.type === 'divider'), true);
    assert.equal(attachment.blocks.some((block) => block.type === 'actions'), true);
    assert.equal(
      attachment.blocks.some(
        (block) => block.type === 'section' && Array.isArray(block.fields)
      ),
      false
    );
    assert.match(serialized, /Deploy failed during smoke tests/);
    assert.doesNotMatch(serialized, /Summary/);
    assert.doesNotMatch(serialized, /Actor/);
    assert.doesNotMatch(serialized, /Event/);
    assert.match(serialized, /<https:\/\/github.com\/elastic\/docs-actions\/pull\/245\|#245>/);
    assert.match(serialized, /<@U0123456789>/);
    assert.match(serialized, /View workflow run/);
  });

  it('links the branch and commit for push events', () => {
    const message = buildStatusMessage({
      status: 'success',
      repository: 'elastic/docs-actions',
      workflow: 'docs-deploy',
      ref: 'main',
      eventName: 'push',
      sha: 'a1b2c3d4e5f6789012345678901234567890abcd',
      commitUrl:
        'https://github.com/elastic/docs-actions/commit/a1b2c3d4e5f6789012345678901234567890abcd',
      runUrl: 'https://github.com/elastic/docs-actions/actions/runs/2',
    });

    const serialized = JSON.stringify(message);

    assert.equal(message.text, 'Workflow succeeded');
    assert.match(serialized, /`main`/);
    assert.match(
      serialized,
      /<https:\/\/github.com\/elastic\/docs-actions\/commit\/a1b2c3d4e5f6789012345678901234567890abcd\|`a1b2c3d`>/
    );
  });

  it('omits optional sections when values are empty', () => {
    const message = buildStatusMessage({
      status: 'success',
      repository: 'elastic/docs-actions',
      workflow: 'docs-deploy',
      ref: 'main',
      runUrl: 'https://github.com/elastic/docs-actions/actions/runs/2',
    });

    const attachment = message.attachments[0];

    assert.equal(attachment.color, '#2EB67D');
    assert.equal(attachment.blocks.some((block) => block.type === 'header'), false);
    assert.equal(attachment.blocks.some((block) => block.type === 'actions'), true);
    assert.equal(attachment.blocks.some((block) => block.type === 'section' && block.text), false);
  });
});
