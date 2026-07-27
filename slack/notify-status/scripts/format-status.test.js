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

describe('messageText', () => {
  it('combines repository and workflow names', () => {
    assert.equal(messageText('elastic/docs-actions', 'docs-deploy'), 'elastic/docs-actions · docs-deploy');
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
  it('builds a pull request status message with standard blocks', () => {
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
    const serialized = JSON.stringify(message);

    assert.equal(message.text, 'elastic/docs-actions · test-slack-notify-status');
    assert.equal(attachment.color, '#E01E5A');
    assert.equal(attachment.blocks[0].type, 'section');
    assert.match(
      attachment.blocks[0].text.text,
      /Failed  ·  <https:\/\/github.com\/elastic\/docs-actions\/pull\/245\|#245>/
    );
    assert.equal(attachment.blocks[1].type, 'context');
    assert.match(attachment.blocks[1].elements[0].text, /deploy runbook/);
    assert.equal(attachment.blocks[2].type, 'section');
    assert.equal(attachment.blocks[2].text.text, '<https://github.com/elastic/docs-actions/actions/runs/1|View workflow run>');
    assert.equal(attachment.blocks[3].elements[0].text, 'cc <@U0123456789>');
    assert.doesNotMatch(serialized, /"type":"card"/);
    assert.doesNotMatch(serialized, /"type":"actions"/);
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

    const serialized = JSON.stringify(message);

    assert.equal(message.text, 'elastic/docs-actions · docs-deploy');
    assert.match(
      message.attachments[0].blocks[0].text.text,
      /Succeeded  ·  `main`/
    );
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

    const blocks = message.attachments[0].blocks;

    assert.equal(blocks.some((block) => block.type === 'context'), false);
    assert.equal(blocks.some((block) => block.type === 'actions'), false);
    assert.equal(blocks[0].type, 'section');
    assert.match(blocks[0].text.text, /Succeeded  ·  `main`/);
    assert.equal(blocks[1].type, 'section');
    assert.match(blocks[1].text.text, /View workflow run/);
  });
});
