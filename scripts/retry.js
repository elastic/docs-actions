/**
 * Retry a function with exponential backoff (4 attempts, 2s/4s/8s waits).
 *
 * @param {Function} fn - async function to retry
 * @param {string} label - descriptive label for log messages
 * @param {object} options
 * @param {object} options.core - GitHub Actions core module for warnings
 * @returns {Promise<*>} result of fn()
 */
async function retryWithBackoff(fn, label, { core }) {
  const maxAttempts = 4;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === maxAttempts) throw err;
      const delay = Math.pow(2, attempt) * 1000;
      core.warning(`${label} failed (attempt ${attempt}/${maxAttempts}): ${err.message}. Retrying in ${delay}ms...`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

module.exports = { retryWithBackoff };
