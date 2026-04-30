const { TITLE, upsertComment, escapeMarkdown } = require('./comment-helper');

module.exports = async ({ github, context, core }) => {
  const prNumber = parseInt(process.env.PR_NUMBER, 10);
  const branch = process.env.HEAD_REF;
  const changelogFile = process.env.CHANGELOG_FILE;
  const { owner, repo } = context.repo;
  const safeBranch = encodeURIComponent(branch);
  const safePath = changelogFile.split('/').map(encodeURIComponent).join('/');
  const viewUrl = `https://github.com/${owner}/${repo}/blob/${safeBranch}/${safePath}`;
  const editUrl = `https://github.com/${owner}/${repo}/edit/${safeBranch}/${safePath}`;

  const body = [
    TITLE,
    '',
    `📝 Changelog entry committed: [\`${escapeMarkdown(changelogFile)}\`](${viewUrl})`,
    '',
    `✏️ [Edit this changelog](${editUrl})`,
  ].join('\n');

  await upsertComment({ github, context, prNumber, body });
};
