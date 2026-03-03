// Pre-flight checks: skip label, bot commit loop prevention, manual edit detection.
// Runs before any expensive operations (checkout, docs-builder setup).
module.exports = async ({ github, context, core }) => {
  const labels = context.payload.pull_request.labels.map(l => l.name);
  if (labels.includes('changelog:skip')) {
    core.info('changelog:skip label found, skipping changelog generation');
    core.setOutput('should-proceed', 'false');
    core.setOutput('status', 'skipped');
    return;
  }

  if (context.payload.action === 'synchronize') {
    const { data: commit } = await github.rest.repos.getCommit({
      owner: context.repo.owner,
      repo: context.repo.repo,
      ref: context.payload.pull_request.head.sha,
    });
    const author = commit.author?.login || commit.commit?.author?.name || '';
    if (author === 'github-actions[bot]') {
      core.info('Last commit is from github-actions[bot], skipping to prevent loop');
      core.setOutput('should-proceed', 'false');
      core.setOutput('status', 'skipped');
      return;
    }
  }

  // Check if changelog was manually edited (via API, not git log,
  // because checkout uses a shallow merge ref where authorship is unreliable)
  const prNumber = context.payload.pull_request.number;
  const changelogDir = process.env.CHANGELOG_DIR;
  const filePath = `${changelogDir}/${prNumber}.yaml`;
  try {
    const { data: commits } = await github.rest.repos.listCommits({
      owner: context.repo.owner,
      repo: context.repo.repo,
      path: filePath,
      sha: context.payload.pull_request.head.ref,
      per_page: 1,
    });
    if (commits.length > 0) {
      const lastAuthor = commits[0].author?.login || commits[0].commit?.author?.name || '';
      if (lastAuthor && lastAuthor !== 'github-actions[bot]') {
        core.info(`Changelog was manually edited by ${lastAuthor}, skipping regeneration`);
        core.setOutput('should-proceed', 'false');
        core.setOutput('status', 'manually-edited');
        return;
      }
    }
  } catch (e) {
    core.debug(`Could not check changelog commit history: ${e.message}`);
  }

  core.setOutput('should-proceed', 'true');
};
