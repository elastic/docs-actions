module.exports = async ({ github, context, core }) => {
  const { data: pr } = await github.rest.pulls.get({
    owner: context.repo.owner,
    repo: context.repo.repo,
    pull_number: parseInt(process.env.PR_NUMBER, 10),
  });
  if (pr.state !== 'open') {
    core.info(`PR #${pr.number} is ${pr.state} — skipping`);
    return;
  }
  core.setOutput('title', pr.title);
  core.setOutput('body', pr.body || '');
  core.setOutput('labels', pr.labels.map(l => l.name).join(','));
  core.setOutput('is-fork', String(pr.head.repo?.full_name !== pr.base.repo?.full_name));
  core.setOutput('base-ref', pr.base.ref);
  core.setOutput('head-ref', pr.head.ref);
  core.setOutput('head-sha', pr.head.sha);
  core.setOutput('author-login', pr.user?.login || '');
  core.setOutput('head-repo-full-name', pr.head.repo?.full_name || '');
  core.setOutput('proceed', 'true');
};
