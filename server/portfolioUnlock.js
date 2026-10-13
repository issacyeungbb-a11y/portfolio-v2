import { getAuth } from "firebase-admin/auth";
import { getFirebaseAdminApp } from "./firebaseAdmin.js";
const PORTFOLIO_ACCESS_CLAIM = "portfolioAccess";
const PORTFOLIO_SHARED_UID = "portfolio-shared-access";
async function createPortfolioAccessToken() {
  return getAuth(getFirebaseAdminApp()).createCustomToken(PORTFOLIO_SHARED_UID, {
    [PORTFOLIO_ACCESS_CLAIM]: true
  });
}
export {
  PORTFOLIO_ACCESS_CLAIM,
  PORTFOLIO_SHARED_UID,
  createPortfolioAccessToken
};
