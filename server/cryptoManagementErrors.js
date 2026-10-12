class CryptoManagementError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
  status;
}
function validateCryptoInput(check) {
  try {
    return check();
  } catch (error) {
    if (error instanceof CryptoManagementError) throw error;
    throw new CryptoManagementError(error instanceof Error ? error.message : "Crypto \u8CC7\u6599\u683C\u5F0F\u4E0D\u6B63\u78BA\u3002");
  }
}
function cryptoManagementErrorResponse(error) {
  return error instanceof CryptoManagementError ? { status: error.status, body: { ok: false, message: error.message } } : { status: 500, body: { ok: false, message: "\u66AB\u6642\u672A\u80FD\u78BA\u8A8D\u5132\u5B58\u7D50\u679C\uFF0C\u8ACB\u4F7F\u7528\u539F\u7B46\u64CD\u4F5C\u91CD\u8A66\uFF0C\u7CFB\u7D71\u6703\u907F\u514D\u91CD\u8907\u5165\u5E33\u3002" } };
}
export {
  CryptoManagementError,
  cryptoManagementErrorResponse,
  validateCryptoInput
};
