import { onAuthStateChanged, signInAnonymously, } from 'firebase/auth';
import { firebaseAuth, hasFirebaseConfig, missingFirebaseEnvKeys, } from './client';
let authReadyPromise = null;
let anonymousSignInPromise = null;
function createMissingConfigError() {
    return new Error(`Missing Firebase env vars: ${missingFirebaseEnvKeys.join(', ')}`);
}
function getRequiredFirebaseAuth() {
    if (!firebaseAuth) {
        throw createMissingConfigError();
    }
    return firebaseAuth;
}
function normalizeFirebaseError(error) {
    if (error instanceof Error) {
        return error.message;
    }
    return 'Firebase 匿名登入失敗，請稍後再試。';
}
export function getFirebaseAuthErrorMessage(error) {
    if (!hasFirebaseConfig) {
        return `Firebase 尚未設定完成，請先填入 .env.local 或 .env 內的設定值：${missingFirebaseEnvKeys.join(', ')}`;
    }
    if (!error) {
        return 'Firebase 匿名登入失敗，請稍後再試。';
    }
    return normalizeFirebaseError(error);
}
function waitForInitialAuthState() {
    const auth = getRequiredFirebaseAuth();
    if (auth.currentUser) {
        return Promise.resolve(auth.currentUser);
    }
    if (!authReadyPromise) {
        authReadyPromise = new Promise((resolve, reject) => {
            const unsubscribe = onAuthStateChanged(auth, (user) => {
                unsubscribe();
                resolve(user);
            }, reject);
        });
    }
    return authReadyPromise;
}
export async function ensureAnonymousSession() {
    if (!hasFirebaseConfig) {
        throw createMissingConfigError();
    }
    const auth = getRequiredFirebaseAuth();
    const existingUser = await waitForInitialAuthState();
    if (existingUser) {
        return existingUser;
    }
    if (!anonymousSignInPromise) {
        anonymousSignInPromise = signInAnonymously(auth)
            .then((result) => result.user)
            .finally(() => {
            anonymousSignInPromise = null;
        });
    }
    return anonymousSignInPromise;
}
export async function getFirebaseIdToken(forceRefresh = false) {
    const user = await ensureAnonymousSession();
    return user.getIdToken(forceRefresh);
}
export function subscribeToFirebaseAuth(callback) {
    if (!firebaseAuth) {
        return () => { };
    }
    const auth = getRequiredFirebaseAuth();
    return onAuthStateChanged(auth, callback);
}
