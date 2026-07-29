const { stagePrBody } = require('../../../shared/scripts/pr-body');

const TITLE_MAX_LENGTH = 200;

const sanitizeInline = (value, maxLength) =>
  String(value ?? '')
    .replace(/\u0000/g, '')
    .replace(/\r/g, '')
    .slice(0, maxLength);

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
  const labelNames = pr.labels.map(label => label.name);
  const offendingLabel = labelNames.find(name => name.includes(','));
  if (offendingLabel) {
    core.setFailed(
      `Label name contains ',' which would corrupt comma-separated parsing: ${JSON.stringify(offendingLabel)}`
    );
    return;
  }

  let staged;
  try {
    staged = stagePrBody(pr.body, process.env.RUNNER_TEMP);
  } catch (error) {
    core.setFailed(`Failed to stage PR body: ${error.message}`);
    return;
  }
  if (staged.truncated) {
    core.warning(
      `PR body is ${staged.originalBytes} bytes; staged the first ${staged.writtenBytes} complete UTF-8 bytes.`
    );
  }

  core.setOutput('title', sanitizeInline(pr.title, TITLE_MAX_LENGTH));
  core.setOutput('body-file', staged.path);
  core.setOutput('labels', labelNames.join(','));
  core.setOutput('is-fork', String(pr.head.repo?.full_name !== pr.base.repo?.full_name));
  core.setOutput('head-repo', pr.head.repo?.full_name || '');
  core.setOutput('maintainer-can-modify', String(pr.maintainer_can_modify ?? false));
  core.setOutput('base-ref', pr.base.ref);
  core.setOutput('head-ref', pr.head.ref);
  core.setOutput('head-sha', pr.head.sha);
  core.setOutput('proceed', 'true');
};
