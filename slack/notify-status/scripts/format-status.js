'use strict';

const STATUS_COLORS = {
  success: '#2EB67D',
  failure: '#E01E5A',
  cancelled: '#ECB22E',
  skipped: '#9CA3AF',
};

const STATUS_HEADERS = {
  success: 'Workflow succeeded',
  failure: 'Workflow failed',
  cancelled: 'Workflow cancelled',
  skipped: 'Workflow skipped',
};

function normalizeStatus(status) {
  const value = String(status || '').trim().toLowerCase();
  if (!value) {
    return 'unknown';
  }
  return value;
}

function statusColor(status) {
  return STATUS_COLORS[status] || '#9CA3AF';
}

function statusHeader(status) {
  if (STATUS_HEADERS[status]) {
    return STATUS_HEADERS[status];
  }

  const label = status.charAt(0).toUpperCase() + status.slice(1);
  return `Workflow ${label}`;
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
  runUrl = '',
}) {
  const normalizedStatus = normalizeStatus(status);
  const headerText = statusHeader(normalizedStatus);
  const blocks = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: headerText,
      },
    },
  ];

  const summary = contextLine([
    workflow ? `*${workflow}*` : '',
    repository ? `\`${repository}\`` : '',
    ref ? `\`${ref}\`` : '',
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
        text: trimmedDescription,
      },
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

  return {
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
  statusHeader,
};
