import { getAuth } from "firebase-admin/auth";
import { getFirebaseAdminApp, getFirebaseAdminDb } from "./firebaseAdmin.js";
const PORTFOLIO_ACCESS_CLAIM = "portfolioAccess";
const PORTFOLIO_SHARED_UID = "portfolio-shared-access";
async function createPortfolioAccessToken() {
  const security = (await getFirebaseAdminDb().doc("portfolioSecurity/access").get()).data();
  return getAuth(getFirebaseAdminApp()).createCustomToken(PORTFOLIO_SHARED_UID, {
    [PORTFOLIO_ACCESS_CLAIM]: true,
    portfolioAccessVersion: security?.version ?? 0
  });
}
export {
  PORTFOLIO_ACCESS_CLAIM,
  PORTFOLIO_SHARED_UID,
  createPortfolioAccessToken
};
