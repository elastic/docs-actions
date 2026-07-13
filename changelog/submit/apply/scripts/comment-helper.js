const TITLE = '### 📋 Changelog';

const longestBacktickRun = (value) => {
  const runs = String(value ?? '').match(/`+/g) ?? [];
  return runs.reduce((longest, run) => Math.max(longest, run.length), 0);
};

const wrapCodeFence = (content, language = '') => {
  const text = String(content ?? '');
  const fence = '`'.repeat(Math.max(3, longestBacktickRun(text) + 1));
  return `${fence}${language}\n${text}\n${fence}`;
};

const wrapInlineCode = (value) => {
  const text = String(value ?? '');
  const delimiter = '`'.repeat(longestBacktickRun(text) + 1);
  const padded = text.startsWith('`') || text.endsWith('`') ? ` ${text} ` : text;
  return `${delimiter}${padded}${delimiter}`;
};

async function upsertComment({ github, context, prNumber, body }) {
  const { owner, repo } = context.repo;
  const comments = await github.paginate(github.rest.issues.listComments, {
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

module.exports = { TITLE, upsertComment, wrapCodeFence, wrapInlineCode };
