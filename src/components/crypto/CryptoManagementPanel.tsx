import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { callPortfolioFunction } from '../../lib/api/vercelFunctions';
import type { CryptoCoin, CryptoFunding, CryptoManagementResponse, CryptoManagementState, CryptoPosition } from '../../types/cryptoManagement';
import { cryptoPlatforms, filterCryptoPositions, saveCryptoPlatform } from '../../lib/cryptoPlatforms';
import { CryptoAddDialog } from './CryptoAddDialog';
import { CryptoCoinSidebar } from './CryptoCoinSidebar';
import { CryptoMovementsPage } from '../../pages/CryptoMovementsPage';
import { cryptoAssetStatuses, summarizeCryptoCoins } from '../../lib/cryptoClassification';
import './cryptoManagement.css';

type Tab = 'positions' | 'movements' | 'liabilities' | 'funding' | 'history' | 'source';
type EditKind = 'liabilities' | 'funding' | 'coins' | 'platforms';
type Editor = { kind: EditKind; id: string; fields: Record<string, string>; remove?: boolean };
const money = (n: number, currency = 'USD') => new Intl.NumberFormat('zh-HK', { style: 'currency', currency, maximumFractionDigits: 2 }).format(n);
const number = (n: number) => new Intl.NumberFormat('zh-HK', { maximumFractionDigits: 18 }).format(n);
const dateLabel = (s: string) => new Intl.DateTimeFormat('zh-HK', { timeZone: 'Asia/Hong_Kong', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(s));
function download(name: string, data: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = name; link.click(); URL.revokeObjectURL(url);
}
export function CryptoManagementPanel({ history }: { history: ReactNode }) {
  const navigate = useNavigate();
  const [data, setData] = useState<CryptoManagementResponse | null>(null);
  const [params, setParams] = useSearchParams();
  const requestedTab = params.get('tab');
  const tab: Tab = ['positions', 'movements', 'liabilities', 'funding', 'history', 'source'].includes(requestedTab ?? '') ? requestedTab as Tab : 'positions';
  const setTab = (next: Tab) => setParams(next === 'positions' ? {} : { tab: next });
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<'platform' | 'coin'>('platform');
  const [selection, setSelection] = useState('');
  const [lateCloseAvailable, setLateCloseAvailable] = useState(false);
  const closeDialog = useRef<HTMLDialogElement>(null);
  const [closeReason, setCloseReason] = useState('');
  const [historyRefresh, setHistoryRefresh] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [editor, setEditor] = useState<Editor | null>(null);
  const [addMode, setAddMode] = useState<'asset' | 'coin' | null>(null);
  const [reason, setReason] = useState('');
  const [preview, setPreview] = useState<{ sourceChecksum: string; state: CryptoManagementState; differences: Array<{ symbol: string; quantity: number; previousQuantity: number }>; sourceArchive: Array<{ title: string; rows: number }> } | null>(null);
  const [source, setSource] = useState<{ title: string; values: unknown[][] } | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const sourceDialog = useRef<HTMLDialogElement>(null);
  const api = (payload: unknown) => callPortfolioFunction('crypto-management', payload);
  async function refresh() { setError(''); try { setData(await api({ action: 'read' }) as CryptoManagementResponse); } catch (e) { setError(e instanceof Error ? e.message : '讀取失敗'); } }
  useEffect(() => { void refresh(); }, []);
  useEffect(() => { if (editor) dialog.current?.showModal(); else dialog.current?.close(); }, [editor?.id, editor?.kind]);
  useEffect(() => { if (source) sourceDialog.current?.showModal(); else sourceDialog.current?.close(); }, [source]);
  const state = data?.state;
  const v = data?.valuation;
  const platforms = state ? cryptoPlatforms(state) : [];
  const coinTotals = state ? summarizeCryptoCoins(state) : [];
  const selectedCoin = coinTotals.find(c => c.symbol === selection);
  const selected = category === 'platform' ? platforms.includes(selection) ? selection : '' : state?.coins.some(c => c.symbol === selection) ? selection : '';
  const visiblePositions = state ? filterCryptoPositions(state.positions, category, selected, search) : [];
  const groups = (category === 'platform' ? platforms : state?.coins.map(c => c.symbol) ?? [])
    .filter(name => (!selected || name === selected) && (visiblePositions.some(r => (category === 'platform' ? r.custodian : r.symbol) === name) || !search.trim() || name.toLowerCase().includes(search.toLowerCase().trim())))
    .map(name => ({ name, rows: visiblePositions.filter(r => (category === 'platform' ? r.custodian : r.symbol) === name) }));
  async function operate(task: () => Promise<void>) { if (busy) return; setBusy(true); setError(''); setMessage(''); try { await task(); } catch (e) { setError(e instanceof Error ? e.message : '操作失敗'); } finally { setBusy(false); } }
  function recordMovement(row?: CryptoPosition, defaults: Record<string, string> = {}) {
    const query = new URLSearchParams({ tab: 'movements', ...(row ? { position: row.id } : defaults) });
    navigate(`/crypto-history?${query}`);
  }
  function edit(kind: EditKind, row?: CryptoPosition | CryptoFunding | CryptoCoin, defaults: Record<string, string> = {}) {
    const id = row && 'id' in row ? row.id : row && 'symbol' in row ? row.symbol : crypto.randomUUID();
    const fields: Record<string, string> = {};
    if (row) Object.entries(row).forEach(([k, value]) => fields[k] = value == null ? '' : String(value));
    else Object.assign(fields, { symbol: state?.coins[0]?.symbol ?? '', quantity: '', custodian: '', status: kind === 'liabilities' ? '借貸負債' : '可用', network: '', collateralSymbol: '', date: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Hong_Kong' }).format(new Date()), source: '', type: 'deposit', hkd: '', usd: '', name: '', priceSource: 'coingecko', priceSourceId: '', manualPriceUsd: '' });
    if (kind === 'coins' && !row) fields.symbol = '';
    Object.assign(fields, defaults);
    setReason(''); setEditor({ kind, id, fields });
  }
  function editPlatform(name: string) {
    setReason(''); setEditor({ kind: 'platforms', id: name, fields: { name } });
  }
  async function saveEditor() {
    if (!state || !editor) return;
    let next = structuredClone(state); const f = editor.fields;
    if (editor.kind === 'platforms') {
      const previousName = platforms.includes(editor.id) ? editor.id : undefined;
      next = saveCryptoPlatform(next, f.name, previousName);
    } else if (editor.kind === 'coins') {
      const old = next.coins.find(c => c.symbol === editor.id);
      const coin: CryptoCoin = { symbol: f.symbol.toUpperCase().trim(), name: f.name, priceSource: f.priceSource as CryptoCoin['priceSource'], priceSourceId: f.priceSourceId, manualPriceUsd: f.manualPriceUsd === '' ? null : Number(f.manualPriceUsd), manualPriceAt: f.manualPriceUsd === '' ? null : new Date().toISOString() };
      next.coins = old ? next.coins.map(c => c.symbol === editor.id ? coin : c) : [...next.coins, coin];
    } else {
      const rows = next[editor.kind] as Array<CryptoPosition | CryptoFunding>;
      const row: CryptoPosition | CryptoFunding = editor.kind === 'funding' ? { id: editor.id, date: f.date, source: f.source, type: f.type as CryptoFunding['type'], hkd: Number(f.hkd), usd: Number(f.usd) } : { id: editor.id, symbol: f.symbol, quantity: Number(f.quantity), custodian: f.custodian, status: f.status, network: f.network ?? '', collateralSymbol: f.collateralSymbol ?? '' };
      const updated = editor.remove ? rows.filter(r => r.id !== editor.id) : rows.some(r => r.id === editor.id) ? rows.map(r => r.id === editor.id ? row : r) : [...rows, row];
      if (editor.kind === 'funding') next.funding = updated as CryptoFunding[]; else next[editor.kind] = updated as CryptoPosition[];
    }
    const result = await api({ action: 'save', state: next, expectedVersion: state.version, operationId: crypto.randomUUID(), reason, ...(editor.kind === 'platforms' && platforms.includes(editor.id) ? { platformRename: { previousName: editor.id, name: f.name.trim() } } : {}) });
    setData(result as CryptoManagementResponse);
    if (editor.kind === 'platforms' && selected === editor.id) setSelection(f.name.trim());
    setEditor(null); setMessage('已儲存，Crypto 資產頁數量及本金已同步。');
  }
  const field = (key: string, label: string, type = 'text', required = true) => <label key={key}>{label}<input readOnly={editor?.kind === 'coins' && key === 'symbol' && state?.coins.some(c => c.symbol === editor.id)} required={required} type={type} list={key === 'custodian' ? 'cm-platform-options' : undefined} step={type === 'number' ? 'any' : undefined} maxLength={160} value={editor?.fields[key] ?? ''} onChange={e => setEditor(current => current ? { ...current, fields: { ...current.fields, [key]: e.target.value } } : current)} /></label>;
  const select = (key: string, label: string, options: Array<[string, string]>) => <label key={key}>{label}<select value={editor?.fields[key] ?? ''} onChange={e => setEditor(current => current ? { ...current, fields: { ...current.fields, [key]: e.target.value } } : current)}>{options.map(([value, name]) => <option key={value} value={value}>{name}</option>)}</select></label>;
  return <div className="page-stack cm-page">
    <section className="card cm-heading"><div><span className="cm-eyebrow">CRYPTO · 管理與歷史</span><h2>持倉管理中心</h2><p>平台持倉決定幣數 · 資產頁每日更新價格 · 每月 1 號鎖定月結</p></div><div className="cm-actions"><Link className="button button-secondary" to="/assets">查看資產</Link><button className="button button-secondary" disabled={busy} onClick={() => void operate(refresh)}>重新整理</button>{state && <button className="button button-primary" disabled={busy} onClick={() => void operate(async () => { const result = await api({ action: 'update-prices', expectedVersion: state.version }) as CryptoManagementResponse & { priceUpdateSummary: { updated: number; pending: number } }; setData(result); setMessage(`已更新 ${result.priceUpdateSummary.updated} 個幣種，${result.priceUpdateSummary.pending} 個待核對；手動價格獨立處理。`); })}>{busy ? '處理中…' : '更新市場價格'}</button>}{state && <button className="button button-secondary" onClick={() => download('crypto-management-backup.json', data)}>匯出備份</button>}</div></section>
    {error && <p className="cm-alert cm-alert-error" role="alert">{error}</p>}{message && <p className="cm-alert" role="status">{message}</p>}
    {!data && !error && <section className="card" aria-busy="true">正在讀取 Crypto 管理資料…</section>}
    {data && !state && <section className="card cm-migration"><h2>將 Google Sheet 搬入系統</h2><p>核對平台持倉、借貸、資金紀錄，並保存 Crypto 來源分頁。現有鎖定月結會保留。</p><button className="button button-primary" disabled={busy} onClick={() => void operate(async () => { setPreview(await api({ action: 'preview-migration' }) as typeof preview); })}>{busy ? '正在核對來源…' : '核對遷移資料'}</button>{preview && <><div className="cm-stats"><span>{preview.state.positions.length} 筆持倉</span><span>{preview.state.liabilities.length} 筆借貸</span><span>{preview.state.funding.length} 筆資金</span><span>{preview.sourceArchive.length} 個來源分頁</span></div><div className="cm-table-scroll"><table className="cm-table"><thead><tr><th>幣種</th><th>現有數量</th><th>原表數量 → 新持倉</th></tr></thead><tbody>{preview.differences.map(r => <tr key={r.symbol}><th>{r.symbol}</th><td>{number(r.previousQuantity)}</td><td>{number(r.quantity)}</td></tr>)}</tbody></table></div><p className="cm-alert">PHOTON 價格維持待補。遷移後 Google Sheet 只作備份，系統將按實際幣數估值，提取／消費獨立列示。</p><button className="button button-primary" disabled={busy} onClick={() => void operate(async () => { setData(await api({ action: 'migrate', operationId: crypto.randomUUID(), sourceChecksum: preview.sourceChecksum, reason: '第三階段：核對原表後遷移到系統管理' }) as CryptoManagementResponse); setPreview(null); setMessage('遷移完成，請核對持倉及來源備份。'); })}>完成遷移並啟用系統管理</button></>}</section>}
    {state && v && <>
      <section className="cm-kpis" aria-label="目前持倉概要">{[['持倉總值', money(v.grossUsd)], ['借貸負債', money(v.debtUsd)], [v.warnings.length ? '已定價淨值 · 尚有缺價' : '目前淨資產', money(v.netUsd)], ['累計本金', money(v.principalHkd, 'HKD')]].map(([label, value]) => <article className="card" key={label}><span>{label}</span><strong>{value}</strong></article>)}</section>
      {v.warnings.length > 0 && <p className="cm-alert" role="status">{v.warnings.join('；')}。以上為已取得價格部分嘅估值；補齊有效價格前不能正式月結。</p>}
      <nav className="cm-tabs" aria-label="Crypto 管理區域">{([['positions', '平台持倉'], ['movements', 'Crypto 變動'], ['liabilities', '借貸負債'], ['funding', '資金紀錄'], ['history', '月結歷史'], ['source', '來源與紀錄']] as Array<[Tab, string]>).map(([id, name]) => <button key={id} className={tab === id ? 'active' : ''} aria-pressed={tab === id} onClick={() => { setTab(id); setSearch(''); setSelection(''); setError(''); setMessage(''); }}>{name}</button>)}</nav>
      {tab === 'positions' && <section className="card">
        <div className="section-heading"><div><h2>持倉分類</h2><p className="cm-caption">按平台或幣種查看持倉；所有往來可在本頁「Crypto 變動」記錄。</p></div><div className="cm-actions">
          <button className="button button-primary" disabled={busy} onClick={() => setAddMode('asset')}>新增平台／資產</button>
        </div></div>
        <div className="cm-category-controls">
          <div className="cm-category-switch" role="group" aria-label="持倉分類方式">{([['platform', '按平台'], ['coin', '按幣種']] as const).map(([id, label]) => <button key={id} type="button" className={category === id ? 'active' : ''} aria-pressed={category === id} onClick={() => { setCategory(id); setSelection(id === 'coin' ? coinTotals.find(c => c.quantity > 0)?.symbol ?? state.coins[0]?.symbol ?? '' : ''); setSearch(''); }}>{label}</button>)}</div>
          <label className="cm-category-select">{category === 'platform' ? '平台選項' : '幣種選項'}<select value={selected} onChange={e => setSelection(e.target.value)}><option value="">全部{category === 'platform' ? '平台' : '幣種'}</option>{(category === 'platform' ? platforms.map(name => [name, name]) : state.coins.map(c => [c.symbol, `${c.symbol} · ${c.name}`])).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label className="cm-search">搜尋持倉<input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="幣種、平台、狀態或網絡" /></label>
        </div>
        <div className={category === 'coin' ? 'cm-coin-layout' : ''}>
          {category === 'coin' && <CryptoCoinSidebar state={state} selected={selected} onSelect={setSelection} />}
          <div className="cm-coin-detail">
          {category === 'coin' && selectedCoin && <div className="cm-selected-coin" aria-label={`${selectedCoin.symbol} 數量概要`}>
            <div><h3>{selectedCoin.symbol} <small>{selectedCoin.name}</small></h3><span className="cm-caption">全部平台持倉總數</span><strong className="cm-selected-quantity">{number(selectedCoin.quantity)} <small>{selectedCoin.symbol}</small></strong></div>
            <dl>{cryptoAssetStatuses.map(status => <div key={status}><dt>{status}</dt><dd>{number(selectedCoin.byStatus[status])}</dd></div>)}</dl>
          </div>}
        {!state.coins.length && <p className="cm-caption">可在「新增平台／資產」總表先新增幣種，再建立持倉。</p>}
        <p className="cm-mobile-hint">可左右滑動表格查看所有欄位</p>
        {groups.length > 0 && <div className="cm-table-scroll"><table className="cm-table cm-holdings-table"><thead><tr><th>平台／錢包</th><th>幣種</th><th className="cm-numeric">數量</th><th>狀態</th><th>網絡</th><th>操作</th></tr></thead><tbody>{groups.flatMap(group => group.rows.length ? group.rows.map((r, i) => <tr key={r.id} className={i === 0 ? 'cm-group-start' : ''}>
          {(category !== 'platform' || i === 0) && <td className="cm-platform-cell" rowSpan={category === 'platform' ? group.rows.length : 1}><button className="cm-platform-name" disabled={busy} title="平台設定" aria-label={`設定 ${r.custodian} 平台`} onClick={() => editPlatform(r.custodian)}>{r.custodian}</button></td>}
          <th scope="row">{r.symbol}</th><td className="cm-numeric">{number(r.quantity)}</td><td><span className="cm-tag" data-status={r.status}>{r.status}</span></td><td>{r.network || '—'}</td><td><button className="button button-secondary" disabled={busy} aria-label={`查看 ${r.symbol} ${r.custodian} 往來`} onClick={() => recordMovement(r)}>往來</button></td>
        </tr>) : [<tr key={`empty_${group.name}`}><td>{category === 'platform' ? <button className="cm-platform-name" disabled={busy} aria-label={`設定 ${group.name} 平台`} onClick={() => editPlatform(group.name)}>{group.name}</button> : '—'}</td><th scope="row">{category === 'coin' ? group.name : '—'}</th><td colSpan={3} className="cm-caption">未有持倉</td><td><button className="button button-secondary" disabled={busy} onClick={() => { setSelection(group.name); setAddMode('asset'); }}>新增資產</button></td></tr>])}</tbody></table></div>}
        {!groups.length && <p className="cm-caption">{search.trim() ? '沒有符合搜尋條件的持倉。' : `未有${category === 'platform' ? '平台' : '幣種'}，可在上方新增。`}</p>}
        </div></div>
      </section>}
      {tab === 'movements' && <CryptoMovementsPage embedded onUpdated={setData} />}
      {tab === 'liabilities' && <section className="card"><div className="section-heading"><div><h2>借貸與抵押</h2><p className="cm-caption">借貸獨立記錄並從淨資產扣除；抵押幣仍保留原持倉。</p></div><button className="button button-primary" disabled={busy || !state.coins.length} onClick={() => edit('liabilities')}>新增借貸</button></div><label className="cm-search">搜尋幣種或平台<input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="例如 BTC、Keplr、質押" /></label><p className="cm-mobile-hint">可左右滑動表格查看所有欄位</p><div className="cm-table-scroll"><table className="cm-table"><thead><tr><th>幣種</th><th>平台／錢包</th><th className="cm-numeric">數量</th><th>狀態</th><th>網絡／抵押</th><th>操作</th></tr></thead><tbody>{filterCryptoPositions(state.liabilities, 'platform', '', search).map(r => <tr key={r.id}><th>{r.symbol}</th><td>{r.custodian}</td><td className="cm-numeric">{number(r.quantity)}</td><td><span className="cm-tag" data-status={r.status}>{r.status}</span></td><td>{[r.network, r.collateralSymbol].filter(Boolean).join(' · ') || '—'}</td><td><button className="button button-secondary" disabled={busy} aria-label={`修改 ${r.symbol} ${r.custodian}`} onClick={() => edit('liabilities', r)}>修改</button></td></tr>)}</tbody></table></div>{!filterCryptoPositions(state.liabilities, 'platform', '', search).length && <p>{search.trim() ? '沒有符合搜尋條件的借貸。' : '未有紀錄。'}</p>}</section>}
      {tab === 'positions' && category === 'coin' && <section className="card"><div className="section-heading"><div><h2>幣種合計與價格來源</h2><p className="cm-caption">新增幣種後即可記錄買入或轉入；手動價格需在 24 小時內更新方可月結。</p></div><button className="button button-secondary" disabled={busy} onClick={() => setAddMode('coin')}>新增幣種</button></div><div className="cm-table-scroll"><table className="cm-table"><thead><tr><th>幣種</th><th>名稱</th><th className="cm-numeric">總數量</th><th className="cm-numeric">美元單價</th><th>價格來源</th><th>操作</th></tr></thead><tbody>{state.coins.filter(c => !selected || c.symbol === selected).map(c => <tr key={c.symbol}><th>{c.symbol}</th><td>{c.name}</td><td className="cm-numeric">{number(coinTotals.find(total => total.symbol === c.symbol)?.quantity ?? 0)}</td><td className="cm-numeric">{v.prices[c.symbol] == null ? '待補價格' : number(v.prices[c.symbol] ?? 0)}</td><td>{c.priceSource === 'manual' ? '手動確認' : `CoinGecko · ${c.priceSourceId}`}</td><td><button className="button button-secondary" disabled={busy} aria-label={`設定 ${c.symbol}`} onClick={() => edit('coins', c)}>設定</button></td></tr>)}</tbody></table></div></section>}
      {tab === 'funding' && <section className="card"><div className="section-heading"><div><h2>入金、提取與調整</h2><p className="cm-caption">提取／消費獨立列示，不會重複加減現有持倉價值。累計提取 {money(v.withdrawnUsd)}。</p></div><button className="button button-primary" disabled={busy} onClick={() => edit('funding')}>新增資金紀錄</button></div><div className="cm-table-scroll"><table className="cm-table"><thead><tr><th>日期</th><th>說明</th><th>類型</th><th className="cm-numeric">HKD</th><th className="cm-numeric">USD</th><th>操作</th></tr></thead><tbody>{[...state.funding].sort((a, b) => b.date.localeCompare(a.date)).map(r => <tr key={r.id}><td>{r.date}</td><th>{r.source}</th><td>{r.type === 'deposit' ? '入金' : r.type === 'withdrawal' ? '提取／消費' : '本金調整'}</td><td className="cm-numeric">{number(r.hkd)}</td><td className="cm-numeric">{number(r.usd)}</td><td><button className="button button-secondary" disabled={busy} onClick={() => edit('funding', r)}>修改</button></td></tr>)}</tbody></table></div></section>}
      {tab === 'history' && <><section className="card"><div className="section-heading"><div><h2>鎖定月結</h2><p className="cm-caption">每月 1 號價格更新後自動建立當月快照。舊月份保留原表口徑；新月份按淨資產計算，提取另外列示。</p></div><button className="button button-secondary" disabled={busy} onClick={() => void operate(async () => { const result = await api({ action: 'close-month', expectedVersion: state.version }) as CryptoManagementResponse & { result: { status: string; message?: string; warnings?: string[] } }; setData(result); setLateCloseAvailable(result.result.status === 'waiting-first-day'); setHistoryRefresh(n => n + 1); setMessage(result.result.status === 'locked' ? '當月已鎖定，沒有覆蓋。' : result.result.message ?? (result.result.warnings?.join('；') || '月結檢查完成。')); })}>檢查當月月結</button>{lateCloseAvailable && <button className="button button-secondary" disabled={busy} onClick={() => { setCloseReason(''); closeDialog.current?.showModal(); }}>以今日資料補記當月</button>}</div>{data.draft && <p className="cm-alert">{data.draft.month} 月結草稿：{data.draft.warnings.join('；')}。尚未鎖定正式月結。</p>}</section><div key={historyRefresh}>{history}</div></>}
      {tab === 'source' && <><section className="card"><h2>遷移來源備份</h2><p className="cm-caption">遷移時間：{dateLabel(state.migratedAt)}。以下為遷移當時原表值，保留來源內容供查閱。</p><div className="cm-source-grid">{data.sourceArchive.map(s => <button className="cm-source-card" key={s.id} disabled={busy} onClick={() => void operate(async () => { const result = await api({ action: 'source', id: s.id }) as { source: typeof source }; setSource(result.source); })}><strong>{s.title}</strong><span>{s.rows} 行 · 查看原表</span></button>)}</div></section><section className="card"><h2>最近操作紀錄</h2><div className="cm-audit">{data.audit.map(a => <article key={a.id}><strong>{a.reason}</strong><span>{dateLabel(a.at)} · 版本 {a.version}</span></article>)}</div></section></>}
      <p className="cm-caption cm-footer">目前版本 {state.version} · Crypto 數量以此頁為準 · 資產頁每日價格更新照常運作</p>
    </>}
    {state && addMode && <CryptoAddDialog state={state} initialMode={addMode} platform={category === 'platform' ? selected : ''} symbol={category === 'coin' ? selected : ''} onUpdated={(result, text) => { setData(result); if (text) setMessage(text); }} onClose={() => setAddMode(null)} />}
    <dialog ref={closeDialog} className="cm-dialog" onCancel={e => { if (busy) e.preventDefault(); }}>
      <form onSubmit={e => { e.preventDefault(); void operate(async () => {
        if (!state) return;
        const result = await api({ action: 'close-month', expectedVersion: state.version, lateConfirmation: 'CONFIRM_CURRENT_DATE_CLOSE', reason: closeReason }) as CryptoManagementResponse & { result: { status: string; warnings?: string[] } };
        setData(result); setHistoryRefresh(n => n + 1);
        setMessage(result.result.status === 'created' ? '已按今日實際日期補記當月月結，並保留原因。' : result.result.warnings?.join('；') ?? '當月已鎖定。');
        closeDialog.current?.close();
      }); }}>
        <header><h2>確認補記當月月結</h2></header>
        <p className="cm-alert">使用今日實際持倉、價格及日期，並標記為延後補記。不會回填月初數值，亦不會改寫舊月份。</p>
        <label className="cm-reason">補記原因<textarea required minLength={2} maxLength={300} value={closeReason} onChange={e => setCloseReason(e.target.value)} /></label>
        {error && <p role="alert">{error}</p>}
        <footer><button type="button" className="button button-secondary" disabled={busy} onClick={() => closeDialog.current?.close()}>取消</button><button className="button button-primary" disabled={busy}>確認以今日資料補記</button></footer>
      </form>
    </dialog>
    <dialog ref={dialog} className="cm-dialog" onCancel={e => { if (busy) e.preventDefault(); else setEditor(null); }} onClose={() => setEditor(null)}>{editor && <form onSubmit={e => { e.preventDefault(); void operate(saveEditor); }}><header><h2>{editor.remove ? '移除紀錄' : editor.kind === 'platforms' ? '平台設定' : editor.kind === 'coins' ? '幣種與價格設定' : editor.kind === 'funding' ? '資金紀錄' : '平台持倉／借貸'}</h2><button type="button" aria-label="關閉" disabled={busy} onClick={() => setEditor(null)}>×</button></header>{!editor.remove && <div className="cm-form-grid">{editor.kind === 'platforms' ? <>{field('name', '平台名稱')}</> : editor.kind === 'coins' ? <>{field('symbol', '代號')}{field('name', '名稱')}{select('priceSource', '價格來源', [['coingecko', 'CoinGecko'], ['manual', '手動確認']])}{editor.fields.priceSource === 'coingecko' ? field('priceSourceId', 'CoinGecko ID') : field('manualPriceUsd', '已確認美元單價（可留空待補）', 'number', false)}</> : editor.kind === 'funding' ? <>{field('date', '日期', 'date')}{select('type', '類型', [['deposit', '入金'], ['withdrawal', '提取／消費'], ['adjustment', '本金調整']])}{field('source', '說明')}{field('hkd', '港元金額', 'number')}{field('usd', '美元金額', 'number')}</> : <>{select('symbol', '幣種', state?.coins.map(c => [c.symbol, `${c.symbol} · ${c.name}`]) ?? [])}{field('custodian', '平台／錢包')}<datalist id="cm-platform-options">{platforms.map(name => <option key={name} value={name} />)}</datalist>{field('quantity', '數量', 'number')}{field('status', '狀態')}{field('network', '網絡', 'text', false)}{editor.kind === 'liabilities' && select('collateralSymbol', '關聯抵押幣', [['', '無指定抵押'], ...(state?.coins.map(c => [c.symbol, c.symbol] as [string, string]) ?? [])])}</>}</div>}<label className="cm-reason">{editor.remove ? '移除原因' : '修改原因'}<textarea required minLength={2} maxLength={300} value={reason} onChange={e => setReason(e.target.value)} /></label>{error && <p className="cm-alert cm-alert-error" role="alert">{error}</p>}<footer>{editor.kind !== 'coins' && editor.kind !== 'platforms' && state?.[editor.kind].some(r => r.id === editor.id) && !editor.remove && <button className="button cm-danger" type="button" disabled={busy} onClick={() => setEditor({ ...editor, remove: true })}>移除紀錄</button>}<button className="button button-secondary" type="button" disabled={busy} onClick={() => setEditor(null)}>取消</button><button className="button button-primary" disabled={busy}>{busy ? '正在儲存…' : editor.remove ? '確認移除' : '儲存並同步'}</button></footer></form>}</dialog>
    <dialog ref={sourceDialog} className="cm-dialog cm-source-dialog" onClose={() => setSource(null)}>{source && <><header><h2>{source.title} · 原表備份</h2><button aria-label="關閉來源" onClick={() => setSource(null)}>×</button></header><button className="button button-secondary" onClick={() => download(`crypto-source-${source.title}.json`, source)}>匯出來源</button><div className="cm-table-scroll"><table className="cm-table"><tbody>{source.values.map((row, i) => <tr key={i}><th>{i + 1}</th>{row.map((cell, j) => <td key={j}>{cell == null ? '' : String(cell)}</td>)}</tr>)}</tbody></table></div></>}</dialog>
  </div>;
}
