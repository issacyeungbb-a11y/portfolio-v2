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

          <label className="form-field">
            <span>共享存取碼</span>
            <input
              type="password"
              value={accessCodeInput}
              onChange={(event) => setAccessCodeInput(event.target.value)}
              placeholder="輸入存取碼"
            />
          </label>

          {error ? <p className="status-message status-message-error">{error}</p> : null}

          <div className="form-actions">
            <button
              className="button button-primary"
              type="button"
              onClick={() => unlock(accessCodeInput)}
            >
              進入投資組合
            </button>
          </div>
        </div>
      </div>
    );
  }

  return <RouterProvider router={router} />;
}

export default App;
