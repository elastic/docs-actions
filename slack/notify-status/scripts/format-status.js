'use strict';

const STATUS_COLORS = {
  success: 'good',
  failure: 'danger',
  cancelled: 'warning',
  skipped: '#949494',
};

const STATUS_LABELS = {
  success: 'Success',
  failure: 'Failure',
  cancelled: 'Cancelled',
  skipped: 'Skipped',
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

function statusLabel(status) {
  return STATUS_LABELS[status] || status.charAt(0).toUpperCase() + status.slice(1);
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
  const label = statusLabel(normalizedStatus);
  const emoji = statusEmoji(normalizedStatus);
  const blocks = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `${emoji} *Workflow ${label}*`,
      },
    },
  ];

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

  const formattedMention = formatMentions(mention);
  if (formattedMention) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: formattedMention,
      },
    });
  }

  const fields = [];
  if (repository) {
    fields.push(fieldBlock('Repository', repository));
  }
  if (workflow) {
    fields.push(fieldBlock('Workflow', workflow));
  }
  if (ref) {
    fields.push(fieldBlock('Ref', ref));
  }
  if (actor) {
    fields.push(fieldBlock('Actor', actor));
  }
  if (eventName) {
    fields.push(fieldBlock('Event', eventName));
  }
  if (runUrl) {
    fields.push(fieldBlock('Run', `<${runUrl}|View workflow run>`));
  }

  if (fields.length > 0) {
    blocks.push({
      type: 'section',
      fields,
    });
  }

  const fallbackParts = [`Workflow ${label}`];
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
  statusLabel,
};
