'use strict';

const fs = require('fs');
const https = require('https');
const path = require('path');
const yaml = require('js-yaml');

const config = process.env.CONFIG;
const profile = process.env.PROFILE;
const version = process.env.VERSION;
const releaseVersion = process.env.RELEASE_VERSION;
const report = process.env.REPORT;
const prs = process.env.PRS;
const output = process.env.OUTPUT;
const repo = process.env.REPO;
const owner = process.env.OWNER;
const githubOutput = process.env.GITHUB_OUTPUT;

function loadConfig(configPath) {
  try {
    return yaml.load(fs.readFileSync(configPath, 'utf8'));
  } catch (e) {
    return null;
  }
}

function httpsGet(url, dest, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    if (maxRedirects <= 0) return reject(new Error('Too many redirects'));
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return httpsGet(res.headers.location, dest, maxRedirects - 1).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode} fetching ${url}`));
      }
      const stream = fs.createWriteStream(dest);
      res.pipe(stream);
      stream.on('finish', () => stream.close(resolve));
      stream.on('error', reject);
    }).on('error', reject);
  });
}

async function buildOptionMode() {
  const filters = [releaseVersion, report, prs].filter(Boolean);
  if (filters.length === 0) {
    console.error('::error::Exactly one of release-version, report, or prs must be provided in option mode');
    process.exit(1);
  }
  if (filters.length > 1) {
    console.error('::error::Only one of release-version, report, or prs may be provided');
    process.exit(1);
  }
  const dockerArgs = ['--rm', '-v', `${process.cwd()}:/github/workspace`, '-w', '/github/workspace'];
  const bundleArgs = ['changelog', 'bundle', '--config', config, '--resolve'];

  if (output) {
    bundleArgs.push('--output', output);
  }

  if (releaseVersion) {
    bundleArgs.push('--release-version', releaseVersion);
    dockerArgs.push('-e', 'GITHUB_TOKEN');
  }

  if (report) {
    let effectiveReport = report;
    if (report.startsWith('https://')) {
      const dest = path.join(process.cwd(), '.bundle-report.html');
      await httpsGet(report, dest);
      effectiveReport = '.bundle-report.html';
    } else if (report.startsWith('http://')) {
      console.error(`::error::Report URL must use HTTPS: ${report}`);
      process.exit(1);
    }
    bundleArgs.push('--report', effectiveReport);
    dockerArgs.push('--network', 'none');
  }

  if (prs) {
    bundleArgs.push('--prs', prs);
    dockerArgs.push('--network', 'none');
  }

  if (repo) bundleArgs.push('--repo', repo);
  if (owner) bundleArgs.push('--owner', owner);

  return { dockerArgs, bundleArgs };
}

async function buildProfileMode() {
  const optionFilters = [releaseVersion, prs].filter(Boolean);
  if (optionFilters.length > 0) {
    console.error('::error::release-version and prs cannot be used with profile mode');
    process.exit(1);
  }

  const cfg = loadConfig(config);
  if (cfg) {
    const profiles = cfg?.bundle?.profiles;
    if (!profiles || !profiles[profile]) {
      const available = profiles ? Object.keys(profiles).join(', ') : 'none';
      console.error(`::error::Profile '${profile}' not found in ${config}. Available: ${available}`);
      process.exit(1);
    }

    const profileConfig = profiles[profile];
    const needsNetwork = profileConfig.source === 'github_release';

    if (needsNetwork) {
      console.log(`Profile '${profile}' uses source: github_release (network access required)`);
    }
  }

  const dockerArgs = ['--rm', '-v', `${process.cwd()}:/github/workspace`, '-w', '/github/workspace'];
  const bundleArgs = ['changelog', 'bundle', profile];

  if (version) bundleArgs.push(version);

  if (report) {
    let effectiveReport = report;
    if (report.startsWith('https://')) {
      const dest = path.join(process.cwd(), '.bundle-report.html');
      await httpsGet(report, dest);
      effectiveReport = '.bundle-report.html';
    } else if (report.startsWith('http://')) {
      console.error(`::error::Report URL must use HTTPS: ${report}`);
      process.exit(1);
    }
    bundleArgs.push(effectiveReport);
  }

  const cfg2 = loadConfig(config);
  const profileConfig = cfg2?.bundle?.profiles?.[profile];
  const needsNetwork = profileConfig?.source === 'github_release';

  if (needsNetwork) {
    dockerArgs.push('-e', 'GITHUB_TOKEN');
  } else if (!report || !report.startsWith('https://')) {
    dockerArgs.push('--network', 'none');
  }

  return { dockerArgs, bundleArgs };
}

async function main() {
  const isProfileMode = Boolean(profile);
  const { dockerArgs, bundleArgs } = isProfileMode
    ? await buildProfileMode()
    : await buildOptionMode();

  fs.writeFileSync(path.join(process.cwd(), '.bundle-marker'), '');

  fs.appendFileSync(githubOutput, `docker-args=${dockerArgs.join(' ')}\n`);
  fs.appendFileSync(githubOutput, `bundle-args=${bundleArgs.join(' ')}\n`);
}

main().catch((err) => {
  console.error(`::error::${err.message}`);
  process.exit(1);
});
