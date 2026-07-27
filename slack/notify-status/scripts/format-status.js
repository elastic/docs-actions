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

const GITHUB_ICON_URL =
  'https://slack-imgs.com/?c=1&o1=wi16.he16.si&url=https%3A%2F%2Fslack.github.com%2Fstatic%2Fimg%2Ffavicon-neutral.png';

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

function sectionBlock(text) {
  if (!text) {
    return null;
  }

  return {
    type: 'section',
    text: {
      type: 'mrkdwn',
      text,
    },
  };
}

function contextBlock(text) {
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

function actionsBlock(runUrl) {
  if (!runUrl) {
    return null;
  }

  return {
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
  };
}

function attributionBlock({ repository, repositoryUrl }) {
  const text =
    repository && repositoryUrl
      ? `<${repositoryUrl}|${repository}>`
      : repository;

  if (!text) {
    return null;
  }

  return {
    type: 'context',
    elements: [
      {
        type: 'image',
        image_url: GITHUB_ICON_URL,
        alt_text: 'GitHub',
      },
      {
        type: 'mrkdwn',
        text,
      },
    ],
  };
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

function buildStatusMessage({
  status,
  description = '',
  mention = '',
  repository = '',
  repositoryUrl = '',
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
  const statusLine = [label, source].filter(Boolean).join('  ·  ');
  const trimmedDescription = String(description || '').trim();
  const formattedMention = formatMentions(mention);
  const blocks = [];

  const statusBlock = sectionBlock(statusLine);
  if (statusBlock) {
    blocks.push(statusBlock);
  }

  const descriptionBlock = contextBlock(trimmedDescription);
  if (descriptionBlock) {
    blocks.push(descriptionBlock);
  }

  const runButton = actionsBlock(runUrl);
  if (runButton) {
    blocks.push(runButton);
  }

  const mentionBlock = contextBlock(formattedMention ? `cc ${formattedMention}` : '');
  if (mentionBlock) {
    blocks.push(mentionBlock);
  }

  const attribution = attributionBlock({ repository, repositoryUrl });
  if (attribution) {
    blocks.push(attribution);
  }

  return {
    text: title,
    attachments: [
      {
        color: statusColor(normalizedStatus),
        fallback: `${title} · ${label}`,
        blocks,
      },
    ],
  };
}

module.exports = {
  GITHUB_ICON_URL,
  actionsBlock,
  attributionBlock,
  buildStatusMessage,
  contextBlock,
  formatMentionToken,
  formatMentions,
  messageText,
  normalizeStatus,
  sectionBlock,
  sourceMetadata,
  statusColor,
  statusLabel,
};
