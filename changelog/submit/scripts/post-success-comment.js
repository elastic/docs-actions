const { TITLE, upsertComment } = require('./comment-helper');

module.exports = async ({ github, context, core }) => {
  const prNumber = parseInt(process.env.PR_NUMBER, 10);
  const branch = process.env.HEAD_REF;
  const changelogFile = process.env.CHANGELOG_FILE;
  const { owner, repo } = context.repo;
  const viewUrl = `https://github.com/${owner}/${repo}/blob/${branch}/${changelogFile}`;
  const editUrl = `https://github.com/${owner}/${repo}/edit/${branch}/${changelogFile}`;

  const body = [
    TITLE,
    '',
    `📝 Changelog entry committed: [\`${changelogFile}\`](${viewUrl})`,
    '',
    `✏️ [Edit this changelog](${editUrl})`,
  ].join('\n');

  await upsertComment({ github, context, prNumber, body });
};
