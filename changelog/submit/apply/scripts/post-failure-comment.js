const { TITLE, upsertComment } = require('./comment-helper');

module.exports = async ({ github, context, core }) => {
  const prNumber = parseInt(process.env.PR_NUMBER, 10);
  const configFile = process.env.CONFIG_FILE || 'docs/changelog.yml';
  const labelRows = process.env.LABEL_TABLE || '';
  const productLabelRows = process.env.PRODUCT_LABEL_TABLE || '';
  const skipLabels = process.env.SKIP_LABELS || '';

  let labelSection;
  if (labelRows.trim()) {
    labelSection = [
      '',
      '🔖 Add one of these **type** labels to your PR:',
      '',
      labelRows,
    ].join('\n');
  } else {
    labelSection = `\nAdd a type label that matches your \`pivot.types\` configuration in \`${configFile}\`.`;
  }

  let productSection = '';
  if (productLabelRows.trim()) {
    productSection = [
      '',
      '📦 Add one or more **product** labels:',
      '',
      productLabelRows,
    ].join('\n');
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
    '⚠️ **Cannot generate changelog:** no matching type label found on this PR.',
    labelSection,
    productSection,
    skipSection,
    '',
    `📄 See \`${configFile}\` for the full changelog configuration.`,
  ].join('\n');

  await upsertComment({ github, context, prNumber, body });
};
