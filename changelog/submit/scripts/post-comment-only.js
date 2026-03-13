// Posts (or updates) a PR comment showing the generated changelog content
// without committing it to the branch.
module.exports = async ({ github, context, core }) => {
  const fs = require('fs');

  const title = '### 📋 Changelog';
  const prNumber = parseInt(process.env.PR_NUMBER, 10);
  const { owner, repo } = context.repo;
  const changelogDir = process.env.CHANGELOG_DIR;
  const changelogFilename = process.env.CHANGELOG_FILENAME;
  const filePath = `/tmp/changelog-result/${changelogFilename}`;

  let content = '';
  if (fs.existsSync(filePath)) {
    content = fs.readFileSync(filePath, 'utf8').trim();
  }

  const bodyParts = [title, ''];
  if (content) {
    bodyParts.push(
      `Generated changelog entry for \`${changelogDir}/${changelogFilename}\`:`,
      '',
      '```yaml',
      content,
      '```',
    );
  } else {
    bodyParts.push('⚠️ Changelog entry was generated but the file content could not be read.');
  }

  const body = bodyParts.join('\n');

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
