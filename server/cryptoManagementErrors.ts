export class CryptoManagementError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
export function validateCryptoInput<T>(check: () => T): T {
  try { return check(); }
  catch (error) {
    if (error instanceof CryptoManagementError) throw error;
    throw new CryptoManagementError(error instanceof Error ? error.message : 'Crypto 資料格式不正確。');
  }
}
export function cryptoManagementErrorResponse(error: unknown) {
  return error instanceof CryptoManagementError
    ? { status: error.status, body: { ok: false, message: error.message } }
    : { status: 500, body: { ok: false, message: '暫時未能確認儲存結果，請使用原筆操作重試，系統會避免重複入帳。' } };
}
