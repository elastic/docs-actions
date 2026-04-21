/**
 * Retry a function with exponential backoff.
 *
 * @param {Function} fn - async function to retry
 * @param {string} label - descriptive label for log messages
 * @param {object} [options]
 * @param {number} [options.maxAttempts=4] - total attempts before giving up
 * @param {number} [options.baseDelay=1000] - base delay in ms (doubled each attempt)
 * @param {object} [options.core] - GitHub Actions core module for warnings (falls back to console)
 * @returns {Promise<*>} result of fn()
 */
async function retryWithBackoff(fn, label, { maxAttempts = 4, baseDelay = 1000, core = null } = {}) {
  const warn = core ? (msg) => core.warning(msg) : console.warn;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === maxAttempts) throw err;
      const delay = Math.pow(2, attempt) * baseDelay;
      warn(`${label} failed (attempt ${attempt}/${maxAttempts}): ${err.message}. Retrying in ${delay}ms...`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

module.exports = { retryWithBackoff };
