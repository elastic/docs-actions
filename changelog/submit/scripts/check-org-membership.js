module.exports = async ({ github, context, core }) => {
  const org = process.env.ORG;
  const username = process.env.USERNAME;

  if (!username || !org) {
    core.setOutput('is-org-member', 'false');
    return;
  }

  try {
    await github.request('GET /orgs/{org}/public_members/{username}', {
      org,
      username,
    });
    core.setOutput('is-org-member', 'true');
    core.info(`${username} is a public member of ${org}`);
  } catch {
    core.setOutput('is-org-member', 'false');
    core.info(`${username} is not a public member of ${org} (or membership is private)`);
  }
};
