import { useState } from 'react';
import { RouterProvider } from 'react-router-dom';

import { usePortfolioAccess } from './hooks/usePortfolioAccess';
import { router } from './router';

function App() {
  const { status, error, unlock, hasConfiguredPortfolioAccessCode } = usePortfolioAccess();
  const [accessCodeInput, setAccessCodeInput] = useState('');

  if (status === 'error' || !hasConfiguredPortfolioAccessCode) {
    return (
      <div className="app-auth-shell">
        <div className="app-auth-card">
          <p className="eyebrow">Shared Access</p>
          <h1>系統設定尚未完成</h1>
          <p className="app-auth-copy">
            {error || '共享存取碼尚未配置，請聯絡管理員完成設定。'}
          </p>
        </div>
      </div>
    );
  }

  if (status !== 'unlocked') {
    return (
      <div className="app-auth-shell">
        <div className="app-auth-card">
          <p className="eyebrow">Shared Access</p>
          <h1>輸入共享存取碼</h1>

          <form
            onSubmit={(event) => {
              event.preventDefault();
              unlock(accessCodeInput);
            }}
          >
            <label className="form-field">
              <span>共享存取碼</span>
              <input
                type="password"
                value={accessCodeInput}
                onChange={(event) => setAccessCodeInput(event.target.value)}
                placeholder="輸入存取碼"
                autoComplete="current-password"
                enterKeyHint="go"
              />
            </label>

            {error ? <p className="status-message status-message-error">{error}</p> : null}

            <div className="form-actions">
              <button className="button button-primary" type="submit">
                進入投資組合
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  return (
    <RouterProvider
      router={router}
      fallbackElement={
        <div className="app-auth-shell" aria-busy="true">
          <div className="skeleton skeleton-card" style={{ width: 'min(100%, 34rem)' }} />
        </div>
      }
    />
  );
}

export default App;
