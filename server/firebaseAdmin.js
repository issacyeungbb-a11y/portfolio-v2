import { cert, getApp, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
const SHARED_PORTFOLIO_COLLECTION = "portfolio";
const SHARED_PORTFOLIO_DOC_ID = "app";
const SHARED_COIN_GECKO_OVERRIDE_COLLECTION = "coinIdOverrides";
const ADMIN_ENV_KEYS = [
  "FIREBASE_ADMIN_PROJECT_ID",
  "FIREBASE_ADMIN_CLIENT_EMAIL",
  "FIREBASE_ADMIN_PRIVATE_KEY"
];
function normalizePrivateKey(value) {
  return value.replace(/\\n/g, "\n").trim();
}
function readServiceAccountFromJson() {
  const raw = process.env.FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON?.trim();
  if (!raw) {
    return null;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON \u4E0D\u662F\u6709\u6548\u7684 JSON\u3002");
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON \u683C\u5F0F\u4E0D\u6B63\u78BA\u3002");
  }
  const value = parsed;
  const projectId = typeof value.project_id === "string" ? value.project_id.trim() : typeof value.projectId === "string" ? value.projectId.trim() : "";
  const clientEmail = typeof value.client_email === "string" ? value.client_email.trim() : typeof value.clientEmail === "string" ? value.clientEmail.trim() : "";
  const privateKey = typeof value.private_key === "string" ? normalizePrivateKey(value.private_key) : typeof value.privateKey === "string" ? normalizePrivateKey(value.privateKey) : "";
  if (!projectId || !clientEmail || !privateKey) {
    throw new Error(
      "FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON \u7F3A\u5C11 project_id\u3001client_email \u6216 private_key\u3002"
    );
  }
  return {
    projectId,
    clientEmail,
    privateKey
  };
}
function readServiceAccountFromEnv() {
  const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID?.trim() || process.env.VITE_FIREBASE_PROJECT_ID?.trim() || "";
  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL?.trim() || "";
  const privateKey = normalizePrivateKey(process.env.FIREBASE_ADMIN_PRIVATE_KEY ?? "");
  if (!projectId && !clientEmail && !privateKey) {
    return null;
  }
  if (!projectId || !clientEmail || !privateKey) {
    throw new Error(
      `Firebase Admin \u8A2D\u5B9A\u4E0D\u5B8C\u6574\u3002\u8ACB\u88DC\u4E0A ${ADMIN_ENV_KEYS.join("\u3001")}\uFF0C\u6216\u6539\u7528 FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON\u3002`
    );
  }
  return {
    projectId,
    clientEmail,
    privateKey
  };
}
function getFirebaseAdminServiceAccount() {
  return readServiceAccountFromJson() ?? readServiceAccountFromEnv();
}
function getFirebaseAdminSetupErrorMessage(error) {
  if (error instanceof Error) {
    return error.message;
  }
  return `\u672A\u8A2D\u5B9A Firebase Admin \u6191\u8B49\u3002\u8ACB\u8A2D\u5B9A FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON\uFF0C\u6216 ${ADMIN_ENV_KEYS.join("\u3001")}\u3002`;
}
function getFirebaseAdminApp() {
  if (getApps().length > 0) {
    return getApp();
  }
  const serviceAccount = getFirebaseAdminServiceAccount();
  if (!serviceAccount) {
    throw new Error(
      `\u672A\u8A2D\u5B9A Firebase Admin \u6191\u8B49\u3002\u8ACB\u8A2D\u5B9A FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON\uFF0C\u6216 ${ADMIN_ENV_KEYS.join("\u3001")}\u3002`
    );
  }
  return initializeApp({
    credential: cert(serviceAccount),
    projectId: serviceAccount.projectId
  });
}
async function verifyFirebaseIdToken(idToken) {
  const auth = getAuth(getFirebaseAdminApp());
  return auth.verifyIdToken(idToken);
}
function getFirebaseAdminDb() {
  return getFirestore(getFirebaseAdminApp());
}
function getSharedPortfolioDocRef() {
  return getFirebaseAdminDb().collection(SHARED_PORTFOLIO_COLLECTION).doc(SHARED_PORTFOLIO_DOC_ID);
}
function getSharedCoinGeckoCoinIdCacheCollectionRef() {
  return getSharedPortfolioDocRef().collection("coinIdCache");
}
function getSharedCoinGeckoCoinIdCacheDocRef(ticker) {
  return getSharedCoinGeckoCoinIdCacheCollectionRef().doc(ticker.trim().toUpperCase());
}
function getSharedCoinGeckoCoinIdCacheDocRefs(tickers) {
  return tickers.map((ticker) => getSharedCoinGeckoCoinIdCacheDocRef(ticker));
}
function getSharedCoinGeckoCoinIdOverridesCollectionRef() {
  return getSharedPortfolioDocRef().collection(SHARED_COIN_GECKO_OVERRIDE_COLLECTION);
}
function getSharedCoinGeckoCoinIdOverrideDocRef(ticker) {
  return getSharedCoinGeckoCoinIdOverridesCollectionRef().doc(ticker.trim().toUpperCase());
}
function getSharedCoinGeckoCoinIdOverrideDocRefs(tickers) {
  return tickers.map((ticker) => getSharedCoinGeckoCoinIdOverrideDocRef(ticker));
}
export {
  getFirebaseAdminApp,
  getFirebaseAdminDb,
  getFirebaseAdminSetupErrorMessage,
  getSharedCoinGeckoCoinIdCacheCollectionRef,
  getSharedCoinGeckoCoinIdCacheDocRef,
  getSharedCoinGeckoCoinIdCacheDocRefs,
  getSharedCoinGeckoCoinIdOverrideDocRef,
  getSharedCoinGeckoCoinIdOverrideDocRefs,
  getSharedCoinGeckoCoinIdOverridesCollectionRef,
  getSharedPortfolioDocRef,
  verifyFirebaseIdToken
};
