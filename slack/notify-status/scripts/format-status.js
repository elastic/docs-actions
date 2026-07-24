'use strict';

const STATUS_COLORS = {
  success: 'good',
  failure: 'danger',
  cancelled: 'warning',
  skipped: '#949494',
};

const STATUS_HEADERS = {
  success: 'Workflow succeeded',
  failure: 'Workflow failed',
  cancelled: 'Workflow cancelled',
  skipped: 'Workflow skipped',
};

const STATUS_EMOJI = {
  success: ':white_check_mark:',
  failure: ':x:',
  cancelled: ':warning:',
  skipped: ':fast_forward:',
};

function normalizeStatus(status) {
  const value = String(status || '').trim().toLowerCase();
  if (!value) {
    return 'unknown';
  }
  return value;
}

function statusColor(status) {
  return STATUS_COLORS[status] || '#949494';
}

function statusHeader(status) {
  if (STATUS_HEADERS[status]) {
    return STATUS_HEADERS[status];
  }

  const label = status.charAt(0).toUpperCase() + status.slice(1);
  return `Workflow ${label}`;
}

function statusEmoji(status) {
  return STATUS_EMOJI[status] || ':grey_question:';
}

function formatMentionToken(raw) {
  const value = String(raw || '').trim();
  if (!value) {
    return '';
  }

  if (value.startsWith('<@') || value.startsWith('<!')) {
    return value;
  }

  if (/^U[A-Z0-9]+$/i.test(value)) {
    return `<@${value.toUpperCase()}>`;
  }

  if (/^S[A-Z0-9]+$/i.test(value)) {
    return `<!subteam^${value.toUpperCase()}>`;
  }

  if (value.startsWith('@')) {
    return value;
  }

  return value;
}

function formatMentions(raw) {
  if (!raw) {
    return '';
  }

  return raw
    .split(',')
    .map((part) => formatMentionToken(part))
    .filter(Boolean)
    .join(' ');
}

function fieldBlock(label, value) {
  return {
    type: 'mrkdwn',
    text: `*${label}*\n${value}`,
  };
}

function contextLine(parts) {
  const text = parts.filter(Boolean).join('  ·  ');
  if (!text) {
    return null;
  }

  return {
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text,
      },
    ],
  };
}

function buildStatusMessage({
  status,
  description = '',
  mention = '',
  repository = '',
  workflow = '',
  ref = '',
  actor = '',
  eventName = '',
  runUrl = '',
}) {
  const normalizedStatus = normalizeStatus(status);
  const emoji = statusEmoji(normalizedStatus);
  const headerText = statusHeader(normalizedStatus);
  const blocks = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: `${emoji} ${headerText}`,
        emoji: true,
      },
    },
  ];

  const summary = contextLine([
    repository ? `*Repository:* \`${repository}\`` : '',
    workflow ? `*Workflow:* \`${workflow}\`` : '',
    ref ? `*Ref:* \`${ref}\`` : '',
  ]);
  if (summary) {
    blocks.push(summary);
  }

  blocks.push({ type: 'divider' });

  const trimmedDescription = String(description || '').trim();
  if (trimmedDescription) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Summary*\n${trimmedDescription}`,
      },
    });
  }

  const detailFields = [];
  if (actor) {
    detailFields.push(fieldBlock('Actor', actor));
  }
  if (eventName) {
    detailFields.push(fieldBlock('Event', `\`${eventName}\``));
  }
  if (workflow && !summary) {
    detailFields.push(fieldBlock('Workflow', workflow));
  }
  if (ref && !summary) {
    detailFields.push(fieldBlock('Ref', `\`${ref}\``));
  }

  if (detailFields.length > 0) {
    blocks.push({
      type: 'section',
      fields: detailFields,
    });
  }

  if (runUrl) {
    blocks.push({
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: {
            type: 'plain_text',
            text: 'View workflow run',
            emoji: true,
          },
          url: runUrl,
        },
      ],
    });
  }

  const formattedMention = formatMentions(mention);
  if (formattedMention) {
    blocks.push(contextLine([`*Notify:* ${formattedMention}`]));
  }

  const fallbackParts = [headerText.replace(/^Workflow /, 'Workflow status: ')];
  if (repository) {
    fallbackParts.push(repository);
  }
  if (workflow) {
    fallbackParts.push(workflow);
  }
  if (runUrl) {
    fallbackParts.push(runUrl);
  }

  return {
    text: fallbackParts.join(' · '),
    attachments: [
      {
        color: statusColor(normalizedStatus),
        fallback: `${headerText}${repository ? ` · ${repository}` : ''}`,
        blocks,
      },
    ],
  };
}

module.exports = {
  buildStatusMessage,
  formatMentionToken,
  formatMentions,
  normalizeStatus,
  statusColor,
  statusEmoji,
  statusHeader,
};
