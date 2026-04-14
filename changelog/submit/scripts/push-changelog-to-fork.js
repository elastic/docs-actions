const fs = require('fs');
const path = require('path');

module.exports = async ({ github, context, core }) => {
  const headRepo = process.env.HEAD_REPO;
  const headRef = process.env.HEAD_REF;
  const changelogDir = process.env.CHANGELOG_DIR;
  const existingFilename = process.env.EXISTING_FILENAME;
  const prNumber = process.env.PR_NUMBER;
  const stagingDir = process.env.STAGING_DIR || '/tmp/changelog-staging';

  const [forkOwner, forkRepo] = headRepo.split('/');
  if (!forkOwner || !forkRepo) {
    core.setFailed(`Invalid HEAD_REPO: ${headRepo}`);
    return;
  }

  const staged = fs.readdirSync(stagingDir).filter(f => f.endsWith('.yaml'));
  if (staged.length === 0) {
    core.setFailed('No changelog YAML found in staging directory');
    return;
  }

  const targetFilename = existingFilename || staged[0];
  const changelogFile = `${changelogDir}/${targetFilename}`;
  const content = fs.readFileSync(path.join(stagingDir, staged[0]), 'utf8');

  let existingSha;
  try {
    const { data } = await github.rest.repos.getContent({
      owner: forkOwner, repo: forkRepo,
      path: changelogFile, ref: headRef,
    });
    existingSha = data.sha;
  } catch {
    // File doesn't exist on the fork branch yet
  }

  const verb = existingSha ? 'Update' : 'Add';

  try {
    await github.rest.repos.createOrUpdateFileContents({
      owner: forkOwner, repo: forkRepo,
      path: changelogFile,
      message: `${verb} changelog for PR #${prNumber}`,
      content: Buffer.from(content).toString('base64'),
      branch: headRef,
      ...(existingSha && { sha: existingSha }),
      committer: {
        name: 'github-actions[bot]',
        email: '41898282+github-actions[bot]@users.noreply.github.com',
      },
    });
    core.setOutput('committed', 'true');
    core.setOutput('changelog-file', changelogFile);
    core.info(`Committed ${changelogFile} to ${headRepo}@${headRef} via Contents API`);
  } catch (err) {
    core.warning(
      `Could not push to fork via API (${err.status || err.message}). ` +
      'The PR author may not have enabled "Allow edits from maintainers." ' +
      'Falling back to comment-only.'
    );
    core.setOutput('committed', 'false');
    core.setOutput('changelog-file', changelogFile);
  }
};
