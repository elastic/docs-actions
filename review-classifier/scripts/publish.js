// Licensed to Elasticsearch B.V under one or more agreements.
// Elasticsearch B.V licenses this file to you under the Apache 2.0 License.
// See the LICENSE file in the project root for more information

'use strict';

const MARKER = '<!-- docs-review-classifier -->';
const BOT_LOGIN = 'github-actions[bot]';

const LABEL_STYLE = {
  light: { color: '0e8a16', description: 'Review classifier: use the light review checklist' },
  full: { color: 'd93f0b', description: 'Review classifier: use the full review checklist' },
};

// Decide which labels to add and remove, given the labels on the PR now.
function planLabels({ tier, botLabels, current, lightLabel, fullLabel }) {
  const present = new Set(current);
  if (tier === 'skip') {
    return { add: [], remove: botLabels.filter((l) => present.has(l)) };
  }
  const want = tier === 'full' ? fullLabel : lightLabel;
  const other = tier === 'full' ? lightLabel : fullLabel;
  return {
    add: present.has(want) ? [] : [want],
    remove: present.has(other) ? [other] : [],
  };
}

async function findComment(github, owner, repo, issueNumber) {
  const comments = await github.paginate(github.rest.issues.listComments, {
    owner,
    repo,
    issue_number: issueNumber,
    per_page: 100,
  });
  return comments.find((c) => c.user && c.user.login === BOT_LOGIN && (c.body || '').includes(MARKER));
}

async function ensureLabel(github, core, owner, repo, name, style) {
  try {
    await github.rest.issues.getLabel({ owner, repo, name });
  } catch (error) {
    if (error.status !== 404) throw error;
    try {
      await github.rest.issues.createLabel({ owner, repo, name, ...style });
      core.info(`Created label "${name}"`);
    } catch (createError) {
      core.warning(`Cannot create label "${name}" (${createError.status || createError.message}). Create it in the repository.`);
    }
  }
}

async function publish({ github, context, core, prNumber, decision, body, lightLabel, fullLabel }) {
  const { owner, repo } = context.repo;
  const { data: pr } = await github.rest.pulls.get({ owner, repo, pull_number: prNumber });

  if (pr.head.sha !== decision.head_sha) {
    core.notice(`PR #${prNumber} has a newer head (${pr.head.sha}) than this classification (${decision.head_sha}). Skipping.`);
    return { status: 'stale' };
  }

  const plan = planLabels({
    tier: decision.tier,
    botLabels: decision.bot_labels,
    current: pr.labels.map((l) => l.name),
    lightLabel,
    fullLabel,
  });

  for (const name of plan.remove) {
    try {
      await github.rest.issues.removeLabel({ owner, repo, issue_number: prNumber, name });
    } catch (error) {
      if (error.status !== 404) core.warning(`Cannot remove label "${name}": ${error.message}`);
    }
  }
  for (const name of plan.add) {
    await ensureLabel(github, core, owner, repo, name, name === fullLabel ? LABEL_STYLE.full : LABEL_STYLE.light);
    try {
      await github.rest.issues.addLabels({ owner, repo, issue_number: prNumber, labels: [name] });
    } catch (error) {
      core.warning(`Cannot add label "${name}": ${error.message}`);
    }
  }

  const existing = await findComment(github, owner, repo, prNumber);
  if (decision.tier === 'skip') {
    if (existing) {
      await github.rest.issues.deleteComment({ owner, repo, comment_id: existing.id });
      return { status: 'deleted', labels: plan };
    }
    return { status: 'skipped', labels: plan };
  }
  if (existing) {
    if (existing.body === body) return { status: 'unchanged', labels: plan };
    await github.rest.issues.updateComment({ owner, repo, comment_id: existing.id, body });
    return { status: 'updated', labels: plan };
  }
  await github.rest.issues.createComment({ owner, repo, issue_number: prNumber, body });
  return { status: 'created', labels: plan };
}

module.exports = { MARKER, planLabels, publish };
