import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { callPortfolioFunction, PortfolioFunctionHttpError } from '../../lib/api/vercelFunctions';
import { stakingRewardQuantity } from '../../lib/cryptoClassification';
import { planCryptoMovement, cryptoMovementDefaultNote } from '../../lib/cryptoMovements';
import type { CryptoManagementResponse, CryptoManagementState, CryptoMovementInput, CryptoPosition } from '../../types/cryptoManagement';

const number = (n: number) => new Intl.NumberFormat('zh-HK', { maximumFractionDigits: 18 }).format(n);
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Hong_Kong', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
type Props = { state: CryptoManagementState; parent: CryptoPosition; initialAction: 'increase' | 'release'; onUpdated: (data: CryptoManagementResponse) => void; onClose: () => void };
export function CryptoStakingRewardsDialog({ state, parent, initialAction, onUpdated, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const submitting = useRef(false);
  const request = useRef<Record<string, unknown> | null>(null);
  const [action, setAction] = useState(initialAction);
  const [quantity, setQuantity] = useState('');
  const [date, setDate] = useState(today);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const earnings = stakingRewardQuantity(state, parent.id);
  useEffect(() => { dialog.current?.showModal(); }, []);
  const movement = useMemo<CryptoMovementInput>(() => {
    const input: CryptoMovementInput = { type: action === 'increase' ? 'staking_reward' : 'staking_reward_release', sourcePositionId: parent.id, stakingPositionId: parent.id, symbol: parent.symbol, date, quantity: Number(quantity), note };
    return { ...input, note: note.trim() || cryptoMovementDefaultNote(input, state) };
  }, [action, parent.id, parent.symbol, date, quantity, note, state]);
  const preview = useMemo(() => {
    try { return { result: planCryptoMovement(state, movement, 'preview_reward_position', today()), error: '' }; }
    catch (e) { return { result: null, error: e instanceof Error ? e.message : '請填寫有效數量。' }; }
  }, [state, movement]);
  async function close() {
    if (submitting.current) return;
    if (!request.current) { onClose(); return; }
    submitting.current = true; setBusy(true); setError('');
    try { onUpdated(await callPortfolioFunction('crypto-management', { action: 'read' }) as CryptoManagementResponse); onClose(); }
    catch { setError('未能核對儲存結果，請重試原筆記錄，或再次取消以核對持倉。'); }
    finally { submitting.current = false; setBusy(false); }
  }
  async function submit(e: FormEvent) {
    e.preventDefault(); if (submitting.current || (!request.current && !preview.result)) return;
    submitting.current = true; setBusy(true); setError('');
    try {
      request.current ??= { action: 'record-movement', expectedVersion: state.version, operationId: crypto.randomUUID(), movement };
      setPending(true);
      const result = await callPortfolioFunction('crypto-management', request.current) as CryptoManagementResponse;
      request.current = null; onUpdated(result); onClose();
    } catch (e) {
      if (e instanceof PortfolioFunctionHttpError && e.status >= 400 && e.status < 500 && e.status !== 429) {
        request.current = null; setPending(false);
        if (e.status === 409) {
          try { onUpdated(await callPortfolioFunction('crypto-management', { action: 'read' }) as CryptoManagementResponse); } catch { /* The user can still refresh after a failed read. */ }
        }
        setError(e.message.split(/（(?:POST|GET) /)[0] + ' 請核對數量後再儲存。');
      } else setError('暫時未能確認儲存結果。請重試原筆記錄，系統會避免重複入帳。');
    } finally { submitting.current = false; setBusy(false); }
  }
  return <dialog ref={dialog} className="cm-dialog cm-staking-reward-dialog" aria-labelledby="cm-reward-title" onCancel={e => { e.preventDefault(); void close(); }}>
    <form onSubmit={e => void submit(e)}>
      <header><h2 id="cm-reward-title">{action === 'increase' ? '新增質押收益' : '解除質押收益'}</h2><button type="button" aria-label="關閉收益操作" disabled={busy} onClick={() => void close()}>×</button></header>
      <p className="cm-reward-context"><strong>{parent.custodian} · {parent.symbol}</strong><span>{parent.network || '沿用原質押持倉'}</span></p>
      <div className="cm-reward-balances"><div><span>質押本金</span><strong>{number(parent.quantity)} {parent.symbol}</strong></div><div><span>質押所賺 · 尚未解除</span><strong>{number(earnings)} {parent.symbol}</strong></div></div>
      <fieldset disabled={busy || pending} className="cm-add-fields">
        <div className="cm-add-modes" role="group" aria-label="收益操作"><button type="button" className={action === 'increase' ? 'active' : ''} onClick={() => { setAction('increase'); setQuantity(''); setError(''); }}>新增收益</button><button type="button" disabled={earnings <= 0} className={action === 'release' ? 'active' : ''} onClick={() => { setAction('release'); setQuantity(''); setError(''); }}>解除收益</button></div>
        <p className="cm-caption">{action === 'increase' ? '只增加這項質押持倉的收益，本金保持不變。' : `收益會轉回 ${parent.custodian} 的可用資產，本金保持不變。`}</p>
        <div className="cm-form-grid"><label>{action === 'increase' ? '新增收益數量' : '解除收益數量'}<input required type="number" step="any" min="0" value={quantity} onChange={e => setQuantity(e.target.value)} /></label><label>發生日期<input required type="date" max={today()} value={date} onChange={e => setDate(e.target.value)} /></label></div>
        <label className="cm-reason">備註（選填）<textarea maxLength={300} value={note} onChange={e => setNote(e.target.value)} placeholder="留空亦會自動記錄操作內容。" /></label>
      </fieldset>
      {preview.result && <div className="cm-movement-preview" aria-label="收益變動預覽"><strong>儲存後的數量</strong>{preview.result.legs.map(leg => <p key={leg.positionId}>{leg.status}：{number(leg.before)} {leg.delta > 0 ? '+' : '−'} {number(Math.abs(leg.delta))} → <strong>{number(leg.after)} {leg.symbol}</strong></p>)}</div>}
      {!preview.result && !pending && <p className="cm-caption" role="status">{quantity ? preview.error : '請填寫本次新增或解除的收益數量（大於 0）。'}</p>}
      {error && <p className="cm-alert cm-alert-error" role="alert">{error}</p>}
      <footer><button type="button" className="button button-secondary" disabled={busy} onClick={() => void close()}>取消</button><button className="button button-primary" disabled={busy || (!pending && !preview.result)}>{busy ? '正在儲存…' : pending ? '重試原筆記錄' : '確認並記錄'}</button></footer>
    </form>
  </dialog>;
}
