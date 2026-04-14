const { TITLE, upsertComment, escapeMarkdown } = require('./comment-helper');

module.exports = async ({ github, context, core }) => {
  const prNumber = parseInt(process.env.PR_NUMBER, 10);
  const configFile = process.env.CONFIG_FILE || 'docs/changelog.yml';
  const labelRows = process.env.LABEL_TABLE || '';
  const productLabelRows = process.env.PRODUCT_LABEL_TABLE || '';

  let labelSection;
  if (labelRows.trim()) {
    labelSection = [
      '',
      '🔖 Add one of these **type** labels to your PR:',
      '',
      labelRows,
    ].join('\n');
  } else {
    labelSection = `\nAdd a type label that matches your \`pivot.types\` configuration in \`${escapeMarkdown(configFile)}\`.`;
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

  const body = [
    TITLE,
    '',
    '⚠️ **Cannot generate changelog:** no matching type label found on this PR.',
    labelSection,
    productSection,
    '',
    `🔖 To skip changelog generation or configure label rules, see \`${escapeMarkdown(configFile)}\`.`,
  ].join('\n');

  await upsertComment({ github, context, prNumber, body });
};
