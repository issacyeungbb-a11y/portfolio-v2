/**
 * 通用 retry helper（指數退避）
 * 用於 Firestore / external API 的 transient error 重試。
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: {
    attempts?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
    label?: string;
    retryable?: (err: unknown) => boolean;
  } = {},
): Promise<T> {
  const {
    attempts = 3,
    baseDelayMs = 500,
    maxDelayMs = 4000,
    label = 'operation',
    retryable = () => true,
  } = options;

  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (i === attempts - 1 || !retryable(error)) break;
      const delay = Math.min(baseDelayMs * Math.pow(2, i), maxDelayMs);
      console.warn(
        `[retry] ${label} attempt ${i + 1}/${attempts} failed, retrying in ${delay}ms:`,
        error instanceof Error ? error.message : String(error),
      );
      await new Promise<void>((r) => setTimeout(r, delay));
    }
  }
  throw lastError;
}
