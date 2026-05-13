const { TITLE, upsertComment, wrapInlineCode } = require('./comment-helper');

// changelogFile / branch are validated upstream by ref-name regex
// (`^[a-zA-Z0-9._/+-]+$`) plus OutputSanitizer in docs-builder, so they
// are constrained to a small alphabet. wrapInlineCode is still used for
// the visible filename so a stray backtick (or future loosening of the
// upstream regex) cannot break out of the inline code span.
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
    `📝 Changelog entry committed: [${wrapInlineCode(changelogFile)}](${viewUrl})`,
    '',
    `✏️ [Edit this changelog](${editUrl})`,
  ].join('\n');

  await upsertComment({ github, context, prNumber, body });
};
