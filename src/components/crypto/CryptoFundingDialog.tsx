import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { callPortfolioFunction, PortfolioFunctionHttpError } from '../../lib/api/vercelFunctions';
import { cryptoAssetStatus } from '../../lib/cryptoClassification';
import { cryptoPlatforms } from '../../lib/cryptoPlatforms';
import { cryptoFundingToday, planCryptoFundingChanges } from '../../lib/cryptoFunding';
import { positionLabel } from '../../lib/cryptoMovements';
import type { CryptoFunding, CryptoManagementResponse, CryptoManagementState } from '../../types/cryptoManagement';

type Props = {
  state: CryptoManagementState;
  row?: CryptoFunding;
  usdHkd: number | null;
  onUpdated: (response: CryptoManagementResponse) => void;
  onClose: (saved?: boolean) => void;
};
const number = (n: number) => new Intl.NumberFormat('zh-HK', { maximumFractionDigits: 18 }).format(n);

export function CryptoFundingDialog({ state, row, usdHkd, onUpdated, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [id] = useState(() => row?.id ?? crypto.randomUUID());
  const [date, setDate] = useState(row?.date ?? cryptoFundingToday());
  const [type, setType] = useState<CryptoFunding['type']>(row?.type ?? 'deposit');
  const [source, setSource] = useState(row?.source ?? '');
  const [hkd, setHkd] = useState(row ? String(row.hkd) : '');
  const [usd, setUsd] = useState(row ? String(row.usd) : '');
  const [positionId, setPositionId] = useState(row?.positionId ?? '');
  const [quantity, setQuantity] = useState(row?.quantity === undefined ? '' : String(row.quantity));
  const [custodian, setCustodian] = useState('');
  const [symbol, setSymbol] = useState(state.coins.find(c => ['USDT', 'USDC'].includes(c.symbol))?.symbol ?? state.coins[0]?.symbol ?? '');
  const [network, setNetwork] = useState('');
  const [reason, setReason] = useState('');
  const [remove, setRemove] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const submitting = useRef(false);
  const request = useRef<Record<string, unknown> | null>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);

  const positions = state.positions.filter(p => cryptoAssetStatus(p.status) === '可用');
  const target = state.positions.find(p => p.id === positionId);
  const nextState = useMemo(() => {
    const next = structuredClone(state);
    const funding: CryptoFunding = {
      id, date, type, source: source.trim(), hkd: Number(hkd), usd: Number(usd),
      ...(type !== 'adjustment' && positionId ? {
        quantity: Number(quantity),
        ...(positionId === '__new__' ? { destination: { custodian: custodian.trim(), symbol, network: network.trim() } } : { positionId }),
      } : {}),
    };
    next.funding = remove ? next.funding.filter(r => r.id !== id) : next.funding.some(r => r.id === id) ? next.funding.map(r => r.id === id ? funding : r) : [...next.funding, funding];
    return next;
  }, [state, id, date, type, source, hkd, usd, positionId, quantity, custodian, symbol, network, remove]);
  const preview = useMemo(() => {
    try { return { plan: planCryptoFundingChanges(state, nextState, reason), error: '' }; }
    catch (e) { return { plan: null, error: e instanceof Error ? e.message : '請核對資金資料。' }; }
  }, [state, nextState, reason]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (submitting.current) return;
    submitting.current = true; setBusy(true); setError('');
    try {
      if (!request.current && !preview.plan) throw new Error(preview.error);
      const payload = request.current ?? { action: 'save', operationId: crypto.randomUUID(), expectedVersion: state.version, reason: reason.trim(), state: nextState };
      request.current = payload; setPending(true);
      try {
        onUpdated(await callPortfolioFunction('crypto-management', payload) as CryptoManagementResponse);
      } catch (e) {
        if (e instanceof PortfolioFunctionHttpError && e.status >= 400 && e.status < 500 && e.status !== 429) {
          request.current = null; setPending(false);
          if (e.status === 409) onUpdated(await callPortfolioFunction('crypto-management', { action: 'read' }) as CryptoManagementResponse);
        }
        throw e;
      }
      request.current = null; setPending(false); onClose(true);
    } catch (e) { setError(e instanceof Error ? e.message : '儲存失敗'); }
    finally { submitting.current = false; setBusy(false); }
  }
  async function close() {
    if (busy) return;
    if (request.current) {
      setBusy(true); setError('');
      try { onUpdated(await callPortfolioFunction('crypto-management', { action: 'read' }) as CryptoManagementResponse); }
      catch (e) { setError(e instanceof Error ? e.message : '未能核對儲存結果'); setBusy(false); return; }
    }
    onClose();
  }
  const legacy = !!row && !row.positionId;
  const unit = positionId === '__new__' ? symbol : target?.symbol ?? '';
  return <dialog ref={dialog} className="cm-dialog" aria-labelledby="cm-funding-title" onCancel={e => { e.preventDefault(); void close(); }}>
    <form onSubmit={e => void submit(e)}>
      <header><h2 id="cm-funding-title">{remove ? '移除資金紀錄' : row ? '修改資金紀錄' : '新增資金紀錄'}</h2><button type="button" aria-label="關閉" disabled={busy} onClick={() => void close()}>×</button></header>
      {!remove && <fieldset disabled={busy || pending} aria-label="資金資料" className="cm-form-grid cm-funding-fields">
        <label>日期<input required type="date" max={cryptoFundingToday()} value={date} onChange={e => setDate(e.target.value)} /></label>
        <label>類型<select value={type} onChange={e => { setType(e.target.value as CryptoFunding['type']); if (positionId === '__new__' && e.target.value === 'withdrawal') setPositionId(''); }}><option value="deposit">入金</option><option value="withdrawal">提取／消費</option><option value="adjustment">本金調整</option></select></label>
        <label className="cm-full-width">資金來源／說明<input required maxLength={160} value={source} onChange={e => setSource(e.target.value)} /></label>
        <label>港元金額<input required type="number" step="any" min={type === 'adjustment' ? undefined : '0'} value={hkd} onChange={e => setHkd(e.target.value)} /></label>
        <label>美元金額<input required type="number" step="any" min={type === 'adjustment' ? undefined : '0'} value={usd} onChange={e => setUsd(e.target.value)} />{usdHkd && <button type="button" className="button button-secondary" disabled={!hkd || !Number.isFinite(Number(hkd))} onClick={() => setUsd(String(Math.round(Number(hkd) / usdHkd * 100) / 100))}>按匯率換算（1 USD = {number(usdHkd)} HKD）</button>}</label>
        {type !== 'adjustment' ? <>
          <label className="cm-full-width">{type === 'deposit' ? '資金去向（平台／錢包持倉）' : '提取來源（平台／錢包持倉）'}<select required={!legacy} value={positionId} onChange={e => setPositionId(e.target.value)}>
            <option value="">{legacy ? '舊紀錄：只更新說明，不變動持倉' : '請選擇資金位置'}</option>
            {positions.map(p => <option key={p.id} value={p.id}>{positionLabel(p)} · 現有 {number(p.quantity)}</option>)}
            {type === 'deposit' && <option value="__new__">新增平台／錢包的可用持倉</option>}
          </select></label>
          {positionId === '__new__' && <>
            <label>到帳平台／錢包<input required list="cm-funding-platforms" maxLength={160} value={custodian} onChange={e => setCustodian(e.target.value)} /><datalist id="cm-funding-platforms">{cryptoPlatforms(state).map(p => <option key={p} value={p} />)}</datalist></label>
            <label>到帳幣種<select required value={symbol} onChange={e => setSymbol(e.target.value)}>{state.coins.map(c => <option key={c.symbol} value={c.symbol}>{c.symbol} · {c.name}</option>)}</select></label>
            <label>網絡（選填）<input maxLength={160} value={network} onChange={e => setNetwork(e.target.value)} /></label>
          </>}
          {!!positionId && <label>實際{type === 'deposit' ? '到帳' : '提取'}幣數{unit ? `（${unit}）` : ''}<input required type="number" min="0" step="any" value={quantity} onChange={e => setQuantity(e.target.value)} /></label>}
          <p className="cm-caption cm-full-width">港元／美元金額用作本金及現金流紀錄；持倉按實際幣數加減。幣數可以與美元金額不同，請填寫扣除兌換及轉帳費後的實際數量。同一筆資金儲存後，毋須再記錄一次外部轉入／轉出。</p>
          {legacy && positionId && <p className="cm-alert cm-full-width">這是尚未連結持倉的舊紀錄。選擇位置後，會額外計入本次填寫的全部幣數；請確認尚未計入現有持倉，以免重複入帳。</p>}
        </> : <p className="cm-caption cm-full-width">本金調整只更正本金，不新增資產。實際資金到帳或提取請選擇「入金」或「提取／消費」。</p>}
      </fieldset>}
      {remove && <p className="cm-alert">移除後會撤回這筆資金對持倉的影響，並保留更正往來。若原有入金已被使用，請先處理相關持倉。舊有未連結紀錄只會移除資金記帳。</p>}
      <label className="cm-reason">{remove ? '移除原因' : '記錄／修改原因'}<textarea required minLength={2} maxLength={300} disabled={busy || pending} value={reason} onChange={e => setReason(e.target.value)} /></label>
      {preview.plan && <div className="cm-movement-preview" aria-label="資金持倉變動預覽"><strong>儲存後的持倉變動</strong>{preview.plan.entries.length ? preview.plan.entries.flatMap(entry => entry.legs).map(leg => <p key={leg.positionId}>{leg.custodian} · {leg.symbol} · {leg.status}：{number(leg.before)} {leg.delta > 0 ? '+' : '−'} {number(Math.abs(leg.delta))} → <strong>{number(leg.after)}</strong></p>) : <p>這次只更新資金記帳，持倉數量保持原值。</p>}</div>}
      {!preview.plan && <p className="cm-caption" role="status">{preview.error}</p>}
      {pending && !busy && <p className="cm-alert">儲存結果尚待核對。重試會使用原有操作，避免重複入帳。</p>}
      {error && <p className="cm-alert cm-alert-error" role="alert">{error}</p>}
      <footer>{row && !remove && <button type="button" className="button cm-danger" disabled={busy || pending} onClick={() => setRemove(true)}>移除紀錄</button>}{remove && <button type="button" className="button button-secondary" disabled={busy || pending} onClick={() => setRemove(false)}>返回修改</button>}<button type="button" className="button button-secondary" disabled={busy} onClick={() => void close()}>{pending ? '重新核對並關閉' : '取消'}</button><button className="button button-primary" disabled={busy || (!pending && !preview.plan)}>{busy ? '正在儲存…' : pending ? '重試原筆資金' : remove ? '確認移除並同步' : '儲存並同步持倉'}</button></footer>
    </form>
  </dialog>;
}
