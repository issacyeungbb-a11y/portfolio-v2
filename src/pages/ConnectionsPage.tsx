import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { firebaseAuth } from '../lib/firebase/client';
import { getCurrentPortfolioAccessCode } from '../lib/access/accessCode';

type Connection = { id: string; scopes: string[]; createdAt: number; expiresAt: number };
type ConnectionData = { scopes?: string[]; connections?: Connection[] };
const scopeNames: Record<string, string> = {
  'portfolio:read': '查看持倉及價格',
  'transactions:read': '查看交易紀錄',
};

async function connectionRequest(body?: Record<string, unknown>, requestId?: string) {
  const token = await firebaseAuth?.currentUser?.getIdToken();
  if (!token) throw new Error('請先登入 Portfolio V2。');
  const query = requestId ? `?request=${encodeURIComponent(requestId)}` : '';
  const response = await fetch(`/oauth/manage${query}`, {
    method: body ? 'POST' : 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      'x-portfolio-access-code': getCurrentPortfolioAccessCode(),
      'Content-Type': 'application/json',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) throw new Error('未能完成連接操作。請重新登入，或在 ChatGPT 重新開始授權。');
  return response.json();
}

export function ConnectionsPage() {
  const [params] = useSearchParams();
  const requestId = params.get('request') ?? '';
  const [data, setData] = useState<ConnectionData | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    const referrer = document.createElement('meta');
    referrer.name = 'referrer';
    referrer.content = 'no-referrer';
    document.head.appendChild(referrer);
    void connectionRequest(undefined, requestId)
      .then((result) => {
        if (active) setData(result);
      })
      .catch((reason: Error) => {
        if (active) setError(reason.message);
      });
    return () => {
      active = false;
      referrer.remove();
    };
  }, [requestId]);

  async function approve(approved: boolean) {
    setBusy(true);
    setError('');
    try {
      const result = await connectionRequest({ action: 'approve', request: requestId, approved });
      window.location.assign(result.redirect);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '未能完成授權。');
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    setBusy(true);
    setError('');
    try {
      await connectionRequest({ action: 'revoke', id });
      setData(await connectionRequest());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '未能撤銷授權。');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="app-auth-shell">
      <section className="app-auth-card" aria-busy={busy || !data}>
        <h1>{requestId ? '允許 ChatGPT 查看投資組合' : '管理唯讀連接'}</h1>
        {error && (
          <p role="alert" className="status-message status-message-error">
            {error}
          </p>
        )}
        {!data && !error && <p>正在確認連接資料…</p>}
        {data && requestId && (
          <>
            <p>你即將授權 ChatGPT 讀取以下資料，並將查詢結果帶回 ChatGPT 對話。</p>
            <ul>
              {data.scopes?.map((scope) => (
                <li key={scope}>{scopeNames[scope]}</li>
              ))}
            </ul>
            <p>授權有效期為 30 日，可隨時在此網站撤銷。存取令牌每 10 分鐘更新。</p>
            <p>此連接只可查閱資料。</p>
            <div className="form-actions">
              <button
                className="button button-primary"
                disabled={busy}
                onClick={() => {
                  void approve(true);
                }}
              >
                允許唯讀存取
              </button>
              <button
                className="button"
                disabled={busy}
                onClick={() => {
                  void approve(false);
                }}
              >
                拒絕
              </button>
            </div>
          </>
        )}
        {data && !requestId && (
          <>
            {!data.connections?.length && <p>目前沒有有效的外部授權。</p>}
            {data.connections?.map((connection) => (
              <section key={connection.id}>
                <h2>ChatGPT</h2>
                <ul>
                  {connection.scopes.map((scope) => (
                    <li key={scope}>{scopeNames[scope]}</li>
                  ))}
                </ul>
                <p>
                  有效至{' '}
                  {new Date(connection.expiresAt * 1000).toLocaleString('zh-HK', {
                    timeZone: 'Asia/Hong_Kong',
                  })}
                </p>
                <button
                  className="button"
                  disabled={busy}
                  onClick={() => {
                    void revoke(connection.id);
                  }}
                >
                  撤銷此連接
                </button>
              </section>
            ))}
            <p>
              <a href="/">返回投資組合</a>
            </p>
          </>
        )}
      </section>
    </main>
  );
}
