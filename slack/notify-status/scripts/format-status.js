'use strict';

const STATUS_COLORS = {
  success: '#2EB67D',
  failure: '#E01E5A',
  cancelled: '#ECB22E',
  skipped: '#9CA3AF',
};

const STATUS_LABELS = {
  success: 'Succeeded',
  failure: 'Failed',
  cancelled: 'Cancelled',
  skipped: 'Skipped',
};

const STATUS_ALERT_LEVELS = {
  success: 'success',
  failure: 'error',
  cancelled: 'warning',
  skipped: 'default',
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

function statusLabel(status) {
  if (STATUS_LABELS[status]) {
    return STATUS_LABELS[status];
  }

  const label = status.charAt(0).toUpperCase() + status.slice(1);
  return label;
}

function statusAlertLevel(status) {
  return STATUS_ALERT_LEVELS[status] || 'default';
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

function messageText(repository, workflow) {
  if (repository && workflow) {
    return `${repository} · ${workflow}`;
  }

  return repository || workflow || 'Workflow status';
}

function truncateText(text, maxLength) {
  const value = String(text || '').trim();
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 1)}…`;
}

function sourceMetadata({
  eventName,
  pullRequestNumber,
  pullRequestUrl,
  ref,
  sha,
  commitUrl,
}) {
  if (pullRequestNumber && pullRequestUrl) {
    return `<${pullRequestUrl}|#${pullRequestNumber}>`;
  }

  if (eventName === 'push') {
    const shortSha = String(sha).slice(0, 7);
    const commit = shortSha && commitUrl ? `<${commitUrl}|\`${shortSha}\`>` : '';
    return [ref ? `\`${ref}\`` : '', commit].filter(Boolean).join('  ·  ');
  }

  if (ref) {
    return `\`${ref}\``;
  }

  return '';
}

function buildCardBlock({
  title,
  subtitle,
  body,
  subtext,
  runUrl,
}) {
  const card = {
    type: 'card',
    title: {
      type: 'mrkdwn',
      text: title,
      verbatim: false,
    },
  };

  if (subtitle) {
    card.subtitle = {
      type: 'mrkdwn',
      text: subtitle,
      verbatim: false,
    };
  }

  if (body) {
    card.body = {
      type: 'mrkdwn',
      text: body,
      verbatim: false,
    };
  }

  if (subtext) {
    card.subtext = {
      type: 'mrkdwn',
      text: subtext,
      verbatim: false,
    };
  }

  if (runUrl) {
    card.actions = [
      {
        type: 'button',
        text: {
          type: 'plain_text',
          text: 'View workflow run',
        },
        url: runUrl,
      },
    ];
  }

  return card;
}

function buildStatusMessage({
  status,
  description = '',
  mention = '',
  repository = '',
  workflow = '',
  ref = '',
  eventName = '',
  pullRequestNumber = '',
  pullRequestUrl = '',
  sha = '',
  commitUrl = '',
  runUrl = '',
}) {
  const normalizedStatus = normalizeStatus(status);
  const label = statusLabel(normalizedStatus);
  const title = messageText(repository, workflow);
  const source = sourceMetadata({
    eventName,
    pullRequestNumber,
    pullRequestUrl,
    ref,
    sha,
    commitUrl,
  });
  const subtitle = [label, source].filter(Boolean).join('  ·  ');
  const trimmedDescription = truncateText(description, 200);
  const formattedMention = formatMentions(mention);

  const card = buildCardBlock({
    title,
    subtitle,
    body: trimmedDescription,
    subtext: formattedMention ? `cc ${formattedMention}` : '',
    runUrl,
  });

  return {
    text: title,
    attachments: [
      {
        color: statusColor(normalizedStatus),
        fallback: `${title} · ${label}`,
        blocks: [card],
      },
    ],
    statusAlertLevel: statusAlertLevel(normalizedStatus),
  };
}

module.exports = {
  buildStatusMessage,
  buildCardBlock,
  formatMentionToken,
  formatMentions,
  messageText,
  normalizeStatus,
  sourceMetadata,
  statusAlertLevel,
  statusColor,
  statusLabel,
  truncateText,
};
