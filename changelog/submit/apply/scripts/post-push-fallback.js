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

  const bodyParts = [
    TITLE,
    '',
    '⚠️ **Could not push changelog to your fork branch.**',
    'This usually happens when "Allow edits from maintainers" was disabled after the changelog was evaluated.',
    '',
    'Please re-enable it in your PR settings, or apply the changelog manually:',
  ];

  if (content) {
    const targetPath = `${changelogDir}/${files[0]}`;
    bodyParts.push(
      '',
      `Save the following to \`${escapeMarkdown(targetPath)}\`:`,
      '',
      '```yaml',
      content,
      '```',
    );
  } else {
    bodyParts.push('', '⚠️ Changelog entry was generated but the file content could not be read.');
  }

  await upsertComment({ github, context, prNumber, body: bodyParts.join('\n') });
};
