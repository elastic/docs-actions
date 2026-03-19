module.exports = async ({ github, context, core }) => {
  const run = context.payload.workflow_run;
  if (run.pull_requests?.length > 0) {
    core.setOutput('number', run.pull_requests[0].number);
    core.info(`Resolved PR #${run.pull_requests[0].number} from workflow_run.pull_requests`);
    return;
  }
  // Fallback for fork PRs: search by head branch
  const headRepo = run.head_repository;
  if (!headRepo) {
    core.warning('head_repository is null — cannot resolve PR via fallback, skipping');
    return;
  }
  const headLabel = `${headRepo.owner.login}:${run.head_branch}`;
  const { data: prs } = await github.rest.pulls.list({
    owner: context.repo.owner,
    repo: context.repo.repo,
    state: 'open',
    head: headLabel,
  });
  const match = prs.find(pr => pr.head.sha === run.head_sha);
  if (match) {
    core.setOutput('number', match.number);
    core.info(`Resolved PR #${match.number} from pulls.list (head=${headLabel}, sha=${run.head_sha})`);
  } else {
    core.info('No open PR matching head SHA found — skipping');
  }
};
