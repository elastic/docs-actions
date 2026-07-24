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
    assert.equal(statusColor('success'), 'good');
    assert.equal(statusColor('failure'), 'danger');
    assert.equal(statusColor('cancelled'), 'warning');
    assert.equal(statusColor('unknown'), '#949494');
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
      actor: 'reakaleek',
      eventName: 'pull_request',
      runUrl: 'https://github.com/elastic/docs-actions/actions/runs/1',
    });

    const attachment = message.attachments[0];
    const serialized = JSON.stringify(message);

    assert.match(message.text, /Workflow status: failed/);
    assert.equal(attachment.color, 'danger');
    assert.equal(attachment.fallback, 'Workflow failed · elastic/docs-actions');
    assert.equal(attachment.blocks[0].type, 'header');
    assert.equal(attachment.blocks.some((block) => block.type === 'divider'), true);
    assert.equal(attachment.blocks.some((block) => block.type === 'actions'), true);
    assert.match(serialized, /Deploy failed during smoke tests/);
    assert.match(serialized, /<@U0123456789>/);
    assert.match(serialized, /View workflow run/);
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

    assert.equal(attachment.color, 'good');
    assert.equal(attachment.blocks.some((block) => block.type === 'header'), true);
    assert.equal(attachment.blocks.some((block) => block.type === 'actions'), true);
    assert.equal(attachment.blocks.some((block) => block.type === 'section' && block.text), false);
  });
});
