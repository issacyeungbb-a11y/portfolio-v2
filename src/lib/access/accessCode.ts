import { signInWithCustomToken, signOut } from 'firebase/auth';

import { firebaseAuth } from '../firebase/client';
import { getRestoredFirebaseUser } from '../firebase/auth';

// 存取碼只喺伺服器驗證，唔再打包入前端。用戶輸入嘅存取碼會留喺本機，
// 用嚟呼叫受保護嘅 API；Firestore 讀寫則靠伺服器簽發嘅 Firebase 登入憑證。
const ACCESS_CODE_STORAGE_KEY = 'portfolio_access_code_v2';
const LEGACY_ACCESS_STORAGE_KEY = 'portfolio_access_verified_v1';
const PORTFOLIO_ACCESS_CLAIM = 'portfolioAccess';
const UNLOCK_PATH = '/api/health?mode=unlock';

export const hasConfiguredPortfolioAccessCode = true;

export class PortfolioAccessDeniedError extends Error {
  constructor() {
    super('存取碼不正確，請再試一次。');
    this.name = 'PortfolioAccessDeniedError';
  }
}

function readStorage(key: string) {
  try {
    return typeof window === 'undefined' ? null : window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string | null) {
  try {
    if (typeof window === 'undefined') return;
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // 私人瀏覽模式等情況下無法儲存，下次開啟要重新輸入存取碼。
  }
}

export function getCurrentPortfolioAccessCode() {
  return readStorage(ACCESS_CODE_STORAGE_KEY)?.trim() ?? '';
}

export async function hasPortfolioAccessSession() {
  const user = await getRestoredFirebaseUser();
  if (!user) return false;
  const token = await user.getIdTokenResult();
  return token.claims[PORTFOLIO_ACCESS_CLAIM] === true;
}

export async function unlockPortfolio(input: string) {
  const code = input.trim();
  if (!code) throw new PortfolioAccessDeniedError();
  if (!firebaseAuth) throw new Error('Firebase 尚未設定完成，未能登入。');

  const response = await fetch(UNLOCK_PATH, {
    method: 'POST',
    headers: { 'x-portfolio-access-code': code },
  });
  const data = (await response.json().catch(() => null)) as { token?: unknown; message?: unknown } | null;

  if (response.status === 401) throw new PortfolioAccessDeniedError();
  if (!response.ok || typeof data?.token !== 'string') {
    throw new Error(typeof data?.message === 'string' ? data.message : `未能驗證存取碼（HTTP ${response.status}）。`);
  }

  await signInWithCustomToken(firebaseAuth, data.token);
  writeStorage(ACCESS_CODE_STORAGE_KEY, code);
  writeStorage(LEGACY_ACCESS_STORAGE_KEY, null);
}

export async function lockPortfolio() {
  writeStorage(ACCESS_CODE_STORAGE_KEY, null);
  writeStorage(LEGACY_ACCESS_STORAGE_KEY, null);
  if (firebaseAuth) await signOut(firebaseAuth);
}
