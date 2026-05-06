const fs = require('fs');
const { TITLE, upsertComment, escapeMarkdown } = require('./comment-helper');

module.exports = async ({ github, context, core }) => {
  const prNumber = parseInt(process.env.PR_NUMBER, 10);
  const changelogDir = process.env.CHANGELOG_DIR;
  const stagingDir = process.env.STAGING_DIR || '/tmp/changelog-staging';

  const files = fs.readdirSync(stagingDir).filter(f => f.endsWith('.yaml'));
  const content = files.length > 0
    ? fs.readFileSync(`${stagingDir}/${files[0]}`, 'utf8').trim()
    : '';

  const bodyParts = [TITLE, ''];
  if (content) {
    bodyParts.push(
      `Generated changelog entry for \`${escapeMarkdown(changelogDir + '/' + files[0])}\`:`,
      '',
      '```yaml',
      content,
      '```',
      '',
      'This comment is informational. To regenerate the entry, edit the PR title or labels and let the changelog workflow re-run.',
    );
  } else {
    bodyParts.push('⚠️ Changelog entry was generated but the file content could not be read.');
  }

  await upsertComment({ github, context, prNumber, body: bodyParts.join('\n') });
};
