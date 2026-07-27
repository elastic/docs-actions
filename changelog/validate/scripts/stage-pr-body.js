const fs = require('fs');
const { stagePrBody } = require('../../shared/scripts/pr-body');

const main = (env = process.env) => {
  if (!env.GITHUB_EVENT_PATH) throw new Error('GITHUB_EVENT_PATH is not set');
  if (!env.GITHUB_OUTPUT) throw new Error('GITHUB_OUTPUT is not set');

  const event = JSON.parse(fs.readFileSync(env.GITHUB_EVENT_PATH, 'utf8'));
  if (!event.pull_request) throw new Error('GitHub event does not contain a pull_request');

  const staged = stagePrBody(event.pull_request.body, env.RUNNER_TEMP);
  fs.appendFileSync(env.GITHUB_OUTPUT, `path=${staged.path}\n`, 'utf8');

  if (staged.truncated) {
    console.log(
      `::warning::PR body is ${staged.originalBytes} bytes; staged the first ${staged.writtenBytes} complete UTF-8 bytes.`
    );
  }

  return staged;
};

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`::error::Failed to stage PR body: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { main };
