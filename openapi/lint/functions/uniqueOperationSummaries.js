// An operation's summary is its page title in the API docs, so two different
// APIs with the same summary produce identical titles (bad for search ranking).
// Methods on the same path are one API and may share a summary.
const METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];

const normalize = (summary) => summary.trim().replace(/\.$/, '').trim().toLowerCase();

module.exports = (paths) => {
  if (!paths || typeof paths !== 'object') return [];

  const bySummary = new Map();
  for (const [path, item] of Object.entries(paths)) {
    if (!item || typeof item !== 'object') continue;
    for (const method of METHODS) {
      const summary = item[method]?.summary;
      if (typeof summary !== 'string' || normalize(summary) === '') continue;
      const key = normalize(summary);
      if (!bySummary.has(key)) bySummary.set(key, []);
      bySummary.get(key).push({ path, method, summary: summary.trim() });
    }
  }

  const results = [];
  for (const operations of bySummary.values()) {
    for (const op of operations) {
      const others = operations.filter((o) => o.path !== op.path);
      if (others.length === 0) continue;
      const list = others.map((o) => `${o.method.toUpperCase()} ${o.path}`).join(', ');
      results.push({
        message: `Summary "${op.summary}" is also used by ${list}; operation summaries are page titles and must be unique.`,
        path: ['paths', op.path, op.method, 'summary'],
      });
    }
  }
  return results;
};
