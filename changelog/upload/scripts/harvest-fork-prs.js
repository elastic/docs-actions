const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const SUBMIT_WORKFLOW_FILE = 'changelog-submit.yml';
const ARTIFACT_NAME = 'changelog-staging';
const SUCCESS_STATUS = 'success';

// In the common case (single squash-merged PR per push), this returns exactly
// one fork PR. The loop in the caller is defensive against a handful of edge
// cases where GitHub may associate multiple PRs with one commit:
//   1. Stacked fork PRs merged via rebase/merge-commit rather than squash —
//      the later PR's merge commit history includes earlier PRs' commits.
//      Earlier PRs were already harvested on their own push; re-harvesting is
//      a no-op because docs-builder changelog upload is incremental.
//   2. Cherry-picks of the same commit across multiple fork PRs.
//   3. Overlapping force-push history between two open PRs that share a base.
//   4. Merge-queue batched merges (if ever enabled) that group several PRs
//      into one resulting commit.
async function findMergedForkPrs({ github, owner, repo, sha, core }) {
  const prs = await github.paginate(
    github.rest.repos.listPullRequestsAssociatedWithCommit,
    { owner, repo, commit_sha: sha, per_page: 100 }
  );
  return prs.filter(pr => {
    if (!pr.merged_at) return false;
    const head = pr.head.repo?.full_name;
    const base = pr.base.repo?.full_name;
    if (!head || !base) {
      core.warning(`PR #${pr.number}: missing head or base repo info, skipping`);
      return false;
    }
    return head !== base;
  });
}

async function findLatestSubmitRun({ github, owner, repo, headSha, core }) {
  const runs = await github.paginate(
    github.rest.actions.listWorkflowRuns,
    {
      owner,
      repo,
      workflow_id: SUBMIT_WORKFLOW_FILE,
      head_sha: headSha,
      per_page: 100,
    }
  );
  const successful = runs.filter(r => r.conclusion === 'success');
  if (successful.length === 0) {
    core.warning(`No successful ${SUBMIT_WORKFLOW_FILE} run found for head SHA ${headSha}`);
    return null;
  }
  successful.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  return successful[0];
}

async function downloadArtifact({ github, owner, repo, runId, destDir, core }) {
  const { data } = await github.rest.actions.listWorkflowRunArtifacts({
    owner, repo, run_id: runId, per_page: 100,
  });
  const artifact = data.artifacts.find(a => a.name === ARTIFACT_NAME);
  if (!artifact) {
    core.warning(`Run ${runId} has no '${ARTIFACT_NAME}' artifact (possibly expired beyond 90-day retention)`);
    return null;
  }
  if (artifact.expired) {
    core.warning(`Artifact '${ARTIFACT_NAME}' on run ${runId} has expired`);
    return null;
  }

  const zip = await github.rest.actions.downloadArtifact({
    owner, repo, artifact_id: artifact.id, archive_format: 'zip',
  });

  fs.mkdirSync(destDir, { recursive: true });
  const zipPath = path.join(destDir, '_artifact.zip');
  fs.writeFileSync(zipPath, Buffer.from(zip.data));
  execFileSync('unzip', ['-q', '-o', zipPath, '-d', destDir]);
  fs.unlinkSync(zipPath);

  assertExtractedTreeSafe(destDir);
  return destDir;
}

// Defense-in-depth: even though prepare-artifact (docs-builder) is trusted,
// validate every extracted entry stays inside destDir (zip-slip protection)
// and is a regular file (no symlinks that fs.copyFileSync would later follow
// to read sensitive paths off the runner).
function assertExtractedTreeSafe(destDir) {
  const root = fs.realpathSync(destDir);
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error(`Refusing symlink in artifact: ${full}`);
      }
      const resolved = fs.realpathSync(full);
      if (resolved !== root && !resolved.startsWith(root + path.sep)) {
        throw new Error(`Artifact entry escapes destination (zip-slip): ${full} -> ${resolved}`);
      }
      if (entry.isDirectory()) {
        walk(full);
      } else if (!entry.isFile()) {
        throw new Error(`Refusing non-regular artifact entry: ${full}`);
      }
    }
  };
  walk(root);
}

function readMetadata({ artifactDir }) {
  const metaPath = path.join(artifactDir, 'metadata.json');
  if (!fs.existsSync(metaPath)) {
    throw new Error(`Artifact missing metadata.json at ${metaPath}`);
  }
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  // The producer (docs-builder) emits snake_case JSON; the camelCase /
  // kebab-case fallbacks guard against producer-side schema drift.
  return {
    prNumber: Number(meta['pr-number'] ?? meta.prNumber ?? meta.pr_number),
    headSha: meta['head-sha'] ?? meta.headSha ?? meta.head_sha,
    status: meta['status'] ?? meta.Status,
    changelogDir: meta['changelog-dir'] ?? meta.changelogDir ?? meta.changelog_dir,
    changelogFilename: meta['changelog-filename'] ?? meta.changelogFilename ?? meta.changelog_filename,
  };
}

function assertVerified({ meta, expectedPrNumber, expectedHeadSha }) {
  if (meta.prNumber !== expectedPrNumber) {
    throw new Error(
      `Artifact metadata pr-number mismatch (expected ${expectedPrNumber}, got ${meta.prNumber}). ` +
      `Refusing to upload an unverified artifact.`
    );
  }
  if (meta.headSha !== expectedHeadSha) {
    throw new Error(
      `Artifact metadata head-sha mismatch (expected ${expectedHeadSha}, got ${meta.headSha}). ` +
      `Refusing to upload an unverified artifact.`
    );
  }
}

function findStagedYaml(dir) {
  return fs.readdirSync(dir)
    .filter(name => name.endsWith('.yaml'))
    .map(name => path.join(dir, name))[0];
}

// Mirrors the path validators in changelog/upload/action.yml and
// changelog/bundle-create/action.yml: reject absolute paths and any segment
// equal to "..". Empty values are also rejected.
function assertSafeRelPath(value, label) {
  if (!value) {
    throw new Error(`${label} is empty`);
  }
  if (path.isAbsolute(value)) {
    throw new Error(`${label} must be relative, not absolute: ${value}`);
  }
  if (value.split(/[\/\\]/).includes('..')) {
    throw new Error(`${label} must not contain '..': ${value}`);
  }
}

// Filenames must be a single path component with no traversal segments.
// We do not enforce a strict character class here because docs-builder's
// SanitizeFilename can leave through legitimate-but-unusual characters
// (Unicode, '#', '[', etc.) when derived from PR titles; the security
// boundary is "no path separators, no traversal" because we use fs APIs
// directly (no shell interpretation).
function assertSafeFilename(value, label) {
  assertSafeRelPath(value, label);
  if (path.basename(value) !== value) {
    throw new Error(`${label} must not contain path separators: ${value}`);
  }
  if (value === '.' || value === '..') {
    throw new Error(`${label} must not be '.' or '..'`);
  }
}

function placeYaml({ artifactDir, meta, core }) {
  // prepare-artifact emits an artifact for every evaluate outcome. Only the
  // "success" status carries a generated YAML; for other statuses (no-label,
  // skipped, manually-edited, error) there is nothing to upload.
  if (meta.status !== SUCCESS_STATUS) {
    core.notice(`status='${meta.status}' — no YAML to stage, skipping`);
    return null;
  }
  assertSafeRelPath(meta.changelogDir, 'changelog_dir');

  const sourceYaml = findStagedYaml(artifactDir);
  if (!sourceYaml) {
    throw new Error(`status='success' but no YAML file found in ${artifactDir}`);
  }
  const sourceBasename = path.basename(sourceYaml);
  assertSafeFilename(sourceBasename, 'staged YAML filename');

  const targetFilename = meta.changelogFilename || sourceBasename;
  assertSafeFilename(targetFilename, 'changelog_filename');

  const targetPath = path.join(meta.changelogDir, targetFilename);
  fs.mkdirSync(meta.changelogDir, { recursive: true });
  fs.copyFileSync(sourceYaml, targetPath);
  core.info(`Placed ${sourceYaml} -> ${targetPath}`);
  return targetPath;
}

module.exports = async ({ github, context, core }) => {
  const { owner, repo } = context.repo;
  const sha = process.env.PUSHED_SHA || context.sha;
  const harvestRoot = process.env.HARVEST_DIR || '/tmp/changelog-harvested';

  fs.mkdirSync(harvestRoot, { recursive: true });

  const forkPrs = await findMergedForkPrs({ github, owner, repo, sha, core });
  if (forkPrs.length === 0) {
    core.info(`No merged fork PRs associated with ${sha}; nothing to harvest.`);
    return;
  }

  core.info(`Found ${forkPrs.length} merged fork PR(s) for ${sha}: ${forkPrs.map(p => '#' + p.number).join(', ')}`);

  for (const pr of forkPrs) {
    const headSha = pr.head.sha;
    core.startGroup(`PR #${pr.number} (head ${headSha.substring(0, 7)})`);
    try {
      const run = await findLatestSubmitRun({ github, owner, repo, headSha, core });
      if (!run) {
        continue;
      }
      core.info(`Latest successful submit run: ${run.id} (${run.html_url})`);

      const destDir = path.join(harvestRoot, `pr-${pr.number}`);
      const downloaded = await downloadArtifact({ github, owner, repo, runId: run.id, destDir, core });
      if (!downloaded) {
        continue;
      }

      const meta = readMetadata({ artifactDir: destDir });
      assertVerified({ meta, expectedPrNumber: pr.number, expectedHeadSha: headSha });
      core.info(`Verified artifact for PR #${pr.number} (status=${meta.status})`);

      placeYaml({ artifactDir: destDir, meta, core });
    } catch (err) {
      core.error(`PR #${pr.number}: harvest failed — ${err.message}`);
      throw err;
    } finally {
      core.endGroup();
    }
  }
};
