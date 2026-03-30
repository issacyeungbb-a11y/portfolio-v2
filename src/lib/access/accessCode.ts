const ACCESS_CODE_STORAGE_KEY = 'portfolio_access_verified_v1';

function readEnvAccessCode() {
  return String(import.meta.env.VITE_PORTFOLIO_ACCESS_CODE ?? '').trim();
}

export const configuredPortfolioAccessCode = readEnvAccessCode();
export const hasConfiguredPortfolioAccessCode = configuredPortfolioAccessCode.length > 0;

export function getAccessCodeStorageKey() {
  return ACCESS_CODE_STORAGE_KEY;
}

export function getStoredAccessCodeVerification() {
  if (typeof window === 'undefined') {
    return false;
  }

  return window.localStorage.getItem(ACCESS_CODE_STORAGE_KEY) === 'verified';
}

export function persistAccessCodeVerification() {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(ACCESS_CODE_STORAGE_KEY, 'verified');
}

export function clearAccessCodeVerification() {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.removeItem(ACCESS_CODE_STORAGE_KEY);
}

export function verifyPortfolioAccessCode(input: string) {
  return input.trim() === configuredPortfolioAccessCode;
}

export function getPortfolioAccessCodeErrorMessage() {
  if (!hasConfiguredPortfolioAccessCode) {
    return '尚未設定共享存取碼，請先在環境變數加入 VITE_PORTFOLIO_ACCESS_CODE。';
  }

  return '存取碼不正確，請再試一次。';
}

export function getCurrentPortfolioAccessCode() {
  return configuredPortfolioAccessCode;
}
