import { useEffect, useState } from 'react';
import { RouterProvider } from 'react-router-dom';

import { useAnonymousAuth } from './hooks/useAnonymousAuth';
import {
  ensureUserDocument,
  getFirebaseUserBootstrapErrorMessage,
} from './lib/firebase/users';
import { router } from './router';

const USER_BOOTSTRAP_TIMEOUT_MS = 10000;

function withUserBootstrapTimeout<T>(promise: Promise<T>) {
  return new Promise<T>((resolve, reject) => {
    const timeoutId = globalThis.setTimeout(() => {
      reject(new Error('FIRESTORE_USER_BOOTSTRAP_TIMEOUT'));
    }, USER_BOOTSTRAP_TIMEOUT_MS);

    promise
      .then((value) => {
        globalThis.clearTimeout(timeoutId);
        resolve(value);
      })
      .catch((error) => {
        globalThis.clearTimeout(timeoutId);
        reject(error);
      });
  });
}

function App() {
  const { status, error, uid } = useAnonymousAuth();
  const [userDocStatus, setUserDocStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>(
    'idle',
  );
  const [userDocError, setUserDocError] = useState<string | null>(null);

  useEffect(() => {
    if (status !== 'authenticated' || !uid) {
      if (status !== 'authenticated') {
        setUserDocStatus('idle');
        setUserDocError(null);
      }
      return;
    }

    let isActive = true;
    setUserDocStatus('loading');
    setUserDocError(null);

    withUserBootstrapTimeout(ensureUserDocument(uid))
      .then(() => {
        if (!isActive) {
          return;
        }

        setUserDocStatus('ready');
      })
      .catch((bootstrapError) => {
        if (!isActive) {
          return;
        }

        setUserDocStatus('error');
        setUserDocError(getFirebaseUserBootstrapErrorMessage(bootstrapError));
      });

    return () => {
      isActive = false;
    };
  }, [status, uid]);

  if (status === 'loading') {
    return (
      <div className="app-auth-shell">
        <div className="app-auth-card">
          <p className="eyebrow">Firebase Auth</p>
          <h1>正在啟動匿名身份</h1>
          <p className="app-auth-copy">
            應用程式會在開啟時自動匿名登入，之後再進入主介面。
          </p>
        </div>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="app-auth-shell">
        <div className="app-auth-card">
          <p className="eyebrow">Firebase Auth</p>
          <h1>匿名登入未完成</h1>
          <p className="app-auth-copy">{error}</p>
          <p className="app-auth-note">
            請先把 Firebase 設定填入 `.env.local` 或 `.env`，再重新啟動開發伺服器。
          </p>
        </div>
      </div>
    );
  }

  if (status === 'authenticated' && userDocStatus !== 'ready') {
    return (
      <div className="app-auth-shell">
        <div className="app-auth-card">
          <p className="eyebrow">Firestore User</p>
          <h1>
            {userDocStatus === 'error' ? '用戶資料初始化未完成' : '正在建立匿名用戶資料'}
          </h1>
          <p className="app-auth-copy">
            {userDocStatus === 'error'
              ? userDocError
              : '匿名登入已完成，正在同步 users/{uid} 文件。'}
          </p>
          {uid ? <p className="app-auth-note">UID: {uid}</p> : null}
          {userDocStatus === 'error' ? (
            <div className="roadmap-list">
              <div className="roadmap-item">
                <strong>先檢查 Firestore Database</strong>
                <p>去 Firebase Console 的 Build → Firestore Database，確認你已建立 Cloud Firestore。</p>
              </div>
              <div className="roadmap-item">
                <strong>再檢查 Firestore rules</strong>
                <p>確認匿名登入後，已容許使用者讀寫自己的 `users/{'{uid}'}` 與 `users/{'{uid}'}/assets`。</p>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  return <RouterProvider router={router} />;
}

export default App;
