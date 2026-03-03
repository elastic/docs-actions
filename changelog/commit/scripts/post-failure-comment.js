// Posts (or updates) a PR comment explaining that no matching type label was
// found, and lists the available labels from the changelog config.
module.exports = async ({ github, context, core }) => {
  const title = '### 📋 Changelog';
  const { owner, repo } = context.repo;
  const prNumber = parseInt(process.env.PR_NUMBER, 10);
  const configFile = process.env.CONFIG_FILE || 'docs/changelog.yml';
  const labelRows = process.env.LABEL_TABLE || '';

  let labelSection;
  if (labelRows.trim()) {
    labelSection = [
      '',
      '🔖 Add one of these labels to your PR:',
      '',
      '| Label | Changelog type |',
      '|---|---|',
      labelRows,
    ].join('\n');
  } else {
    labelSection = `\nAdd a type label that matches your \`pivot.types\` configuration in \`${configFile}\`.`;
  }

  const body = [
    title,
    '',
    '⚠️ **Cannot generate changelog:** no matching type label found on this PR.',
    labelSection,
    '',
    '🔖 To skip the changelog for this PR, add the `changelog:skip` label.',
  ].join('\n');

  const issue_number = prNumber;
  const { data: comments } = await github.rest.issues.listComments({
    owner, repo, issue_number, per_page: 100,
  });
  const existing = comments.find(c =>
    c.user?.login === 'github-actions[bot]' &&
    c.body?.startsWith(title)
  );
  if (existing) {
    await github.rest.issues.updateComment({
      owner, repo,
      comment_id: existing.id,
      body,
    });
  } else {
    await github.rest.issues.createComment({
      owner, repo,
      issue_number,
      body,
    });
  }
};
