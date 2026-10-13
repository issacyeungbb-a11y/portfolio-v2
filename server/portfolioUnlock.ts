import { getAuth } from 'firebase-admin/auth';

import { getFirebaseAdminApp } from './firebaseAdmin.js';

/**
 * 共享存取碼只喺伺服器驗證。通過後簽發 Firebase custom token，
 * 前端用佢登入，Firestore rules 就靠呢個 claim 判斷可否讀寫。
 */
export const PORTFOLIO_ACCESS_CLAIM = 'portfolioAccess';
export const PORTFOLIO_SHARED_UID = 'portfolio-shared-access';

export async function createPortfolioAccessToken() {
  return getAuth(getFirebaseAdminApp()).createCustomToken(PORTFOLIO_SHARED_UID, {
    [PORTFOLIO_ACCESS_CLAIM]: true,
  });
}
