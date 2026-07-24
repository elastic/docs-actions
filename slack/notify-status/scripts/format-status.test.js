'use strict';

const assert = require('node:assert/strict');
const { describe, it } = require('node:test');

const {
  buildStatusMessage,
  formatMentionToken,
  formatMentions,
  messageText,
  normalizeStatus,
  sourceMetadata,
  statusAlertLevel,
  statusColor,
  truncateText,
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

describe('statusAlertLevel', () => {
  it('maps terminal statuses to alert levels', () => {
    assert.equal(statusAlertLevel('success'), 'success');
    assert.equal(statusAlertLevel('failure'), 'error');
    assert.equal(statusAlertLevel('cancelled'), 'warning');
    assert.equal(statusAlertLevel('unknown'), 'default');
  });
});

describe('messageText', () => {
  it('combines repository and workflow names', () => {
    assert.equal(messageText('elastic/docs-actions', 'docs-deploy'), 'elastic/docs-actions · docs-deploy');
  });
});

describe('truncateText', () => {
  it('truncates long descriptions for card bodies', () => {
    const value = 'x'.repeat(210);
    assert.equal(truncateText(value, 200).length, 200);
    assert.match(truncateText(value, 200), /…$/);
  });
});

describe('sourceMetadata', () => {
  it('links pull request numbers', () => {
    assert.equal(
      sourceMetadata({
        pullRequestNumber: '245',
        pullRequestUrl: 'https://github.com/elastic/docs-actions/pull/245',
      }),
      '<https://github.com/elastic/docs-actions/pull/245|#245>'
    );
  });

  it('links branch and commit for push events', () => {
    assert.equal(
      sourceMetadata({
        eventName: 'push',
        ref: 'main',
        sha: 'a1b2c3d4e5f6789012345678901234567890abcd',
        commitUrl:
          'https://github.com/elastic/docs-actions/commit/a1b2c3d4e5f6789012345678901234567890abcd',
      }),
      '`main`  ·  <https://github.com/elastic/docs-actions/commit/a1b2c3d4e5f6789012345678901234567890abcd|`a1b2c3d`>'
    );
  });
});

describe('buildStatusMessage', () => {
  it('builds a card-based pull request status message', () => {
    const message = buildStatusMessage({
      status: 'failure',
      description: 'See <https://example.com/runbook|the deploy runbook> for recovery steps.',
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
    const card = attachment.blocks[0];
    const serialized = JSON.stringify(message);

    assert.equal(message.text, 'elastic/docs-actions · test-slack-notify-status');
    assert.equal(message.statusAlertLevel, 'error');
    assert.equal(attachment.color, '#E01E5A');
    assert.equal(card.type, 'card');
    assert.equal(card.title.text, 'elastic/docs-actions · test-slack-notify-status');
    assert.match(card.subtitle.text, /Failed  ·  <https:\/\/github.com\/elastic\/docs-actions\/pull\/245\|#245>/);
    assert.match(card.body.text, /deploy runbook/);
    assert.equal(card.subtext.text, 'cc <@U0123456789>');
    assert.equal(card.actions[0].url, 'https://github.com/elastic/docs-actions/actions/runs/1');
    assert.doesNotMatch(serialized, /"type":"alert"/);
    assert.doesNotMatch(serialized, /"type":"divider"/);
  });

  it('builds a push status message with branch and commit metadata', () => {
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

    const card = message.attachments[0].blocks[0];
    const serialized = JSON.stringify(message);

    assert.equal(message.text, 'elastic/docs-actions · docs-deploy');
    assert.equal(message.statusAlertLevel, 'success');
    assert.match(card.subtitle.text, /Succeeded  ·  `main`/);
    assert.match(
      serialized,
      /<https:\/\/github.com\/elastic\/docs-actions\/commit\/a1b2c3d4e5f6789012345678901234567890abcd\|`a1b2c3d`>/
    );
  });

  it('omits optional card fields when values are empty', () => {
    const message = buildStatusMessage({
      status: 'success',
      repository: 'elastic/docs-actions',
      workflow: 'docs-deploy',
      ref: 'main',
      runUrl: 'https://github.com/elastic/docs-actions/actions/runs/2',
    });

    const card = message.attachments[0].blocks[0];

    assert.equal(message.statusAlertLevel, 'success');
    assert.equal(card.body, undefined);
    assert.equal(card.subtext, undefined);
    assert.equal(card.actions.length, 1);
  });
});
