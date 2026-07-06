async function withRetry(fn, options = {}) {
  const {
    attempts = 3,
    baseDelayMs = 500,
    maxDelayMs = 4e3,
    label = "operation",
    retryable = () => true,
    retryDelayMs
  } = options;
  let lastError;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (i === attempts - 1 || !retryable(error)) break;
      const customDelay = retryDelayMs?.(error, i);
      const delay = Math.min(customDelay ?? baseDelayMs * Math.pow(2, i), maxDelayMs);
      console.warn(
        `[retry] ${label} attempt ${i + 1}/${attempts} failed, retrying in ${delay}ms:`,
        error instanceof Error ? error.message : String(error)
      );
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastError;
}
export {
  withRetry
};
