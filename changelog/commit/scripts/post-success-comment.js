// Posts (or updates) a PR comment with links to the committed changelog file.
module.exports = async ({ github, context, core }) => {
  const title = '### 📋 Changelog';
  const prNumber = parseInt(process.env.PR_NUMBER, 10);
  const branch = process.env.HEAD_REF;
  const { owner, repo } = context.repo;
  const filePath = `${process.env.CHANGELOG_DIR}/${prNumber}.yaml`;
  const viewUrl = `https://github.com/${owner}/${repo}/blob/${branch}/${filePath}`;
  const editUrl = `https://github.com/${owner}/${repo}/edit/${branch}/${filePath}`;

  const body = [
    title,
    '',
    `📝 Changelog entry committed: [\`${filePath}\`](${viewUrl})`,
    '',
    `✏️ [Edit this changelog](${editUrl})`,
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
