import { useCallback, useEffect, useMemo, useState } from 'react';

import { StatusBadge, type StatusBadgeTone } from '../components/ui/StatusBadge';
import { DataCard, PageSection } from '../components/ui/DesignSystem';
import { useTopBar, type TopBarConfig } from '../layout/TopBarContext';
import { callPortfolioFunction } from '../lib/api/vercelFunctions';
import { formatCurrencyRounded } from '../lib/currency';
import type {
  AiCycleGuidanceItem,
  AiCycleIndex,
  AiCyclePillar,
  AiCycleResponse,
  AiExposureHolding,
  AiLayerCode,
} from '../types/aiCycle';
import './aiCycle.css';

type Severity = 'good' | 'watch' | 'high';

const percent = (value: number | null | undefined, digits = 1) =>
  value == null ? '—' : `${(value * 100).toFixed(digits)}%`;
const signedPercent = (value: number | null | undefined) =>
  value == null ? '—' : `${value > 0 ? '+' : ''}${(value * 100).toFixed(1)}%`;
const signedPoints = (value: number | null | undefined) =>
  value == null ? '未有可比數據' : `${value > 0 ? '+' : ''}${value.toFixed(1)} 分`;
const score = (value: number | null | undefined) => (value == null ? '—' : value.toFixed(1));
const hkd = (value: number) => formatCurrencyRounded(value, 'HKD');

function formatDateTime(value?: string | null) {
  if (!value) return '未有紀錄';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-HK', { timeZone: 'Asia/Hong_Kong', dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function stanceTone(level: number | null): StatusBadgeTone {
  if (level == null || level === 0) return 'neutral';
  if (level > 0) return 'success';
  return level <= -2 ? 'danger' : 'warning';
}

// 泡沫風險愈高愈差；變現愈高愈好。量表顏色只反映嚴重程度，旁邊一定有文字標示。
function riskSeverity(value: number | null): Severity {
  if (value == null) return 'watch';
  return value >= 60 ? 'high' : value >= 40 ? 'watch' : 'good';
}
const RISK_LABEL: Record<Severity, string> = { good: '偏低', watch: '中等', high: '偏高' };
const STATE_LABEL: Record<string, string> = {
  INFRASTRUCTURE_BUILDOUT: '基建擴張期', COMMERCIALIZATION: '商業化期', HARVEST: '收成期', EUPHORIA: '亢奮期',
  OVERBUILD_BUBBLE: '過度建設／泡沫期', DELEVERAGING: '去槓桿期', RECOVERY: '復甦期', TRANSITION: '過渡期',
};

function supportLabel(value: number | null) {
  if (value == null) return '未有讀數';
  return value >= 60 ? '支持較強' : value >= 40 ? '支持中等' : '支持偏弱';
}

function Meter({ value, severity = 'good', label }: { value: number | null; severity?: Severity; label: string }) {
  const width = value == null ? 0 : Math.max(0, Math.min(100, value));
  return (
    <div
      className="aic-meter" data-severity={severity} role="meter" aria-label={label}
      aria-valuemin={0} aria-valuemax={100} aria-valuenow={value ?? undefined}
      aria-valuetext={value == null ? '未有讀數' : `${value.toFixed(1)}（滿分 100）`}
    >
      <span className="aic-meter-fill" style={{ width: `${width}%` }} />
    </div>
  );
}

function IndexTile({ index, kind }: { index: AiCycleIndex; kind: 'ami' | 'abri' }) {
  const severity: Severity = kind === 'abri' ? riskSeverity(index.score) : 'good';
  const reading = kind === 'abri' ? (index.score == null ? '未有讀數' : `風險${RISK_LABEL[severity]}`) : supportLabel(index.score);
  return (
    <article className="aic-tile">
      <p className="summary-label">{index.label_zh}（暫定）</p>
      <p className="aic-tile-value">
        <strong>{score(index.score)}</strong>
        <span>{reading}</span>
      </p>
      <Meter value={index.score} severity={severity} label={`${index.label_zh}暫定分數`} />
      <dl className="aic-tile-facts">
        <div><dt>已覆蓋權重</dt><dd>{percent(index.weight_covered, 0)}</dd></div>
        <div><dt>相對兩季前</dt><dd>{signedPoints(index.change_2q)}</dd></div>
        <div><dt>正式分數</dt><dd>{index.formal_score == null ? '未達發布門檻' : score(index.formal_score)}</dd></div>
      </dl>
      {index.null_reason_zh ? <p className="summary-hint">未能計算：{index.null_reason_zh}</p> : null}
    </article>
  );
}

function PillarList({ title, pillars, risk }: { title: string; pillars: AiCyclePillar[]; risk: boolean }) {
  return (
    <div className="aic-pillars">
      <h3>{title}</h3>
      <ul className="aic-meter-list">
        {pillars.map((pillar) => (
          <li key={pillar.code} data-used={pillar.used_in_provisional}>
            <div className="aic-meter-list-head">
              <span className="aic-meter-list-name">
                {pillar.label_zh}
                <small>權重 {percent(pillar.base_weight, 0)}{pillar.source_tier === 2 ? ' · 第二級來源' : ''}</small>
              </span>
              <span className="aic-meter-list-figure">{pillar.used_in_provisional ? score(pillar.score) : '未採用'}</span>
            </div>
            {pillar.used_in_provisional ? (
              <Meter value={pillar.score} severity={risk ? riskSeverity(pillar.score) : 'good'} label={`${pillar.label_zh}分數`} />
            ) : (
              <p className="aic-meter-list-note">{pillar.not_used_reason_zh ?? '數據不足'}</p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function GuidanceList({ items }: { items: AiCycleGuidanceItem[] }) {
  return (
    <ul className="aic-guidance">
      {items.map((item) => (
        <li key={item.title} data-tone={item.tone}>
          <strong>{item.title}</strong>
          <p>{item.text}</p>
        </li>
      ))}
    </ul>
  );
}

export function AiCyclePage() {
  const [data, setData] = useState<AiCycleResponse | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<'' | 'load' | 'refresh' | 'analyze' | 'classify'>('load');
  const [question, setQuestion] = useState('');

  const call = useCallback(async (payload: Record<string, unknown>, kind: 'load' | 'refresh' | 'analyze' | 'classify') => {
    setBusy(kind);
    setError('');
    try {
      setData((await callPortfolioFunction('ai-cycle', payload)) as AiCycleResponse);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '讀取人工智能週期資料失敗。');
    } finally {
      setBusy('');
    }
  }, []);

  useEffect(() => { void call({ action: 'read' }, 'load'); }, [call]);

  const stance = data?.signal.stance;
  const topBarConfig = useMemo<TopBarConfig>(() => ({
    title: '人工智能週期',
    primaryStatus: stance ? { label: stance.label_zh, tone: stanceTone(stance.level) } : undefined,
  }), [stance]);
  useTopBar(topBarConfig);

  if (!data) {
    return (
      <div className="page-stack aic-page">
        {error
          ? <p className="status-message status-message-error" role="alert">{error}</p>
          : <div className="skeleton skeleton-card" aria-busy="true" aria-label="正在讀取人工智能週期資料" />}
        {error ? <div className="button-row"><button className="button button-primary" onClick={() => void call({ action: 'read' }, 'load')}>重試</button></div> : null}
      </div>
    );
  }

  const { signal, meta, exposure, guidance, layerOptions, analysis, weeklyRuns } = data;
  const sourceLabel = meta.source === 'baseline' ? '內置基準讀數' : meta.source === 'live' ? '剛剛更新' : '已儲存的訊號';
  const quarters = [...signal.history].filter((row) => row.ami != null || row.abri != null).slice(-8).reverse();
  const basket = signal.pulse.basket;

  const classify = (holding: AiExposureHolding, layer: string) =>
    void call({ action: 'classify', symbol: holding.symbol, layer }, 'classify');

  const layerSelect = (holding: AiExposureHolding) => (
    <select
      className="aic-select" value={holding.layer} disabled={busy !== ''}
      aria-label={`${holding.symbol} 的人工智能分類`}
      onChange={(event) => classify(holding, event.target.value as AiLayerCode)}
    >
      {layerOptions.map((option) => <option key={option.code} value={option.code}>{option.label}</option>)}
    </select>
  );

  return (
    <div className="page-stack aic-page">
      {error ? <p className="status-message status-message-error" role="alert">{error}</p> : null}

      <section className="card aic-hero" data-tone={stanceTone(stance!.level)}>
        <div className="aic-hero-main">
          <p className="eyebrow">本週板塊傾向 · 讀數日期 {signal.as_of_date}</p>
          <h2 className="aic-hero-stance">{stance!.label_zh}</h2>
          <div className="aic-badges">
            <StatusBadge label={`信心：${stance!.confidence_zh}`} tone={stance!.confidence === 'HIGH' ? 'success' : stance!.confidence === 'MEDIUM' ? 'neutral' : 'warning'} />
            <StatusBadge label={`候選週期：${signal.cycle.candidate_state_zh ?? '未能判斷'}`} />
            <StatusBadge label={sourceLabel} tone={meta.source === 'baseline' ? 'warning' : 'neutral'} />
          </div>
          <ul className="aic-reasons">
            {stance!.reasons_zh.map((reason) => <li key={reason}>{reason}</li>)}
            {stance!.caps_zh.map((cap) => <li key={cap}>{cap}</li>)}
          </ul>
        </div>
        <div className="aic-hero-side">
          <button className="button button-secondary" disabled={busy !== ''} onClick={() => void call({ action: 'refresh' }, 'refresh')}>
            {busy === 'refresh' ? '讀取中…' : '重新讀取訊號'}
          </button>
          <p className="table-hint">上次成功讀取：{formatDateTime(meta.fetchedAt)}</p>
        </div>
      </section>

      {meta.source === 'baseline' ? (
        <p className="status-message status-message-warning">
          現正顯示系統內置的基準讀數（{signal.as_of_date}），並非最新。
          {meta.tokenConfigured ? '已設定讀取權杖，但尚未成功取得每週訊號檔。' : '尚未設定讀取每週訊號檔的權杖（AI_CYCLE_SIGNAL_TOKEN）。'}
        </p>
      ) : null}
      {meta.lastFetchError ? <p className="status-message status-message-warning">最近一次讀取訊號檔失敗：{meta.lastFetchError}</p> : null}
      {meta.overdue ? <p className="status-message status-message-warning">訊號已有 {meta.signalAgeDays} 日沒有更新，每週工作可能已經停止，請勿當作本週讀數。</p> : null}
      {signal.freshness.stale ? <p className="status-message status-message-warning">基本面數據已過期：{signal.freshness.stale_reason_zh}。</p> : null}

      <div className="aic-tiles">
        <IndexTile index={signal.ami} kind="ami" />
        <IndexTile index={signal.abri} kind="abri" />
        <article className="aic-tile">
          <p className="summary-label">我的人工智能佔比</p>
          <p className="aic-tile-value"><strong>{percent(exposure.aiShare)}</strong><span>佔總資產</span></p>
          <Meter value={exposure.aiShare * 100} label="人工智能持倉佔總資產" />
          <dl className="aic-tile-facts">
            <div><dt>人工智能持倉</dt><dd>{hkd(exposure.aiValueHKD)}</dd></div>
            <div><dt>總資產</dt><dd>{hkd(exposure.totalValueHKD)}</dd></div>
            <div><dt>項目</dt><dd>{exposure.holdings.length} 項</dd></div>
          </dl>
          {exposure.fxSource === 'default' ? <p className="summary-hint">匯率使用系統預設值，佔比屬近似數。</p> : null}
        </article>
      </div>

      <PageSection title="組合提示" subtitle="把板塊傾向與你的實際持倉對照而得；屬規則式參考，並非買賣指示。">
        <GuidanceList items={guidance} />
      </PageSection>

      <PageSection title="我的人工智能持倉" subtitle="分類可以更改；更改後佔比及提示會即時重算。">
        {exposure.layers.length > 0 ? (
          <ul className="aic-meter-list aic-layer-list">
            {exposure.layers.map((layer) => (
              <li key={layer.code}>
                <div className="aic-meter-list-head">
                  <span className="aic-meter-list-name">{layer.label}<small>{layer.count} 項 · {hkd(layer.valueHKD)}</small></span>
                  <span className="aic-meter-list-figure">{percent(layer.shareOfAi, 0)}</span>
                </div>
                <Meter value={layer.shareOfAi * 100} label={`${layer.label}佔人工智能持倉`} />
              </li>
            ))}
          </ul>
        ) : null}
        {exposure.holdings.length > 0 ? (
          <div className="aic-table-scroll">
            <table className="aic-table aic-table-wide">
              <thead><tr><th>代號</th><th>名稱</th><th>所屬環節</th><th className="aic-numeric">市值</th><th className="aic-numeric">佔總資產</th><th>監察範圍</th></tr></thead>
              <tbody>
                {exposure.holdings.map((holding) => (
                  <tr key={holding.id}>
                    <th scope="row">{holding.symbol}</th>
                    <td>{holding.name}</td>
                    <td>{layerSelect(holding)}</td>
                    <td className="aic-numeric">{hkd(holding.valueHKD)}</td>
                    <td className="aic-numeric">{percent(holding.shareOfTotal)}</td>
                    <td>{holding.monitored ? '涵蓋' : '不涵蓋'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="table-hint">未有被歸類為人工智能相關的持倉。</p>}
        {exposure.candidates.length > 0 ? (
          <details className="aic-details">
            <summary>未分類的股票及基金（{exposure.candidates.length} 項）</summary>
            <div className="aic-table-scroll">
              <table className="aic-table aic-table-wide">
                <thead><tr><th>代號</th><th>名稱</th><th>歸類為</th><th className="aic-numeric">佔總資產</th></tr></thead>
                <tbody>
                  {exposure.candidates.map((holding) => (
                    <tr key={holding.id}>
                      <th scope="row">{holding.symbol}</th>
                      <td>{holding.name}</td>
                      <td>{layerSelect(holding)}</td>
                      <td className="aic-numeric">{percent(holding.shareOfTotal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        ) : null}
      </PageSection>

      <PageSection title="每週市場脈搏" subtitle={`十三間觀察公司的股價與信貸市場狀況；最多令傾向上調或下調一級。數據截至 ${basket?.as_of ?? signal.pulse.as_of}。`}>
        {signal.pulse.status === 'UNAVAILABLE' ? (
          <p className="table-hint">{signal.pulse.unavailable_reason_zh ?? '本次未能取得每週市場數據。'}</p>
        ) : (
          <>
            {basket ? (
              <div className="aic-stat-row">
                <div className="aic-stat"><span>四週中位升跌</span><strong>{signedPercent(basket.median_return_4w)}</strong></div>
                <div className="aic-stat"><span>十三週中位升跌</span><strong>{signedPercent(basket.median_return_13w)}</strong></div>
                <div className="aic-stat"><span>較一年高位中位回落</span><strong>{percent(basket.median_drawdown_from_high)}</strong></div>
                <div className="aic-stat"><span>{basket.reference_date} 季結後</span><strong>{signedPercent(basket.median_return_since_reference)}</strong></div>
              </div>
            ) : <p className="table-hint">股價數據不足，本次只有信貸市場數據。</p>}
            {signal.pulse.macro.length > 0 ? (
              <div className="aic-table-scroll">
                <table className="aic-table">
                  <thead><tr><th>項目</th><th className="aic-numeric">最新數值</th><th className="aic-numeric">四週變化</th><th>日期</th></tr></thead>
                  <tbody>
                    {signal.pulse.macro.map((item) => (
                      <tr key={item.code}>
                        <th scope="row">{item.label_zh}</th>
                        <td className="aic-numeric">{item.value.toFixed(2)}%</td>
                        <td className="aic-numeric">{item.change_4w == null ? '—' : `${item.change_4w > 0 ? '+' : ''}${item.change_4w.toFixed(2)} 個百分點`}</td>
                        <td>{item.date}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
            <p className="table-hint">
              {signal.pulse.flags.length > 0 ? `本週警示：${signal.pulse.flags.map((flag) => flag.label_zh).join('；')}。` : '本週沒有觸發警示。'}
              {signal.pulse.failures.length > 0 ? ` 有 ${signal.pulse.failures.length} 項數據抓取失敗，沒有以其他來源代替。` : ''}
            </p>
          </>
        )}
      </PageSection>

      <PageSection title="支柱明細" subtitle="暫定分數只用有足夠數據的支柱計算；未採用的支柱保持空缺，不當零分。">
        <div className="aic-pillar-grid">
          <PillarList title={`${signal.ami.label_zh}（分數愈高，變現支持愈強）`} pillars={signal.pillars.ami} risk={false} />
          <PillarList title={`${signal.abri.label_zh}（分數愈高，過熱風險愈大）`} pillars={signal.pillars.abri} risk />
        </div>
      </PageSection>

      <PageSection title="歷史讀數" subtitle="季度讀數按當時已公開的資料計算；每週紀錄由每週更新累積。">
        {quarters.length > 0 ? (
          <div className="aic-table-scroll">
            <table className="aic-table">
              <thead><tr><th>季度</th><th className="aic-numeric">變現指數</th><th className="aic-numeric">泡沫風險指數</th><th>候選週期</th></tr></thead>
              <tbody>
                {quarters.map((row) => (
                  <tr key={row.as_of_date}>
                    <th scope="row">{row.period}</th>
                    <td className="aic-numeric">{score(row.ami)}</td>
                    <td className="aic-numeric">{score(row.abri)}</td>
                    <td>{row.candidate_state ? STATE_LABEL[row.candidate_state] ?? row.candidate_state : '數據不足'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="table-hint">未有季度讀數。</p>}
        {weeklyRuns.length > 0 ? (
          <div className="aic-table-scroll">
            <table className="aic-table">
              <thead><tr><th>每週讀數日期</th><th className="aic-numeric">變現指數</th><th className="aic-numeric">泡沫風險指數</th><th className="aic-numeric">傾向級別</th><th>信心</th></tr></thead>
              <tbody>
                {[...weeklyRuns].slice(-12).reverse().map((run) => (
                  <tr key={run.as_of_date}>
                    <th scope="row">{run.as_of_date}</th>
                    <td className="aic-numeric">{score(run.ami)}</td>
                    <td className="aic-numeric">{score(run.abri)}</td>
                    <td className="aic-numeric">{run.stance_level == null ? '—' : `${run.stance_level > 0 ? '+' : ''}${run.stance_level}`}</td>
                    <td>{run.confidence === 'HIGH' ? '高' : run.confidence === 'MEDIUM' ? '中' : '低'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="table-hint">每週紀錄會在每週訊號檔成功讀取後開始累積。</p>}
      </PageSection>

      <PageSection title="人工智能分析" subtitle="把以上訊號與你的持倉交給模型寫成文字解讀；模型只可引用本頁的數據。">
        <label className="form-field">
          <span>想額外問的問題（可留空）</span>
          <textarea value={question} maxLength={500} rows={2} onChange={(event) => setQuestion(event.target.value)} placeholder="例如：我應否把新增資金投入半導體？" />
        </label>
        <div className="button-row">
          <button className="button button-primary" disabled={busy !== ''} onClick={() => void call({ action: 'analyze', question }, 'analyze')}>
            {busy === 'analyze' ? '分析中，約需一分鐘…' : analysis ? '重新分析' : '開始分析'}
          </button>
        </div>
        {analysis ? (
          <DataCard className="aic-analysis" description={`產生時間：${formatDateTime(analysis.generatedAt)} · 所用讀數日期：${analysis.signalAsOf}${analysis.signalAsOf !== signal.as_of_date ? '（並非目前讀數，建議重新分析）' : ''}`}>
            {analysis.question ? <p className="table-hint">提問：{analysis.question}</p> : null}
            <div className="aic-analysis-text">{analysis.text}</div>
          </DataCard>
        ) : <p className="table-hint">尚未產生分析。</p>}
      </PageSection>

      <PageSection title="資料說明與限制" tone="neutral">
        <ul className="aic-notes">
          <li>{signal.disclaimer_zh}</li>
          <li>{signal.coverage_universe.note_zh}；不在名單內的持倉，訊號的代表性較低。</li>
          <li>正式指數須覆蓋率達六成才發布；目前變現指數覆蓋 {percent(signal.ami.formal_data_coverage, 1)}、泡沫風險指數覆蓋 {percent(signal.abri.formal_data_coverage, 1)}，正式分數均為空值。</li>
          <li>基本面最新季結日：{signal.freshness.fundamentals_latest_period_end ?? '未有'}；{signal.freshness.companies_total} 間公司中有 {signal.freshness.companies_current} 間屬現期數據。</li>
          <li>訊號產生時間：{formatDateTime(signal.generated_at)}（方法版本 {signal.methodology_version}）。</li>
        </ul>
      </PageSection>
    </div>
  );
}
