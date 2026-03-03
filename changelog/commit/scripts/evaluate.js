// Reads changelog artifact metadata, validates current PR state,
// and decides the action to take: commit, comment-only, or failure-comment.
module.exports = async ({ github, context, core }) => {
  const fs = require('fs');

  const metaPath = '/tmp/changelog-result/metadata.json';
  if (!fs.existsSync(metaPath)) {
    core.info('No metadata file found in artifact');
    return;
  }

  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  core.setOutput('pr-number', String(meta.pr_number));
  core.setOutput('head-ref', meta.head_ref);
  core.setOutput('status', meta.status);
  core.setOutput('config-file', meta.config_file);
  core.setOutput('changelog-dir', meta.changelog_dir);
  core.setOutput('label-table', meta.label_table || '');

  const { owner, repo } = context.repo;
  const prNumber = meta.pr_number;

  const { data: pr } = await github.rest.pulls.get({
    owner, repo, pull_number: prNumber,
  });

  if (pr.head.sha !== meta.head_sha) {
    core.info(`PR head has moved (expected ${meta.head_sha}, now ${pr.head.sha}). A newer generate run should handle this.`);
    return;
  }

  const labels = pr.labels.map(l => l.name);
  if (labels.includes('changelog:skip')) {
    core.info('changelog:skip label found on PR, aborting.');
    return;
  }

  const commentOnly = process.env.COMMENT_ONLY === 'true';

  if (meta.status === 'success') {
    if (commentOnly) {
      core.setOutput('should-comment-success', 'true');
    } else {
      core.setOutput('should-commit', 'true');
    }
  } else if (meta.status === 'no-label') {
    core.setOutput('should-comment-failure', 'true');
  }
};
