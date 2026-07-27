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

function messageText({ repository, repositoryUrl, workflow, runUrl }) {
  const repo =
    repository && repositoryUrl
      ? `<${repositoryUrl}|${repository}>`
      : repository;
  const workflowLink =
    workflow && runUrl
      ? `<${runUrl}|${workflow}>`
      : workflow;

  if (repo && workflowLink) {
    return `${repo} · ${workflowLink}`;
  }

  return repo || workflowLink || 'Workflow status';
}

function plainMessageText(repository, workflow) {
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
  const title = messageText({ repository, repositoryUrl, workflow, runUrl });
  const fallbackTitle = plainMessageText(repository, workflow);
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

  return {
    text: title,
    attachments: [
      {
        color: statusColor(normalizedStatus),
        fallback: `${fallbackTitle} · ${label}`,
        blocks,
      },
    ],
  };
}

module.exports = {
  actionsBlock,
  buildStatusMessage,
  contextBlock,
  formatMentionToken,
  formatMentions,
  messageText,
  normalizeStatus,
  plainMessageText,
  sectionBlock,
  sourceMetadata,
  statusColor,
  statusLabel,
};
