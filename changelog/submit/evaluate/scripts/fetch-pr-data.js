const fs = require('fs');
const path = require('path');

const TITLE_MAX_LEN = 200;
const BODY_FILE_MAX_BYTES = 64 * 1024;

const sanitizeInline = (value, maxLen) =>
  (value || '')
    .replace(/\u0000/g, '')
    .replace(/\r/g, '')
    .slice(0, maxLen);

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

  const labelNames = pr.labels.map(l => l.name);
  const offendingLabel = labelNames.find(name => name.includes(','));
  if (offendingLabel) {
    core.setFailed(
      `Label name contains ',' which would corrupt comma-joined parsing: ${JSON.stringify(offendingLabel)}`
    );
    return;
  }

  // Stage the body in a file rather than passing it inline.
  const runnerTemp = process.env.RUNNER_TEMP;
  if (!runnerTemp) {
    core.setFailed('RUNNER_TEMP is not set; cannot stage PR body file');
    return;
  }
  const bodyFile = path.join(runnerTemp, 'changelog-pr-body.md');
  const rawBody = (pr.body || '').replace(/\u0000/g, '');
  const bodyBytes = Buffer.from(rawBody, 'utf8');
  const cappedBody = bodyBytes.length > BODY_FILE_MAX_BYTES
    ? bodyBytes.subarray(0, BODY_FILE_MAX_BYTES).toString('utf8')
    : rawBody;
  if (bodyBytes.length > BODY_FILE_MAX_BYTES) {
    core.warning(
      `PR body exceeds ${BODY_FILE_MAX_BYTES} bytes (${bodyBytes.length}); truncating.`
    );
  }
  fs.writeFileSync(bodyFile, cappedBody, { encoding: 'utf8', mode: 0o600 });

  core.setOutput('title', sanitizeInline(pr.title, TITLE_MAX_LEN));
  core.setOutput('body-file', bodyFile);
  core.setOutput('labels', labelNames.join(','));
  core.setOutput('is-fork', String(pr.head.repo?.full_name !== pr.base.repo?.full_name));
  core.setOutput('head-repo', pr.head.repo?.full_name || '');
  core.setOutput('maintainer-can-modify', String(pr.maintainer_can_modify ?? false));
  core.setOutput('base-ref', pr.base.ref);
  core.setOutput('head-ref', pr.head.ref);
  core.setOutput('head-sha', pr.head.sha);
  core.setOutput('proceed', 'true');
};
