const { TITLE, upsertComment } = require('./comment-helper');

module.exports = async ({ github, context, core }) => {
  const prNumber = parseInt(process.env.PR_NUMBER, 10);
  const configFile = process.env.CONFIG_FILE || 'docs/changelog.yml';
  const labelRows = (process.env.LABEL_TABLE || '').trim();
  const productLabelRows = (process.env.PRODUCT_LABEL_TABLE || '').trim();
  const skipLabels = process.env.SKIP_LABELS || '';

  const hasTypeIssue = !!labelRows;
  const hasProductIssue = !!productLabelRows;

  let headline;
  if (hasTypeIssue && hasProductIssue) {
    headline = '⚠️ **Cannot generate changelog:** required type and product labels are missing on this PR.';
  } else if (hasProductIssue) {
    headline = '⚠️ **Cannot generate changelog:** no matching product label found on this PR.';
  } else {
    headline = '⚠️ **Cannot generate changelog:** no matching type label found on this PR.';
  }

  const sections = [];

  if (hasTypeIssue) {
    sections.push(['', '🔖 Add one of these **type** labels to your PR:', '', labelRows].join('\n'));
  } else if (!hasProductIssue) {
    sections.push(`\nAdd a type label that matches your \`pivot.types\` configuration in \`${configFile}\`.`);
  }

  if (hasProductIssue) {
    sections.push(['', '📦 Add one or more **product** labels to your PR:', '', productLabelRows].join('\n'));
  }

  let skipSection;
  if (skipLabels.trim()) {
    const formatted = skipLabels.split(',').map(l => `\`${l.trim()}\``).join(', ');
    skipSection = `\n⏭️ To skip changelog generation, add one of these labels: ${formatted}`;
  } else {
    skipSection = `\n⏭️ No skip labels are configured. To allow skipping changelog generation, add a label to \`rules.create.exclude\` in \`${configFile}\`.`;
  }

  const body = [
    TITLE,
    '',
    headline,
    ...sections,
    skipSection,
    '',
    `📄 See \`${configFile}\` for the full changelog configuration.`,
  ].join('\n');

  await upsertComment({ github, context, prNumber, body });
};
