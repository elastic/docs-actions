const { TITLE, upsertComment } = require('./comment-helper');

module.exports = async ({ github, context, core }) => {
  const prNumber = parseInt(process.env.PR_NUMBER, 10);
  const skipLabels = process.env.SKIP_LABELS || '';

  const bodyParts = [
    TITLE,
    '',
    '⏭️ Changelog generation was skipped for this pull request.',
  ];

  if (skipLabels.trim()) {
    const formatted = skipLabels.split(',').map(l => `\`${l.trim()}\``).join(', ');
    bodyParts.push('', `Matched skip label(s): ${formatted}`);
  }

  await upsertComment({ github, context, prNumber, body: bodyParts.join('\n') });
};
