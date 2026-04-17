/**
 * Shared cron authentication — decoupled from any specific cron module to
 * avoid circular imports between cronDailyUpdate ↔ cronCaptureSnapshot.
 *
 * Previously verifyCronRequest lived in cronUpdatePrices.ts (deleted P2-5).
 * cronDailyUpdate.ts re-exported it, but cronCaptureSnapshot.ts also imports
 * cronDailyUpdate.ts → circular dependency. This file breaks the cycle.
 */

class CronAuthError extends Error {
  status: number;
  constructor(message: string, status = 500) {
    super(message);
    this.name = 'CronAuthError';
    this.status = status;
  }
}

export function verifyCronRequest(authorizationHeader: string | undefined): void {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) throw new CronAuthError('未設定 CRON_SECRET。', 500);
  if (authorizationHeader !== `Bearer ${secret}`) {
    throw new CronAuthError('未授權的 cron 請求。', 401);
  }
}
