// Licensed to Elasticsearch B.V under one or more agreements.
// Elasticsearch B.V licenses this file to you under the Apache 2.0 License.
// See the LICENSE file in the project root for more information

'use strict';

const fs = require('fs');

module.exports = async ({ github, context, core }) => {
  const configFile = process.env.CONFIG_FILE;
  const prNumber = parseInt(process.env.PR_NUMBER, 10);

  const changelogDir = readChangelogDir(configFile);

  const { data: prFiles } = await github.rest.pulls.listFiles({
    owner: context.repo.owner,
    repo: context.repo.repo,
    pull_number: prNumber,
    per_page: 100,
  });

  const changelogFiles = prFiles
    .filter(f =>
      f.filename.startsWith(changelogDir + '/') &&
      f.filename.endsWith('.yaml') &&
      (f.status === 'added' || f.status === 'modified')
    )
    .map(f => f.filename);

  const pairs = [];
  for (const fragmentPath of changelogFiles) {
    let products;
    try {
      products = readProducts(fs.readFileSync(fragmentPath, 'utf8'));
    } catch (e) {
      core.warning(`Could not read fragment ${fragmentPath}: ${e.message}`);
      continue;
    }
    for (const product of products) {
      pairs.push(`${fragmentPath} ${product}`);
    }
  }

  if (pairs.length > 0) {
    core.setOutput('has-uploads', 'true');
    core.setOutput('upload-pairs', pairs.join('\n'));
    core.info(`Found ${pairs.length} upload target(s):`);
    for (const pair of pairs) core.info(`  ${pair}`);
  } else {
    core.setOutput('has-uploads', 'false');
    core.setOutput('upload-pairs', '');
    const reason = changelogFiles.length > 0
      ? 'no products found in changelog files'
      : `no changelog files changed in ${changelogDir}/`;
    core.info(`Nothing to upload (${reason})`);
  }
};

function readChangelogDir(configFile) {
  let content;
  try {
    content = fs.readFileSync(configFile, 'utf8');
  } catch (_) {
    return 'docs/changelog';
  }
  let inBundle = false;
  for (const line of content.split('\n')) {
    if (/^bundle:\s*$/.test(line)) { inBundle = true; continue; }
    if (inBundle) {
      const m = line.match(/^\s+directory:\s*(\S+)/);
      if (m) return m[1];
      if (/^\S/.test(line) && !line.startsWith('#')) inBundle = false;
    }
  }
  return 'docs/changelog';
}

function readProducts(content) {
  const products = [];
  let inProducts = false;
  for (const line of content.split('\n')) {
    if (/^products:\s*$/.test(line)) { inProducts = true; continue; }
    if (inProducts) {
      const m = line.match(/^\s+product:\s*(\S+)/);
      if (m) { products.push(m[1]); continue; }
      if (/^\S/.test(line) && !line.startsWith('#')) inProducts = false;
    }
  }
  return products;
}
