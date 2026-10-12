import { useRef, useState } from 'react';
import { callPortfolioFunction, PortfolioFunctionHttpError } from '../../lib/api/vercelFunctions';
import type { CryptoManagementResponse, CryptoAssetSyncStatus as SyncStatus } from '../../types/cryptoManagement';

export function CryptoAssetSyncStatus({ status, onUpdated }: { status: SyncStatus; onUpdated: (data: CryptoManagementResponse) => void }) {
  const request = useRef<Record<string, unknown> | null>(null);
  const submitting = useRef(false);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const checkedAt = Number.isFinite(Date.parse(status.checkedAt)) ? new Intl.DateTimeFormat('zh-HK', { timeZone: 'Asia/Hong_Kong', dateStyle: 'short', timeStyle: 'short' }).format(new Date(status.checkedAt)) : '';
  async function sync() {
    if (submitting.current) return;
    submitting.current = true; setBusy(true); setError('');
    try {
      request.current ??= { action: 'reconcile-assets', expectedVersion: status.version, expectedAssetsChecksum: status.checksum, operationId: crypto.randomUUID() };
      setPending(true);
      onUpdated(await callPortfolioFunction('crypto-management', request.current) as CryptoManagementResponse);
      request.current = null; setPending(false);
    } catch (e) {
      if (e instanceof PortfolioFunctionHttpError && e.status >= 400 && e.status < 500 && e.status !== 429) {
        request.current = null; setPending(false);
        try { onUpdated(await callPortfolioFunction('crypto-management', { action: 'read' }) as CryptoManagementResponse); } catch { /* Keep the last visible result until refresh succeeds. */ }
        setError(e.message.split(/（(?:POST|GET) /)[0] + ' 請核對最新結果再同步。');
      } else setError('暫時未能確認同步結果，請重試原筆同步，系統會避免重複寫入。');
    } finally { submitting.current = false; setBusy(false); }
  }
  return <div className={`cm-sync-status ${status.status === 'pending' ? 'cm-sync-pending' : ''}`} role="status">
    <div><strong>{status.status === 'synced' ? '數量已同步至資產大表' : '資產大表數量待核對'}</strong><span>{status.coinCount} 個幣種 · 每次儲存變動時自動同步{checkedAt ? ` · 最近核對：${checkedAt}` : ''}</span></div>
    {(status.status === 'pending' || pending) && <button type="button" className="button button-secondary" disabled={busy || status.conflicts.length > 0} onClick={() => void sync()}>{busy ? '正在同步…' : pending ? '重試原筆同步' : '核對並同步'}</button>}
    {status.status === 'pending' && <details><summary>查看核對結果</summary>{status.differences.map((d, i) => <p key={`${d.symbol}_${i}`}>{d.symbol}：平台合計 {d.expectedQuantity} · 資產 {d.assetQuantity ?? '未建立'} · {d.reason}</p>)}{status.conflicts.map(c => <p key={c}>{c}</p>)}</details>}
    {error && <p className="cm-alert-error" role="alert">{error}</p>}
  </div>;
}
