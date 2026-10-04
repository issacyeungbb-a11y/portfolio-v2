import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { callPortfolioFunction, PortfolioFunctionHttpError } from '../lib/api/vercelFunctions';
import { cryptoPlatforms } from '../lib/cryptoPlatforms';
import { cryptoMovementLabels, destinationRequired, isStakedPosition, planCryptoMovement, positionLabel, sourceRequired, cryptoMovementSources, cryptoMovementDestinationStatuses, cryptoMovementDefaultDestination, cryptoMovementDefaultNote } from '../lib/cryptoMovements';
import { cryptoAssetStatus, isCollateralPosition, isSpendablePosition, normalizeCryptoPlatform } from '../lib/cryptoClassification';
import type { CryptoAssetStatus, CryptoManagementResponse, CryptoManagementState, CryptoMovementHistory, CryptoMovementInput, CryptoMovementType } from '../types/cryptoManagement';
import { CryptoMovementActions, cryptoMovementHelp } from '../components/crypto/CryptoMovementActions';
import '../components/crypto/cryptoManagement.css';

const number = (n: number) => new Intl.NumberFormat('zh-HK', { maximumFractionDigits: 18 }).format(n);
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Hong_Kong', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const api = (payload: unknown) => callPortfolioFunction('crypto-management', payload);
type Draft = { type: CryptoMovementType; date: string; symbol: string; quantity: string; sourcePositionId: string; destinationPositionId: string; custodian: string; status: CryptoAssetStatus; network: string; counterparty: string; unitPrice: string; fees: string; settlementPositionId: string; note: string };
const emptyDraft = (): Draft => ({ type: 'buy', date: today(), symbol: '', quantity: '', sourcePositionId: '', destinationPositionId: '', custodian: '', status: '可用', network: '', counterparty: '', unitPrice: '', fees: '0', settlementPositionId: '', note: '' });
const emptyHistory: CryptoMovementHistory = { entries: [], nextCursor: null, opening: null };

export function CryptoMovementsPage({ embedded = false, onUpdated }: { embedded?: boolean; onUpdated?: (data: CryptoManagementResponse) => void } = {}) {
  const [params] = useSearchParams();
  const contextKey = params.toString();
  const [data, setData] = useState<CryptoManagementResponse | null>(null);
  const [history, setHistory] = useState<CryptoMovementHistory>(emptyHistory);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(false);
  const submitting = useRef(false);
  const pendingRequest = useRef<Record<string, unknown> | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [coinFilter, setCoinFilter] = useState(params.get('symbol') ?? '');
  const [platformFilter, setPlatformFilter] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const state = data?.state;
  const positionFilter = params.get('position') ?? '';
  const needsSource = sourceRequired(draft.type);
  const needsDestination = destinationRequired(draft.type);
  const trade = draft.type === 'buy' || draft.type === 'sell';
  const sources = state ? cryptoMovementSources(state, draft.type, draft.symbol) : [];
  const source = state?.positions.find(p => p.id === draft.sourcePositionId);
  const allowedStatuses = cryptoMovementDestinationStatuses(draft.type, source);
  const destinations = state?.positions.filter(p => p.symbol === draft.symbol && (!needsSource || draft.type === 'staking_reward' || p.id !== draft.sourcePositionId)
    && allowedStatuses.includes(cryptoAssetStatus(p.status))) ?? [];
  const settlementOptions = state?.positions.filter(p => p.symbol !== draft.symbol && isSpendablePosition(p)) ?? [];
  const quoteCurrency = state?.positions.find(p => p.id === draft.settlementPositionId)?.symbol ?? 'USD';
  const newStatus = allowedStatuses.includes(draft.status) ? draft.status : allowedStatuses[0];
  const input = useMemo<CryptoMovementInput>(() => { const movement: CryptoMovementInput = { type: draft.type, date: draft.date, symbol: draft.symbol, quantity: Number(draft.quantity), note: draft.note,
    ...(needsSource ? { sourcePositionId: draft.sourcePositionId } : {}),
    ...(needsDestination ? draft.destinationPositionId ? { destinationPositionId: draft.destinationPositionId } : { destination: { custodian: draft.custodian, status: newStatus, network: draft.network } } : {}),
    ...(['transfer_in', 'transfer_out'].includes(draft.type) ? { counterparty: draft.counterparty } : {}),
    ...(trade ? { unitPrice: Number(draft.unitPrice), fees: draft.fees === '' ? 0 : Number(draft.fees), quoteCurrency, ...(draft.settlementPositionId ? { settlementPositionId: draft.settlementPositionId } : {}) } : {}),
  }; return { ...movement, note: draft.note.trim() || (state ? cryptoMovementDefaultNote(movement, state) : '') }; }, [draft, needsSource, needsDestination, newStatus, trade, quoteCurrency, state]);
  const preview = useMemo(() => {
    if (!state || !editing) return { result: null, error: '' };
    try { return { result: planCryptoMovement(state, input, 'preview_new_position', today()), error: '' }; }
    catch (e) { return { result: null, error: e instanceof Error ? e.message : '請填寫完整往來資料。' }; }
  }, [state, input, editing]);

  function start(nextState: CryptoManagementState, useContext = true) {
    const row = useContext ? nextState.positions.find(p => p.id === positionFilter) : undefined;
    const symbol = row?.symbol ?? (useContext ? params.get('symbol') : null) ?? nextState.coins[0]?.symbol ?? '';
    const type = row ? isStakedPosition(row) ? 'staking_reward' : isCollateralPosition(row) ? 'collateral_unlock' : 'transfer' : 'buy';
    const firstSource = cryptoMovementSources(nextState, type, symbol)[0];
    setDraft({ ...emptyDraft(), type, symbol, sourcePositionId: row?.id ?? firstSource?.id ?? '', ...cryptoMovementDefaultDestination(nextState, type, symbol, row ?? firstSource) });
    setError(''); setMessage(''); setEditing(true);
  }
  async function refresh() {
    const [management, records] = await Promise.all([api({ action: 'read' }), api({ action: 'read-movements' })]);
    setData(management as CryptoManagementResponse); onUpdated?.(management as CryptoManagementResponse); setHistory(records as CryptoMovementHistory);
    return management as CryptoManagementResponse;
  }
  useEffect(() => {
    let active = true;
    Promise.all([api({ action: 'read' }), api({ action: 'read-movements' })]).then(([management, records]) => {
      if (!active) return;
      const result = management as CryptoManagementResponse;
      setData(result); setHistory(records as CryptoMovementHistory);
      if (result.state && (params.has('position') || params.has('symbol') || params.has('custodian'))) start(result.state);
    }).catch(e => { if (active) setError(e instanceof Error ? e.message : '讀取失敗'); });
    return () => { active = false; };
  }, [contextKey]);
  async function operate(task: () => Promise<void>) {
    if (submitting.current) return; submitting.current = true; setBusy(true); setError('');
    try { await task(); } catch (e) { setError(e instanceof Error ? e.message : '操作失敗'); } finally { submitting.current = false; setBusy(false); }
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    await operate(async () => {
      if (!state) return;
      if (!pendingRequest.current && !preview.result) throw new Error(preview.error);
      const payload = pendingRequest.current ?? { action: 'record-movement', expectedVersion: state.version, operationId: crypto.randomUUID(), movement: input };
      pendingRequest.current = payload; setPending(true);
      let result: CryptoManagementResponse;
      try { result = await api(payload) as CryptoManagementResponse; }
      catch (e) {
        if (e instanceof PortfolioFunctionHttpError && e.status >= 400 && e.status < 500 && e.status !== 429) {
          pendingRequest.current = null; setPending(false);
          if (e.status === 409) {
            try { await refresh(); } catch { /* Keep the draft for the user to review and refresh. */ }
          }
          throw new Error(e.message.split(/（(?:POST|GET) /)[0] + (e.status === 409 ? ' 已保留輸入資料，請核對最新數量後再儲存。' : ' 請修改資料後再儲存。'));
        }
        throw e;
      }
      setData(result); onUpdated?.(result); pendingRequest.current = null; setPending(false); setEditing(false);
      setMessage('往來已儲存，持倉數量及資產頁已同步。');
      try { setHistory(await api({ action: 'read-movements' }) as CryptoMovementHistory); }
      catch { setError('往來已儲存；歷史紀錄暫時未能讀取，請重新整理。'); }
    });
  }
  function changeOperation(type: CryptoMovementType, symbol = draft.symbol, sourceId = draft.sourcePositionId, resetQuantity = true) {
    if (!state) return;
    const eligible = cryptoMovementSources(state, type, symbol);
    const nextSource = eligible.find(p => p.id === sourceId) ?? eligible[0];
    setDraft(d => ({ ...d, type, symbol, sourcePositionId: nextSource?.id ?? '',
      ...cryptoMovementDefaultDestination(state, type, symbol, nextSource),
      ...(resetQuantity ? { quantity: '', unitPrice: '', fees: '0', settlementPositionId: '', counterparty: '' } : {}),
    }));
    setError(''); setMessage('');
  }
  const update = (key: keyof Draft, value: string) => setDraft(current => ({ ...current, [key]: value }));
  const missingFields: string[] = [];
  if (!draft.date) missingFields.push('日期');
  if (!draft.symbol) missingFields.push('幣種');
  if (!draft.quantity || !Number.isFinite(Number(draft.quantity)) || Number(draft.quantity) <= 0) missingFields.push('往來數量（大於 0）');
  if (needsSource && !draft.sourcePositionId) missingFields.push(draft.type === 'staking_reward' ? '質押來源' : '來源持倉');
  if (needsDestination && !draft.destinationPositionId && !draft.custodian.trim()) missingFields.push('目的地平台');
  if (['transfer_in', 'transfer_out'].includes(draft.type) && !draft.counterparty.trim()) missingFields.push(draft.type === 'transfer_in' ? '外部來源' : '外部目的地');
  if (trade && (!draft.unitPrice || Number(draft.unitPrice) <= 0)) missingFields.push('成交單價（大於 0）');
  const validationMessage = missingFields.length ? `請填寫：${missingFields.join('、')}。` : preview.error;
  const filtered = history.entries.filter(entry => (!typeFilter || entry.type === typeFilter) && (!coinFilter || entry.symbol === coinFilter || entry.legs.some(l => l.symbol === coinFilter))
    && (!platformFilter || normalizeCryptoPlatform(entry.sourceCustodian) === platformFilter || normalizeCryptoPlatform(entry.destinationCustodian) === platformFilter || entry.legs.some(l => normalizeCryptoPlatform(l.custodian) === platformFilter)) && (!from || entry.date >= from) && (!to || entry.date <= to)
    && (!positionFilter || entry.sourcePositionId === positionFilter || entry.destinationPositionId === positionFilter || entry.legs.some(l => l.positionId === positionFilter)));
  const historyPlatforms = [...new Set(history.entries.flatMap(entry => [entry.sourceCustodian, entry.destinationCustodian, ...entry.legs.map(l => l.custodian)].filter(Boolean).map(normalizeCryptoPlatform)))].sort((a, b) => a.localeCompare(b, 'zh-HK'));
  function exportRecords() {
    const blob = new Blob([JSON.stringify({ opening: history.opening, entries: filtered }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `crypto-movements-${today()}.json`; link.click(); URL.revokeObjectURL(url);
  }
  return <div className="page-stack cm-page cm-movements-page">
    <section className="card cm-heading"><div><h2>{embedded ? '往來管理' : 'Crypto 變動'}</h2><p>逐筆記錄交易、轉移及質押往來，持倉隨記錄同步更新。</p></div><div className="cm-actions">{!embedded && <Link className="button button-secondary" to="/crypto-history">持倉管理</Link>}<button className="button button-secondary" disabled={busy || pending} onClick={() => void operate(async () => { await refresh(); })}>重新整理</button><button className="button button-primary" disabled={busy || pending || !state?.coins.length} onClick={() => state && start(state)}>記錄往來</button></div></section>
    {error && <p className="cm-alert cm-alert-error" role="alert">{error}</p>}{message && <p className="cm-alert" role="status">{message}</p>}
    {!data && !error && <section className="card" aria-busy="true">正在讀取 Crypto 往來…</section>}
    {data && !state && <section className="card">請先在<Link to="/crypto-history">持倉管理</Link>完成資料遷移。</section>}
    {editing && state && <section className="card cm-movement-editor"><form onSubmit={e => void submit(e)}><div className="section-heading"><h2>記錄一筆往來</h2><p className="cm-caption">先選操作，再填本次數量；系統會同步更新持倉並保留往來。</p></div>
      <fieldset disabled={busy || pending} className="cm-operation-fieldset">
        <legend>1. 選擇資產操作</legend><CryptoMovementActions value={draft.type} onChange={type => changeOperation(type)} />
        <p className="cm-operation-help"><strong>{cryptoMovementLabels[draft.type]}</strong> · {cryptoMovementHelp[draft.type]}</p>
      </fieldset>
      <fieldset disabled={busy || pending} className="cm-form-grid">
        <legend>2. 填寫操作資料</legend>
        <p className="cm-caption cm-full-width">日期、幣種、數量及來源／目的地為必填；買賣另需成交單價。備註為選填。</p>
        <label>日期<input required type="date" max={today()} value={draft.date} onChange={e => update('date', e.target.value)} /></label>
        <label>幣種<select value={draft.symbol} onChange={e => changeOperation(draft.type, e.target.value, '')}>{state.coins.map(c => <option key={c.symbol} value={c.symbol}>{c.symbol} · {c.name}</option>)}</select></label>
        <label>往來數量<input required type="number" min="0" step="any" value={draft.quantity} onChange={e => update('quantity', e.target.value)} /></label>
        {needsSource && <label>{draft.type === 'staking_reward' ? '質押來源' : '來源持倉'}<select required aria-label={draft.type === 'staking_reward' ? '質押來源' : '來源持倉'} aria-describedby="cm-source-hint" value={draft.sourcePositionId} onChange={e => changeOperation(draft.type, draft.symbol, e.target.value, false)}><option value="">選擇來源持倉</option>{sources.map(p => <option key={p.id} value={p.id}>{positionLabel(p)} · {number(p.quantity)}</option>)}</select><span id="cm-source-hint" className="cm-field-hint">{source && <span>{draft.type === 'staking_reward' ? '質押本金' : '目前數量'}：{number(source.quantity)} {source.symbol}{draft.type !== 'staking_reward' ? '；輸入本次操作數量，並非新的總數。' : '；收益只會增加去向持倉。'}</span>}{!sources.length && <span className="cm-field-hint cm-negative">此幣種沒有符合操作的來源持倉，請選其他幣種或操作。</span>}</span></label>}
        {needsDestination && <label>{draft.type === 'staking_reward' ? '收益去向' : '目的地持倉'}<select value={draft.destinationPositionId} onChange={e => update('destinationPositionId', e.target.value)}><option value="">新增目的地持倉</option>{destinations.map(p => <option key={p.id} value={p.id}>{positionLabel(p)} · {number(p.quantity)}</option>)}</select></label>}
        {needsDestination && !draft.destinationPositionId && <><label>目的地平台<input required maxLength={160} list="cm-destination-platforms" value={draft.custodian} onChange={e => update('custodian', e.target.value)} /><datalist id="cm-destination-platforms">{cryptoPlatforms(state).map(p => <option key={p} value={p} />)}</datalist></label><label>目的地狀態<select value={newStatus} disabled={allowedStatuses.length === 1} onChange={e => update('status', e.target.value)}>{allowedStatuses.map(s => <option key={s} value={s}>{s}</option>)}</select></label><label>目的地網絡<input maxLength={160} value={draft.network} onChange={e => update('network', e.target.value)} /></label></>}
        {['transfer_in', 'transfer_out'].includes(draft.type) && <label>外部{draft.type === 'transfer_in' ? '來源' : '目的地'}<input required maxLength={160} value={draft.counterparty} onChange={e => update('counterparty', e.target.value)} placeholder="例如另一個未在本系統記錄的錢包" /></label>}
        {trade && <><label>{draft.type === 'buy' ? '付款方式' : '收款方式'}<select value={draft.settlementPositionId} onChange={e => update('settlementPositionId', e.target.value)}><option value="">外部法幣 USD</option>{settlementOptions.map(p => <option key={p.id} value={p.id}>{positionLabel(p)} · {number(p.quantity)}</option>)}</select></label><label>成交單價（{quoteCurrency}）<input required type="number" min="0" step="any" value={draft.unitPrice} onChange={e => update('unitPrice', e.target.value)} /></label><label>手續費（{quoteCurrency}）<input type="number" min="0" step="any" value={draft.fees} onChange={e => update('fees', e.target.value)} /></label></>}
        <label className="cm-full-width">備註（選填）<textarea maxLength={300} value={draft.note} onChange={e => update('note', e.target.value)} placeholder="可補充交易資訊；留空亦會自動記錄操作類型、平台及數量。" /></label>
      </fieldset>
      {trade && !draft.settlementPositionId && <p className="cm-caption">外部法幣只記錄成交金額；累計入金仍在「資金紀錄」管理。若使用 USDT 等持倉成交，請選擇該結算持倉，系統會同步加減。</p>}
      {preview.result && <div className="cm-movement-preview" aria-label="往來數量預覽"><strong>3. 確認本次變動</strong><p className="cm-caption">{cryptoMovementLabels[draft.type]} {number(input.quantity)} {draft.symbol} · {draft.date}</p>{preview.result.legs.map(leg => <p key={leg.positionId}>{leg.custodian} · {leg.symbol} · {leg.status}：{number(leg.before)} <span className={leg.delta > 0 ? 'cm-positive' : 'cm-negative'}>{leg.delta > 0 ? '+' : '−'}{number(Math.abs(leg.delta))}</span> → <strong>{number(leg.after)}</strong></p>)}{preview.result.totalAmount !== null && <p>{draft.type === 'buy' ? '支付' : '收取'} {number(preview.result.totalAmount)} {quoteCurrency}（已含手續費）</p>}</div>}
      {!preview.result && !pending && <p id="cm-movement-validation" className="cm-validation-message" role="status" aria-live="polite">{validationMessage}</p>}
      {pending && !busy && <p className="cm-alert">儲存結果尚待核對。可以重試同一筆往來，或重新讀取持倉後取消；重試會避免重複入帳。</p>}
      <div className="cm-actions cm-editor-actions"><button type="button" className="button button-secondary" disabled={busy} onClick={() => void operate(async () => { if (pendingRequest.current) await refresh(); pendingRequest.current = null; setPending(false); setEditing(false); })}>取消</button><button className="button button-primary" aria-describedby={!preview.result && !pending ? 'cm-movement-validation' : undefined} disabled={busy || (!pending && !preview.result)}>{busy ? '正在儲存…' : pending ? '重試原筆往來' : '確認記錄並更新持倉'}</button></div>
    </form></section>}
    {state && <section className="card"><div className="section-heading"><div><h2>往來紀錄</h2><p className="cm-caption">已載入 {history.entries.length} 筆 · 篩選顯示 {filtered.length} 筆 · 按記錄時間排序</p></div><button className="button button-secondary" disabled={busy || !filtered.length} onClick={exportRecords}>匯出紀錄</button></div>
      {positionFilter && <p className="cm-caption">目前顯示此筆持倉的往來 · <Link to="/crypto-history?tab=movements">查看所有持倉</Link></p>}
      <div className="cm-movement-filters"><label>類型<select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}><option value="">全部類型</option>{Object.entries(cryptoMovementLabels).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label><label>幣種<select value={coinFilter} onChange={e => setCoinFilter(e.target.value)}><option value="">全部幣種</option>{state.coins.map(c => <option key={c.symbol} value={c.symbol}>{c.symbol}</option>)}</select></label><label>平台<select value={platformFilter} onChange={e => setPlatformFilter(e.target.value)}><option value="">全部平台</option>{historyPlatforms.map(p => <option key={p} value={p}>{p}</option>)}</select></label><label>由<input type="date" value={from} onChange={e => setFrom(e.target.value)} /></label><label>至<input type="date" value={to} onChange={e => setTo(e.target.value)} /></label></div>
      <div className="cm-table-scroll"><table className="cm-table cm-movement-table"><thead><tr><th>日期</th><th>往來</th><th>幣種／數量</th><th>來源 → 目的地</th><th>明細</th></tr></thead><tbody>{filtered.map(entry => <tr key={entry.id}><td>{entry.date}</td><td><span className="cm-tag">{cryptoMovementLabels[entry.type]}</span></td><th>{entry.symbol} · {number(entry.quantity)}</th><td>{entry.type === 'staking_reward' ? `質押來源：${entry.sourceLabel}` : entry.sourceLabel || entry.counterparty || '外部法幣'}<br /><span className="cm-caption">→ {entry.destinationLabel || entry.counterparty || '外部法幣'}</span></td><td><details><summary>查看往來</summary><div className="cm-movement-detail"><p>{entry.note}</p>{entry.legs.map(leg => <p key={leg.positionId}>{leg.custodian} · {leg.symbol} · {leg.status}：{number(leg.before)} <span className={leg.delta > 0 ? 'cm-positive' : 'cm-negative'}>{leg.delta > 0 ? '+' : '−'}{number(Math.abs(leg.delta))}</span> → {number(leg.after)}</p>)}{entry.totalAmount !== null && <p>成交單價 {number(entry.unitPrice ?? 0)} · 手續費 {number(entry.fees ?? 0)} · {entry.type === 'buy' ? '支付' : '收取'} {number(entry.totalAmount)} {entry.quoteCurrency}</p>}<p className="cm-caption">記錄時間：{new Intl.DateTimeFormat('zh-HK', { timeZone: 'Asia/Hong_Kong', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(entry.createdAt))} · 版本 {entry.version}</p></div></details></td></tr>)}</tbody></table></div>
      {!filtered.length && <p className="cm-caption">{history.entries.length ? '已載入紀錄中沒有相符往來。' : '由此開始逐筆記錄往來；既有持倉沿用，不補造舊交易。'}</p>}
      {history.nextCursor && <button className="button button-secondary" disabled={busy} onClick={() => void operate(async () => { const next = await api({ action: 'read-movements', cursor: history.nextCursor }) as CryptoMovementHistory; setHistory(current => ({ ...next, entries: [...current.entries, ...next.entries.filter(e => !current.entries.some(old => old.id === e.id))] })); })}>載入較早往來</button>}
      {history.opening && <details className="cm-opening"><summary>查看既有持倉起點</summary><p className="cm-caption">首筆往來前的持倉數量。以下為記錄起點，並非新增交易。</p><div className="cm-table-scroll"><table className="cm-table"><thead><tr><th>平台</th><th>幣種</th><th>狀態</th><th className="cm-numeric">起點數量</th></tr></thead><tbody>{history.opening.positions.map(p => <tr key={p.id}><td>{p.custodian}</td><th>{p.symbol}</th><td>{p.status}</td><td className="cm-numeric">{number(p.quantity)}</td></tr>)}</tbody></table></div></details>}
    </section>}
  </div>;
}
