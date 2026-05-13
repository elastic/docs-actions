// Trust boundary:
// All env-var inputs that flow into the comment body — CHANGELOG_FILE,
// CHANGELOG_DIR, HEAD_REF, LABEL_TABLE, PRODUCT_LABEL_TABLE, SKIP_LABELS,
// CONFIG_FILE, and the staged YAML content — originate from PR metadata or
// repo configuration that an attacker can influence. Use the helpers below
// when interpolating any of those values into a Markdown comment:
//   - escapeMarkdown() for inline text. Escapes Markdown punctuation *and*
//     HTML-significant characters (<, >, &) so a hostile value cannot
//     introduce raw HTML.
//   - wrapCodeFence() for multi-line content embedded as a code block.
//     Picks a backtick fence longer than any sequence in the content so a
//     stray ``` cannot break out of the block.
const TITLE = '### 📋 Changelog';

// Escapes Markdown punctuation and HTML-significant characters. Sticking
// to ASCII printable range; the OutputSanitizer in docs-builder already
// strips C0/DEL controls before these values reach the runner.
const escapeMarkdown = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/([[\]()\\`*_{}#+\-.!|])/g, '\\$1');

// Returns content wrapped in a backtick fence whose length is one greater
// than the longest run of backticks already present in `content`. Prevents
// the embedded content from closing the outer fence prematurely.
const wrapCodeFence = (content, language = '') => {
  const matches = String(content ?? '').match(/`+/g) ?? [];
  const longest = matches.reduce((max, run) => Math.max(max, run.length), 0);
  const fence = '`'.repeat(Math.max(3, longest + 1));
  return `${fence}${language}\n${content}\n${fence}`;
};

// Returns the text wrapped as inline code using a backtick run longer than
// any run inside the text. Prefer this over `escapeMarkdown(s)` wrapped in
// single backticks when `s` may itself contain backticks (e.g., user-
// supplied label or path values).
const wrapInlineCode = (s) => {
  const text = String(s ?? '');
  const matches = text.match(/`+/g) ?? [];
  const longest = matches.reduce((max, run) => Math.max(max, run.length), 0);
  const tick = '`'.repeat(longest + 1);
  // CommonMark: pad with a single space if the content starts or ends with
  // a backtick, so the boundary backticks aren't absorbed into the run.
  const padded = (text.startsWith('`') || text.endsWith('`')) ? ` ${text} ` : text;
  return `${tick}${padded}${tick}`;
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

module.exports = { TITLE, upsertComment, escapeMarkdown, wrapCodeFence, wrapInlineCode };
