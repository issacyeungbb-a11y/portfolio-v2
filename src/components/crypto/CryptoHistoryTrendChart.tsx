import { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { CryptoMonthlySnapshot } from '../../types/cryptoHistory';

type TrendMode = 'asset' | 'return' | 'change';
type Currency = 'HKD' | 'USD';
interface Props { snapshots: CryptoMonthlySnapshot[]; mode: TrendMode; currency?: Currency; selectedMonth?: string | null; onSelectMonth: (month: string) => void }
const monthIndex = (month: string) => { const [y, m] = month.split('-').map(Number); return y * 12 + m; };
const basis = (s: CryptoMonthlySnapshot) => s.sourceType === 'system_management' ? '平台持倉淨值' : '原表口徑';
const money = (v: number, currency: Currency) => new Intl.NumberFormat('zh-HK', { style: 'currency', currency, maximumFractionDigits: currency === 'USD' ? 2 : 0 }).format(v);
const percent = (v: number | null) => v == null ? '未有資料' : new Intl.NumberFormat('zh-HK', { style: 'percent', maximumFractionDigits: 2, signDisplay: 'exceptZero' }).format(v);

export const CryptoHistoryTrendChart = memo(function CryptoHistoryTrendChart({ snapshots, mode, currency = 'HKD', selectedMonth, onSelectMonth }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const [hovered, setHovered] = useState<string | null>(null);
  useEffect(() => { const el = container.current; if (!el) return; const observer = new ResizeObserver(([entry]) => setWidth(Math.max(240, entry.contentRect.width))); observer.observe(el); return () => observer.disconnect(); }, []);
  const height = 260, left = 72, right = 16, top = 18, bottom = 40;
  const chartCurrency = mode === 'return' ? 'HKD' : currency;
  const format = (v: number) => mode === 'change' ? percent(v) : money(v, chartCurrency);
  const points = useMemo(() => snapshots.map(s => ({ snapshot: s, time: monthIndex(s.month), value: mode === 'change' ? s.monthOverMonthPct : mode === 'return' ? s.returnHkd : currency === 'HKD' ? s.totalHkd : s.performanceTotalUsd, principal: currency === 'HKD' ? s.principalHkd : s.usdHkdRate > 0 ? s.principalHkd / s.usdHkdRate : null })), [snapshots, mode, currency]);
  if (!points.length) return <div ref={container}><p className="status-message">所選範圍未有月結走勢。</p></div>;
  const values = points.flatMap(p => [p.value, ...(mode === 'asset' ? [p.principal] : []), ...(mode === 'change' ? [0] : [])]).filter((v): v is number => v != null && Number.isFinite(v));
  if (!values.length) return <div ref={container}><p>所選範圍未有可比較數值。</p></div>;
  const rawMin = Math.min(...values), rawMax = Math.max(...values), pad = (rawMax - rawMin || Math.max(1, Math.abs(rawMax))) * .12;
  const min = rawMin - pad, max = rawMax + pad;
  const x = (t: number) => left + (points.length === 1 ? .5 : (t - points[0].time) / (points[points.length - 1].time - points[0].time)) * (width - left - right);
  const y = (v: number) => top + (max - v) / (max - min) * (height - top - bottom);
  const active = points.find(p => p.snapshot.month === (hovered ?? selectedMonth)) ?? points[points.length - 1];
  const path = (field: 'value' | 'principal') => points.map((p, i) => { const prev = points[i - 1], value = p[field]; if (value == null || !Number.isFinite(value)) return ''; const connected = prev && prev[field] != null && Number.isFinite(prev[field]) && prev.time + 1 === p.time && basis(prev.snapshot) === basis(p.snapshot); return `${connected ? 'L' : 'M'}${x(p.time)},${y(value)}`; }).join(' ');
  const tickIndices = Array.from(new Set([0, ...(width > 500 ? [Math.floor((points.length - 1) / 3), Math.floor((points.length - 1) * 2 / 3)] : []), points.length - 1]));
  return <div className="crypto-trend-chart" ref={container}>
    <div className="crypto-chart-summary" aria-live="polite"><div><span>{active.snapshot.month}</span><strong>{active.value == null ? '未有資料' : format(active.value)}</strong></div><span>{basis(active.snapshot)}{mode === 'asset' && active.principal != null ? ` · 本金 ${money(active.principal, currency)}` : ''}</span></div>
    {mode === 'asset' && <div className="monthly-chart-legend"><span>● 月結總值</span><span className="monthly-principal-key">┄ 累計本金{currency === 'USD' ? '（按各月匯率換算）' : ''}</span></div>}
    <div className="crypto-chart-stage monthly-chart-stage" onMouseLeave={() => setHovered(null)}>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={mode === 'asset' ? `月結總值與本金 ${currency}` : mode === 'return' ? '累計回報 HKD' : '月度資產變化百分比'}>
        {[0, .5, 1].map(r => { const yy = top + r * (height - top - bottom), v = max - r * (max - min); return <g key={r}><line className="crypto-chart-grid-line" x1={left} x2={width - right} y1={yy} y2={yy}/><text x={left - 8} y={yy + 4} textAnchor="end" className="monthly-axis-label">{mode === 'change' ? percent(v) : new Intl.NumberFormat('zh-HK', { notation: 'compact', maximumFractionDigits: 1 }).format(v)}</text></g>; })}
        {min < 0 && max > 0 && <line className="crypto-chart-zero-line" x1={left} x2={width - right} y1={y(0)} y2={y(0)}/>}
        {mode === 'asset' && <path className="crypto-chart-line monthly-principal-line" d={path('principal')}/>}
        {mode !== 'change' && <path className="crypto-chart-line" d={path('value')}/>}
        {points.map((p, i) => <g key={p.snapshot.id}>
          {i > 0 && basis(points[i - 1].snapshot) !== basis(p.snapshot) && <line className="monthly-basis-boundary" x1={x(p.time)} x2={x(p.time)} y1={top} y2={height - bottom}><title>計算口徑轉為{basis(p.snapshot)}</title></line>}
          {p.value != null && Number.isFinite(p.value) && (mode === 'change' ? <rect className="monthly-change-bar" data-negative={p.value < 0} x={x(p.time) - Math.min(12, (width - left - right) / points.length / 3)} y={Math.min(y(p.value), y(0))} width={Math.min(24, (width - left - right) / points.length * .65)} height={Math.max(1, Math.abs(y(p.value) - y(0)))}/> : <circle cx={x(p.time)} cy={y(p.value)} r={p.snapshot.month === active.snapshot.month ? 5 : 2.5} className="monthly-chart-dot"/>)}
        </g>)}
        {tickIndices.map(i => <text key={i} x={x(points[i].time)} y={height - 12} textAnchor={i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle'} className="monthly-axis-label">{points[i].snapshot.month}</text>)}
      </svg>
      <div className="crypto-chart-points" aria-label="可選月份">{points.map(p => <button key={p.snapshot.id} type="button" className={`crypto-chart-point${p.snapshot.month === active.snapshot.month ? ' active' : ''}`} style={{ left: `${x(p.time) / width * 100}%`, top: `${y(p.value ?? 0) / height * 100}%` }} aria-label={`${p.snapshot.month}，${p.value == null ? '未有資料' : format(p.value)}，${basis(p.snapshot)}`} onMouseEnter={() => setHovered(p.snapshot.month)} onFocus={() => setHovered(p.snapshot.month)} onBlur={() => setHovered(null)} onClick={() => onSelectMonth(p.snapshot.month)}/>)}</div>
    </div>
    <p className="cm-caption">{mode === 'change' ? '單位：% · 比較基礎：USD' : `單位：${chartCurrency}`} · 點選月份查看檔案 · 計算口徑轉變及月份缺漏不連線</p>
  </div>;
});
