import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { callPortfolioFunction } from '../../lib/api/vercelFunctions';
import { cryptoPlatforms, saveCryptoPlatform } from '../../lib/cryptoPlatforms';
import { isStakedPosition, planCryptoMovement, positionLabel, sourceRequired } from '../../lib/cryptoMovements';
import type { CryptoCoin, CryptoManagementResponse, CryptoManagementState, CryptoMovementInput, CryptoMovementType } from '../../types/cryptoManagement';

type Mode = 'asset' | 'platform' | 'coin';
type Status = '可用' | '質押';
type Props = {
  state: CryptoManagementState;
  initialMode?: Mode;
  platform?: string;
  symbol?: string;
  onUpdated: (data: CryptoManagementResponse, message?: string) => void;
  onClose: () => void;
};
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Hong_Kong', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const number = (n: number) => new Intl.NumberFormat('zh-HK', { maximumFractionDigits: 18 }).format(n);
const origins: Record<Status, Array<[CryptoMovementType, string]>> = {
  可用: [['transfer_in', '外部轉入'], ['buy', '買入'], ['transfer', '現有可用持倉轉移'], ['unstake', '解除質押轉入'], ['staking_reward', '質押收益轉入']],
  質押: [['stake', '由可用持倉投入質押'], ['transfer_in', '外部質押資產轉入'], ['transfer', '現有質押持倉轉移'], ['staking_reward', '增加質押收益']],
};
function sourcesFor(state: CryptoManagementState, symbol: string, type: CryptoMovementType, status: Status) {
  return state.positions.filter(p => p.symbol === symbol && (p.quantity > 0 || type === 'staking_reward')
    && (type === 'stake' ? !isStakedPosition(p) : ['unstake', 'staking_reward'].includes(type) ? isStakedPosition(p) : isStakedPosition(p) === (status === '質押')));
}

export function CryptoAddDialog({ state, initialMode = 'asset', platform = '', symbol: initialSymbol = '', onUpdated, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const submitting = useRef(false);
  const pendingRequest = useRef<Record<string, unknown> | null>(null);
  const [mode, setMode] = useState<Mode>(initialMode);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState<Status>('可用');
  const [type, setType] = useState<CryptoMovementType>('transfer_in');
  const [symbol, setSymbol] = useState(initialSymbol || state.coins[0]?.symbol || '');
  const [custodian, setCustodian] = useState(platform);
  const [newPlatform, setNewPlatform] = useState(() => cryptoPlatforms(state).length === 0);
  const [network, setNetwork] = useState('');
  const [quantity, setQuantity] = useState('');
  const [date, setDate] = useState(today);
  const [sourceId, setSourceId] = useState('');
  const [counterparty, setCounterparty] = useState('');
  const [unitPrice, setUnitPrice] = useState('');
  const [fees, setFees] = useState('0');
  const [settlementId, setSettlementId] = useState('');
  const [note, setNote] = useState('');
  const [platformName, setPlatformName] = useState('');
  const [coinSymbol, setCoinSymbol] = useState('');
  const [coinName, setCoinName] = useState('');
  const [priceSource, setPriceSource] = useState<CryptoCoin['priceSource']>('coingecko');
  const [priceSourceId, setPriceSourceId] = useState('');
  const [manualPrice, setManualPrice] = useState('');
  useEffect(() => { dialog.current?.showModal(); }, []);
  const platforms = cryptoPlatforms(state);
  const sources = sourcesFor(state, symbol, type, status);
  const needsSource = sourceRequired(type);
  const quoteCurrency = state.positions.find(p => p.id === settlementId)?.symbol ?? 'USD';
  const movement = useMemo<CryptoMovementInput>(() => ({
    type, date, symbol, quantity: Number(quantity), note,
    destination: { custodian, status, network },
    ...(needsSource ? { sourcePositionId: sourceId } : {}),
    ...(type === 'transfer_in' ? { counterparty } : {}),
    ...(type === 'buy' ? { unitPrice: Number(unitPrice), fees: Number(fees), quoteCurrency, ...(settlementId ? { settlementPositionId: settlementId } : {}) } : {}),
  }), [type, date, symbol, quantity, note, custodian, status, network, needsSource, sourceId, counterparty, unitPrice, fees, quoteCurrency, settlementId]);
  const preview = useMemo(() => {
    if (mode !== 'asset' || !state.coins.length) return { result: null, error: '' };
    try { return { result: planCryptoMovement(state, movement, 'preview_new_position', today()), error: '' }; }
    catch (e) { return { result: null, error: e instanceof Error ? e.message : '請填寫完整資料。' }; }
  }, [state, movement, mode]);
  function changeOrigin(nextType: CryptoMovementType, nextStatus = status, nextSymbol = symbol) {
    setType(nextType); setSourceId(sourcesFor(state, nextSymbol, nextType, nextStatus)[0]?.id ?? '');
  }
  function changeStatus(nextStatus: Status) {
    setStatus(nextStatus);
    const nextType = nextStatus === '質押' && sourcesFor(state, symbol, 'stake', nextStatus).length ? 'stake' : 'transfer_in';
    changeOrigin(nextType, nextStatus);
  }
  async function cancel() {
    if (submitting.current) return;
    if (!pendingRequest.current) { onClose(); return; }
    setBusy(true); submitting.current = true; setError('');
    try {
      const data = await callPortfolioFunction('crypto-management', { action: 'read' }) as CryptoManagementResponse;
      onUpdated(data); onClose();
    } catch (e) { setError(e instanceof Error ? e.message : '未能核對持倉，請重試。'); }
    finally { submitting.current = false; setBusy(false); }
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (submitting.current) return;
    submitting.current = true; setBusy(true); setError('');
    try {
      if (!pendingRequest.current) {
        let payload: Record<string, unknown>;
        if (mode === 'asset') {
          if (!preview.result) throw new Error(preview.error);
          payload = { action: 'record-movement', movement, expectedVersion: state.version, operationId: crypto.randomUUID() };
        } else {
          let next = structuredClone(state);
          if (mode === 'platform') next = saveCryptoPlatform(next, platformName);
          else {
            const code = coinSymbol.trim().toUpperCase();
            if (next.coins.some(c => c.symbol === code)) throw new Error('此幣種已存在，請直接在新增資產中選擇。');
            next.coins.push({ symbol: code, name: coinName.trim(), priceSource, priceSourceId: priceSource === 'coingecko' ? priceSourceId.trim() : '', manualPriceUsd: priceSource === 'manual' && manualPrice !== '' ? Number(manualPrice) : null, manualPriceAt: priceSource === 'manual' && manualPrice !== '' ? new Date().toISOString() : null });
          }
          payload = { action: 'save', state: next, expectedVersion: state.version, operationId: crypto.randomUUID(), reason: note };
        }
        pendingRequest.current = payload; setPending(true);
      }
      const result = await callPortfolioFunction('crypto-management', pendingRequest.current) as CryptoManagementResponse;
      pendingRequest.current = null; setPending(false);
      if (mode === 'asset') { onUpdated(result, '資產已新增，持倉已同步，往來已記錄於「Crypto 變動」。'); onClose(); }
      else {
        onUpdated(result);
        if (mode === 'platform') { setCustodian(platformName.trim()); setNewPlatform(false); }
        else { setSymbol(coinSymbol.trim().toUpperCase()); setSourceId(''); setSettlementId(''); }
        setMessage(mode === 'platform' ? '平台已新增，可繼續新增資產，或關閉總表。' : '幣種已新增，可繼續新增資產。');
        setNote(''); setMode('asset');
      }
    } catch (e) { setError(e instanceof Error ? e.message : '儲存失敗'); }
    finally { submitting.current = false; setBusy(false); }
  }
  const disabled = busy || pending;
  return <dialog ref={dialog} className="cm-dialog cm-add-dialog" aria-labelledby="cm-add-title" onCancel={e => { e.preventDefault(); void cancel(); }}>
    <form onSubmit={e => void submit(e)}>
      <header><h2 id="cm-add-title">新增平台／資產</h2><button type="button" aria-label="關閉新增總表" disabled={busy} onClick={() => void cancel()}>×</button></header>
      <div className="cm-add-modes" role="group" aria-label="新增項目">{([['asset', '新增資產'], ['platform', '新增平台'], ['coin', '新增幣種']] as const).map(([id, label]) => <button key={id} type="button" className={mode === id ? 'active' : ''} aria-pressed={mode === id} disabled={disabled} onClick={() => { setMode(id); setError(''); setMessage(''); setNote(''); }}>{label}</button>)}</div>
      {message && <p className="cm-caption" role="status">{message}</p>}
      <fieldset disabled={disabled} className="cm-add-fields">
        {mode === 'asset' && (state.coins.length ? <>
          <p className="cm-caption">可以在現有平台新增可用或質押資產；同平台、幣種、狀態及網絡的持倉會合併數量。</p>
          <div className="cm-form-grid">
            <label>平台／錢包<select required value={newPlatform ? '__new_platform__' : custodian} onChange={e => { const create = e.target.value === '__new_platform__'; setNewPlatform(create); setCustodian(create ? '' : e.target.value); }}><option value="">選擇現有平台</option>{platforms.map(p => <option key={p} value={p}>{p}</option>)}<option value="__new_platform__">＋ 新增平台</option></select></label>
            {newPlatform && <label>新平台名稱<input required maxLength={160} value={custodian} onChange={e => setCustodian(e.target.value)} /></label>}
            <label>幣種<select value={symbol} onChange={e => { setSymbol(e.target.value); changeOrigin(type, status, e.target.value); setSettlementId(''); }}>{state.coins.map(c => <option key={c.symbol} value={c.symbol}>{c.symbol} · {c.name}</option>)}</select></label>
            <label>資產狀態<select value={status} onChange={e => changeStatus(e.target.value as Status)}><option value="可用">可用（非質押）</option><option value="質押">質押</option></select></label>
            <label>資產來源<select value={type} onChange={e => changeOrigin(e.target.value as CryptoMovementType)}>{origins[status].map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
            <label>新增數量<input required type="number" min="0" step="any" value={quantity} onChange={e => setQuantity(e.target.value)} /></label>
            <label>發生日期<input required type="date" max={today()} value={date} onChange={e => setDate(e.target.value)} /></label>
            <label>網絡（選填）<input maxLength={160} value={network} onChange={e => setNetwork(e.target.value)} /></label>
            {needsSource && <label>{type === 'staking_reward' ? '質押收益來源' : '來源持倉'}<select required value={sourceId} onChange={e => setSourceId(e.target.value)}><option value="">選擇來源持倉</option>{sources.map(p => <option key={p.id} value={p.id}>{positionLabel(p)} · {number(p.quantity)}</option>)}</select></label>}
            {type === 'transfer_in' && <label>外部來源<input required maxLength={160} value={counterparty} onChange={e => setCounterparty(e.target.value)} placeholder="例如原有質押平台或另一個錢包" /></label>}
            {type === 'buy' && <><label>結算持倉<select value={settlementId} onChange={e => setSettlementId(e.target.value)}><option value="">外部法幣 USD</option>{state.positions.filter(p => p.symbol !== symbol && !isStakedPosition(p)).map(p => <option key={p.id} value={p.id}>{positionLabel(p)}</option>)}</select></label><label>成交單價（{quoteCurrency}）<input required type="number" min="0" step="any" value={unitPrice} onChange={e => setUnitPrice(e.target.value)} /></label><label>手續費（{quoteCurrency}）<input type="number" min="0" step="any" value={fees} onChange={e => setFees(e.target.value)} /></label></>}
          </div>
          {type === 'buy' && !settlementId && <p className="cm-caption">外部法幣只記錄成交金額，累計入金仍在「資金紀錄」管理。</p>}
          {needsSource && !sources.length && <p className="cm-caption">未有符合狀態的來源持倉；如資產由系統以外轉入，請選擇外部轉入。</p>}
        </> : <p className="cm-caption">請先在「新增幣種」建立幣種，再新增可用或質押資產。</p>)}
        {mode === 'platform' && <><p className="cm-caption">只建立平台選項，不增加資產數量；儲存後可接着新增資產。</p><label>新平台名稱<input required maxLength={160} value={platformName} onChange={e => setPlatformName(e.target.value)} /></label></>}
        {mode === 'coin' && <><p className="cm-caption">先建立幣種及價格來源，然後新增可用或質押持倉。</p><div className="cm-form-grid"><label>幣種代號<input required maxLength={24} value={coinSymbol} onChange={e => setCoinSymbol(e.target.value)} /></label><label>幣種名稱<input required maxLength={160} value={coinName} onChange={e => setCoinName(e.target.value)} /></label><label>價格來源<select value={priceSource} onChange={e => setPriceSource(e.target.value as CryptoCoin['priceSource'])}><option value="coingecko">CoinGecko</option><option value="manual">手動確認</option></select></label>{priceSource === 'coingecko' ? <label>CoinGecko ID<input required maxLength={160} value={priceSourceId} onChange={e => setPriceSourceId(e.target.value)} /></label> : <label>已確認美元單價（可留空待補）<input type="number" min="0" step="any" value={manualPrice} onChange={e => setManualPrice(e.target.value)} /></label>}</div></>}
        {(mode !== 'asset' || state.coins.length > 0) && <label className="cm-reason">{mode === 'asset' ? '往來說明' : '新增說明'}<textarea required minLength={2} maxLength={300} value={note} onChange={e => setNote(e.target.value)} /></label>}
      </fieldset>
      {mode === 'asset' && preview.result && <div className="cm-movement-preview"><strong>儲存後的持倉數量</strong>{preview.result.legs.map(l => <p key={l.positionId}>{l.custodian} · {l.symbol} · {l.status}：{number(l.before)} <span className={l.delta > 0 ? 'cm-positive' : 'cm-negative'}>{l.delta > 0 ? '+' : '−'}{number(Math.abs(l.delta))}</span> → <strong>{number(l.after)}</strong></p>)}{preview.result.totalAmount !== null && <p>支付 {number(preview.result.totalAmount)} {quoteCurrency}（已含手續費）</p>}</div>}
      {mode === 'asset' && quantity && !preview.result && !pending && <p className="cm-caption" role="status">{preview.error}</p>}
      {error && <p className="cm-alert cm-alert-error" role="alert">{error}</p>}
      {pending && !busy && <p className="cm-caption">儲存結果尚待核對；重試沿用同一筆記錄，避免重複入帳。取消會先重新讀取持倉。</p>}
      <footer><button type="button" className="button button-secondary" disabled={busy} onClick={() => void cancel()}>取消</button><button className="button button-primary" disabled={busy || (mode === 'asset' && !pending && !preview.result)}>{busy ? '正在儲存…' : pending ? '重試原筆記錄' : mode === 'asset' ? '新增資產並記錄往來' : mode === 'platform' ? '儲存平台' : '儲存幣種'}</button></footer>
    </form>
  </dialog>;
}
