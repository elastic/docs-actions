const TITLE = '### 📋 Changelog';

async function upsertComment({ github, context, prNumber, body }) {
  const { owner, repo } = context.repo;
  const { data: comments } = await github.rest.issues.listComments({
    owner, repo, issue_number: prNumber, per_page: 100,
  });
  const existing = comments.find(c =>
    c.user?.login === 'github-actions[bot]' && c.body?.startsWith(TITLE)
  );
  if (existing) {
    await github.rest.issues.updateComment({ owner, repo, comment_id: existing.id, body });
  } else {
    await github.rest.issues.createComment({ owner, repo, issue_number: prNumber, body });
  }
}

module.exports = { TITLE, upsertComment };
