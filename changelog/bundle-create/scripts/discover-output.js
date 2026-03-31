'use strict';

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const configPath = process.env.CONFIG || 'docs/changelog.yml';
const explicitOutput = process.env.OUTPUT;
const githubOutput = process.env.GITHUB_OUTPUT;

function loadConfig(filePath) {
  try {
    return yaml.load(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    return null;
  }
}

function findNewestYaml(dir, markerPath) {
  if (!fs.existsSync(dir)) {
    console.error(`::error::Output directory does not exist: ${dir}`);
    process.exit(1);
  }

  const markerTime = fs.existsSync(markerPath)
    ? fs.statSync(markerPath).mtimeMs
    : 0;

  const files = fs.readdirSync(dir)
    .filter(f => f.endsWith('.yaml') || f.endsWith('.yml'))
    .map(f => {
      const full = path.join(dir, f);
      return { path: full, mtime: fs.statSync(full).mtimeMs };
    })
    .filter(f => f.mtime > markerTime)
    .sort((a, b) => b.mtime - a.mtime);

  return files.length > 0 ? files[0].path : null;
}

if (explicitOutput) {
  if (!fs.existsSync(explicitOutput)) {
    console.error(`::error::Expected bundle file not found at: ${explicitOutput}`);
    process.exit(1);
  }
  fs.appendFileSync(githubOutput, `output=${explicitOutput}\n`);
  console.log(`Bundle output (explicit): ${explicitOutput}`);
  process.exit(0);
}

const cfg = loadConfig(configPath);
const outputDir = cfg?.bundle?.output_directory;

if (!outputDir) {
  console.error(`::error::Cannot discover bundle output: 'output' input not provided and bundle.output_directory not set in ${configPath}`);
  process.exit(1);
}

const markerPath = path.join(process.cwd(), '.bundle-marker');
const discovered = findNewestYaml(outputDir, markerPath);

if (!discovered) {
  console.error(`::error::No bundle file found in ${outputDir} after generation`);
  process.exit(1);
}

fs.appendFileSync(githubOutput, `output=${discovered}\n`);
console.log(`Bundle output (discovered): ${discovered}`);
