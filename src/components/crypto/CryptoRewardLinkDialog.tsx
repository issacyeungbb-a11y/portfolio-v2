import { useEffect, useRef, useState, type FormEvent } from 'react';
import { callPortfolioFunction, PortfolioFunctionHttpError } from '../../lib/api/vercelFunctions';
import { cryptoAssetStatus, linkStakingReward } from '../../lib/cryptoClassification';
import type { CryptoManagementResponse, CryptoManagementState, CryptoPosition } from '../../types/cryptoManagement';

type Props = { state: CryptoManagementState; reward: CryptoPosition; onUpdated: (data: CryptoManagementResponse) => void; onClose: () => void };
export function CryptoRewardLinkDialog({ state, reward, onUpdated, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const submitting = useRef(false);
  const request = useRef<Record<string, unknown> | null>(null);
  const [parentId, setParentId] = useState('');
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const parents = state.positions.filter(p => cryptoAssetStatus(p.status) === '鎖定(質押)' && p.custodian === reward.custodian && p.symbol === reward.symbol);
  useEffect(() => { dialog.current?.showModal(); }, []);
  async function close() {
    if (submitting.current) return;
    if (!request.current) { onClose(); return; }
    submitting.current = true; setBusy(true);
    try { onUpdated(await callPortfolioFunction('crypto-management', { action: 'read' }) as CryptoManagementResponse); onClose(); }
    catch { setError('未能核對儲存結果，請重試原筆關聯。'); }
    finally { submitting.current = false; setBusy(false); }
  }
  async function submit(e: FormEvent) {
    e.preventDefault(); if (submitting.current) return;
    submitting.current = true; setBusy(true); setError('');
    try {
      request.current ??= { action: 'save', state: linkStakingReward(state, reward.id, parentId), expectedVersion: state.version, operationId: crypto.randomUUID(), stakingRewardLink: { positionId: reward.id, parentId }, reason: `關聯 ${reward.custodian} ${reward.symbol} 質押收益至本金 ${parents.find(p => p.id === parentId)?.quantity} ${reward.symbol}；數量保持不變` };
      setPending(true);
      onUpdated(await callPortfolioFunction('crypto-management', request.current) as CryptoManagementResponse); request.current = null; onClose();
    } catch (e) {
      if (e instanceof PortfolioFunctionHttpError && e.status < 500 && e.status !== 429) { request.current = null; setPending(false); if (e.status === 409) { try { onUpdated(await callPortfolioFunction('crypto-management', { action: 'read' }) as CryptoManagementResponse); } catch { /* Preserve the selected relationship for retry. */ } } }
      setError(e instanceof Error ? e.message.split(/（(?:POST|GET) /)[0] : '未能儲存關聯，請重試。');
    } finally { submitting.current = false; setBusy(false); }
  }
  return <dialog ref={dialog} className="cm-dialog" aria-labelledby="cm-link-title" onCancel={e => { e.preventDefault(); void close(); }}><form onSubmit={e => void submit(e)}>
    <header><h2 id="cm-link-title">關聯既有質押收益</h2></header>
    <p>{reward.custodian} · {reward.symbol} · {reward.quantity}。只整理收益所屬持倉，數量保持不變。</p>
    <fieldset disabled={busy || pending} className="cm-add-fields"><label>對應質押持倉<select required value={parentId} onChange={e => setParentId(e.target.value)}><option value="">選擇對應持倉</option>{parents.map((p, i) => <option key={p.id} value={p.id}>{p.symbol} · {p.network || '未指定網絡'} · 本金 {p.quantity} · 持倉 {i + 1}</option>)}</select></label></fieldset>
    {!parents.length && <p className="cm-caption">未有同平台、同幣種的質押持倉，請先建立質押持倉。</p>}
    {error && <p role="alert">{error}</p>}
    <footer><button type="button" className="button button-secondary" disabled={busy} onClick={() => void close()}>取消</button><button className="button button-primary" disabled={busy || (!pending && !parentId)}>{pending ? '重試原筆關聯' : '確認關聯'}</button></footer>
  </form></dialog>;
}
