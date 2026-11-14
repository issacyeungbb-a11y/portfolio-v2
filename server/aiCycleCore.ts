// 人工智能週期頁面的純計算：訊號驗證、持倉分類、曝險、組合提示、分析提示詞。
// 此檔不讀寫資料庫、不連網，方便獨立測試。

import { convertToHKDValue, normalizeCurrencyCode } from '../src/lib/currency.js';
import type {
  AiCycleGuidanceItem,
  AiCycleSignal,
  AiCycleWeeklyRun,
  AiExposure,
  AiExposureHolding,
  AiLayerCode,
  AiLayerOption,
} from '../src/types/aiCycle';

export const AI_LAYER_OPTIONS: AiLayerOption[] = [
  { code: 'semiconductor', label: '半導體' },
  { code: 'infrastructure', label: '基建（伺服器、網絡、電力、數據中心）' },
  { code: 'cloud', label: '雲端平台' },
  { code: 'application', label: '應用與軟件' },
  { code: 'fund', label: '人工智能主題基金' },
  { code: 'other', label: '其他人工智能相關' },
  { code: 'none', label: '非人工智能' },
];

const LAYER_LABELS = Object.fromEntries(AI_LAYER_OPTIONS.map((item) => [item.code, item.label])) as Record<AiLayerCode, string>;
const AI_LAYER_CODES = new Set<string>(AI_LAYER_OPTIONS.map((item) => item.code));

// 監察系統涵蓋的十三間公司；訊號對這些持倉的代表性最高。
export const MONITORED_SYMBOLS = new Set([
  'MSFT', 'NVDA', 'PLTR', 'GOOGL', 'GOOG', 'AMZN', 'META', 'ORCL', 'AMD', 'AVGO', 'CRM', 'ADBE', 'NOW', 'WDAY',
]);

// 預設分類只收錄業務與人工智能價值鏈關係明確的常見代號；其餘一律視為未分類，
// 由使用者在頁面上自行指定，不作猜測。
const DEFAULT_LAYERS: Record<string, AiLayerCode> = {
  NVDA: 'semiconductor', AMD: 'semiconductor', AVGO: 'semiconductor', TSM: 'semiconductor', '2330.TW': 'semiconductor',
  ASML: 'semiconductor', MU: 'semiconductor', MRVL: 'semiconductor', ARM: 'semiconductor', AMAT: 'semiconductor',
  LRCX: 'semiconductor', KLAC: 'semiconductor', '0981.HK': 'semiconductor',
  SMCI: 'infrastructure', DELL: 'infrastructure', ANET: 'infrastructure', VRT: 'infrastructure', CRWV: 'infrastructure',
  EQIX: 'infrastructure', DLR: 'infrastructure',
  MSFT: 'cloud', AMZN: 'cloud', GOOGL: 'cloud', GOOG: 'cloud', ORCL: 'cloud', BABA: 'cloud', '9988.HK': 'cloud',
  META: 'application', PLTR: 'application', CRM: 'application', NOW: 'application', ADBE: 'application',
  WDAY: 'application', SNOW: 'application', '0700.HK': 'application', BIDU: 'application', '9888.HK': 'application',
  SMH: 'fund', SOXX: 'fund', SOXL: 'fund', BOTZ: 'fund', AIQ: 'fund', CHAT: 'fund',
};

const HK_PREFIX = /^(?:HK|HKEX|SEHK)[.:]/;
const US_PREFIX = /^(?:US|NASDAQ|NYSE|AMEX)[.:]/;
const JP_PREFIX = /^(?:JP|TSE)[.:]/;

/**
 * 把不同券商的寫法統一成一個代號：美股只留代號、港股為四位數加 .HK、日股加 .T。
 * 純數字代號港股與日股都會用，所以要靠持倉幣別分辨；幣別不明時按港股處理。
 */
export function normalizeAiSymbol(raw: string, currency = '') {
  let symbol = String(raw ?? '').trim().toUpperCase().replace(/\s+/g, '');
  if (!symbol) return '';
  let market = '';
  if (HK_PREFIX.test(symbol)) { market = 'HK'; symbol = symbol.replace(HK_PREFIX, ''); }
  else if (JP_PREFIX.test(symbol)) { market = 'JP'; symbol = symbol.replace(JP_PREFIX, ''); }
  else if (US_PREFIX.test(symbol)) { market = 'US'; symbol = symbol.replace(US_PREFIX, ''); }
  if (/\.(?:HK|HKG)$/.test(symbol)) { market = 'HK'; symbol = symbol.replace(/\.(?:HK|HKG)$/, ''); }
  else if (/\.(?:T|JP)$/.test(symbol)) { market = 'JP'; symbol = symbol.replace(/\.(?:T|JP)$/, ''); }
  else if (/\.US$/.test(symbol)) { market = 'US'; symbol = symbol.replace(/\.US$/, ''); }
  if (/^\d+$/.test(symbol)) {
    if (!market) market = normalizeCurrencyCode(currency) === 'JPY' ? 'JP' : 'HK';
    if (market === 'JP') return `${symbol}.T`;
    if (market === 'HK') return `${String(Number(symbol)).padStart(4, '0')}.HK`;
  }
  return symbol;
}

export function sanitizeOverrides(raw: unknown): Record<string, AiLayerCode> {
  const output: Record<string, AiLayerCode> = {};
  if (!raw || typeof raw !== 'object') return output;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const symbol = normalizeAiSymbol(key);
    if (symbol && typeof value === 'string' && AI_LAYER_CODES.has(value)) output[symbol] = value as AiLayerCode;
  }
  return output;
}

export function classifyAiHolding(symbol: string, overrides: Record<string, AiLayerCode> = {}, currency = '') {
  const normalized = normalizeAiSymbol(symbol, currency);
  if (overrides[normalized]) return { layer: overrides[normalized], classifiedBy: 'override' as const };
  if (DEFAULT_LAYERS[normalized]) return { layer: DEFAULT_LAYERS[normalized], classifiedBy: 'default' as const };
  return { layer: 'none' as AiLayerCode, classifiedBy: 'unclassified' as const };
}

export interface AiCycleHoldingInput {
  id: string;
  symbol: string;
  name: string;
  assetType: string;
  accountSource: string;
  currency: string;
  marketValue: number;
}

export function computeAiExposure(
  holdings: AiCycleHoldingInput[],
  overrides: Record<string, AiLayerCode> = {},
  fxRates?: Record<string, number>,
): AiExposure {
  const rows = holdings.map((holding) => {
    const { layer, classifiedBy } = classifyAiHolding(holding.symbol, overrides, holding.currency);
    const symbol = normalizeAiSymbol(holding.symbol, holding.currency);
    return {
      id: holding.id, symbol: symbol || holding.symbol, name: holding.name, assetType: holding.assetType,
      accountSource: holding.accountSource,
      valueHKD: convertToHKDValue(Number(holding.marketValue) || 0, holding.currency, fxRates),
      shareOfTotal: 0, layer, layerLabel: LAYER_LABELS[layer], classifiedBy, monitored: MONITORED_SYMBOLS.has(symbol),
    } satisfies AiExposureHolding;
  });
  const totalValueHKD = rows.reduce((sum, row) => sum + row.valueHKD, 0);
  for (const row of rows) row.shareOfTotal = totalValueHKD > 0 ? row.valueHKD / totalValueHKD : 0;
  const ai = rows.filter((row) => row.layer !== 'none' && row.valueHKD > 0).sort((a, b) => b.valueHKD - a.valueHKD);
  const aiValueHKD = ai.reduce((sum, row) => sum + row.valueHKD, 0);
  const layers = AI_LAYER_OPTIONS.filter((option) => option.code !== 'none').map((option) => {
    const members = ai.filter((row) => row.layer === option.code);
    const valueHKD = members.reduce((sum, row) => sum + row.valueHKD, 0);
    return {
      code: option.code, label: option.label, valueHKD, count: members.length,
      shareOfTotal: totalValueHKD > 0 ? valueHKD / totalValueHKD : 0,
      shareOfAi: aiValueHKD > 0 ? valueHKD / aiValueHKD : 0,
    };
  }).filter((layer) => layer.count > 0);
  // 未分類的股票及基金列為候選，讓使用者決定是否歸入人工智能相關。
  const candidates = rows
    .filter((row) => row.layer === 'none' && row.valueHKD > 0 && (row.assetType === 'stock' || row.assetType === 'etf'))
    .sort((a, b) => b.valueHKD - a.valueHKD);
  return {
    totalValueHKD, aiValueHKD, aiShare: totalValueHKD > 0 ? aiValueHKD / totalValueHKD : 0,
    fxSource: fxRates ? 'persisted' : 'default', layers, holdings: ai, candidates,
    monitoredCount: ai.filter((row) => row.monitored).length,
    unmonitoredCount: ai.filter((row) => !row.monitored).length,
  };
}

// 組合提示用的參考門檻（佔總資產比例）。屬經驗門檻，並非監察系統的輸出。
export const EXPOSURE_BANDS = { moderate: 0.10, elevated: 0.25, concentrated: 0.40, singleName: 0.10, layerDominance: 0.70 };

const percent = (value: number) => `${(value * 100).toFixed(1)}%`;

export function buildAiCycleGuidance(signal: AiCycleSignal, exposure: AiExposure): AiCycleGuidanceItem[] {
  const items: AiCycleGuidanceItem[] = [];
  const level = signal.stance.level;
  const share = exposure.aiShare;
  const shareText = percent(share);

  if (exposure.holdings.length === 0) {
    items.push({
      tone: 'neutral', title: '未有人工智能相關持倉',
      text: '組合內未有被歸類為人工智能相關的持倉，板塊訊號暫時只作背景參考。如分類有遺漏，可在下方「未分類的股票及基金」更正。',
    });
  } else if (level === null) {
    items.push({
      tone: 'neutral', title: '暫無加減碼傾向',
      text: `監察系統本次未能給出暫定讀數；你的人工智能佔比為 ${shareText}，請按原有計劃處理。`,
    });
  } else if (level <= -2) {
    items.push(share >= EXPOSURE_BANDS.moderate
      ? { tone: 'danger', title: '訊號屬明顯減碼', text: `你的人工智能佔比為 ${shareText}。可考慮分批降低，先處理佔比最大的項目；新增資金不宜投入此板塊。` }
      : { tone: 'caution', title: '訊號屬明顯減碼', text: `你的人工智能佔比只有 ${shareText}，影響有限；避免加碼即可。` });
  } else if (level === -1) {
    items.push(share >= EXPOSURE_BANDS.elevated
      ? { tone: 'caution', title: '訊號偏向減碼，而佔比偏高', text: `你的人工智能佔比為 ${shareText}。新增資金宜暫緩投入此板塊，並可為最大的持倉預先訂立分批減持的條件。` }
      : { tone: 'caution', title: '訊號偏向減碼', text: `你的人工智能佔比為 ${shareText}，未算偏高；維持現狀、避免加碼即可。` });
  } else if (level === 0) {
    items.push(share >= EXPOSURE_BANDS.concentrated
      ? { tone: 'caution', title: '訊號中性，但佔比已高度集中', text: `你的人工智能佔比為 ${shareText}。集中度本身已是主要風險，不宜再加。` }
      : { tone: 'neutral', title: '訊號中性', text: `你的人工智能佔比為 ${shareText}。維持現有部署，毋須因本週讀數調整。` });
  } else if (share >= EXPOSURE_BANDS.concentrated) {
    items.push({ tone: 'caution', title: '訊號偏向加碼，但佔比已高度集中', text: `你的人工智能佔比已達 ${shareText}，加碼空間有限；訊號轉好並不等於應該提高集中度。` });
  } else if (share >= EXPOSURE_BANDS.elevated) {
    items.push({ tone: 'neutral', title: '訊號偏向加碼，佔比已不低', text: `你的人工智能佔比為 ${shareText}。如要增持，宜小額分批，並以 ${percent(EXPOSURE_BANDS.concentrated)} 為參考上限。` });
  } else {
    items.push({
      tone: 'positive', title: level >= 2 ? '訊號屬明顯加碼，佔比仍有空間' : '訊號偏向加碼，佔比仍有空間',
      text: `你的人工智能佔比為 ${shareText}。如要增持，宜分批進行，並以 ${percent(EXPOSURE_BANDS.elevated)} 為參考上限。`,
    });
  }

  const largest = exposure.holdings[0];
  if (largest && largest.shareOfTotal >= EXPOSURE_BANDS.singleName) {
    items.push({
      tone: 'caution', title: '單一持倉比重偏高',
      text: `${largest.symbol} 佔總資產 ${percent(largest.shareOfTotal)}。板塊訊號並不涵蓋個別公司的風險，單一持倉的波動可以遠大於板塊。`,
    });
  }
  const dominant = exposure.layers.find((layer) => layer.shareOfAi >= EXPOSURE_BANDS.layerDominance);
  if (dominant && exposure.holdings.length > 1) {
    items.push({
      tone: 'neutral', title: '集中在價值鏈的單一環節',
      text: `人工智能持倉中有 ${percent(dominant.shareOfAi)} 集中在「${dominant.label}」。該環節一旦轉弱，其他環節未必能夠抵銷。`,
    });
  }
  if (exposure.unmonitoredCount > 0) {
    items.push({
      tone: 'neutral', title: '部分持倉不在監察範圍',
      text: `有 ${exposure.unmonitoredCount} 項人工智能持倉不屬於監察系統涵蓋的十三間公司，訊號對這些持倉的代表性較低。`,
    });
  }
  if (signal.freshness.stale) {
    items.push({
      tone: 'caution', title: '基本面數據已過期',
      text: `${signal.freshness.stale_reason_zh ?? '最新一季業績尚未入庫'}。以上提示只宜作背景參考。`,
    });
  } else if (signal.stance.confidence === 'LOW') {
    items.push({ tone: 'caution', title: '本次信心屬低', text: `${signal.stance.confidence_notes_zh.join('；')}。以上提示只宜作背景參考。` });
  }
  return items;
}

// ---------------------------------------------------------------------------
// 訊號驗證
// ---------------------------------------------------------------------------

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireScore(value: unknown, label: string) {
  if (value === null) return;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) {
    throw new Error(`訊號檔的${label}分數無效。`);
  }
}

/** 只接受結構完整的訊號；任何欄位不符即拒絕，不會局部採用。 */
export function parseAiCycleSignal(raw: unknown): AiCycleSignal {
  if (!isRecord(raw)) throw new Error('訊號檔不是有效的資料物件。');
  if (raw.schema_version !== 1) throw new Error(`不支援的訊號檔版本：${String(raw.schema_version)}。`);
  if (typeof raw.as_of_date !== 'string' || !ISO_DATE.test(raw.as_of_date)) throw new Error('訊號檔缺少有效的讀數日期。');
  if (typeof raw.generated_at !== 'string' || Number.isNaN(Date.parse(raw.generated_at))) throw new Error('訊號檔缺少有效的產生時間。');
  for (const key of ['ami', 'abri'] as const) {
    const index = raw[key];
    if (!isRecord(index)) throw new Error(`訊號檔缺少 ${key} 讀數。`);
    requireScore(index.score, key === 'ami' ? '變現指數' : '泡沫風險指數');
    if (typeof index.weight_covered !== 'number' || index.weight_covered < 0 || index.weight_covered > 1.0001) {
      throw new Error(`訊號檔的 ${key} 已覆蓋權重無效。`);
    }
    if (!Array.isArray(index.pillars_used) || !Array.isArray(index.pillars_not_used)) throw new Error(`訊號檔的 ${key} 支柱清單無效。`);
  }
  const stance = raw.stance;
  if (!isRecord(stance) || typeof stance.code !== 'string' || typeof stance.label_zh !== 'string') throw new Error('訊號檔缺少加減碼傾向。');
  if (stance.level !== null && (typeof stance.level !== 'number' || !Number.isInteger(stance.level) || Math.abs(stance.level) > 2)) {
    throw new Error('訊號檔的加減碼級別無效。');
  }
  if (!['LOW', 'MEDIUM', 'HIGH'].includes(String(stance.confidence))) throw new Error('訊號檔的信心級別無效。');
  if (!Array.isArray(stance.reasons_zh) || !Array.isArray(stance.confidence_notes_zh) || !Array.isArray(stance.caps_zh)) {
    throw new Error('訊號檔的傾向理由無效。');
  }
  const ami = raw.ami as Record<string, unknown>;
  const abri = raw.abri as Record<string, unknown>;
  if (stance.level !== null && (ami.score === null || abri.score === null)) throw new Error('訊號檔有傾向級別但缺少暫定分數。');
  const pillars = raw.pillars;
  if (!isRecord(pillars) || !Array.isArray(pillars.ami) || !Array.isArray(pillars.abri)) throw new Error('訊號檔缺少支柱明細。');
  for (const pillar of [...pillars.ami, ...pillars.abri]) {
    if (!isRecord(pillar) || typeof pillar.code !== 'string') throw new Error('訊號檔的支柱明細無效。');
    requireScore(pillar.score, `支柱 ${pillar.code} `);
  }
  if (!isRecord(raw.cycle)) throw new Error('訊號檔缺少週期讀數。');
  const pulse = raw.pulse;
  if (!isRecord(pulse) || !['OK', 'PARTIAL', 'UNAVAILABLE'].includes(String(pulse.status)) || !Array.isArray(pulse.macro) || !Array.isArray(pulse.flags)) {
    throw new Error('訊號檔的每週脈搏無效。');
  }
  if (!isRecord(raw.freshness) || typeof raw.freshness.stale !== 'boolean') throw new Error('訊號檔缺少新鮮度資料。');
  if (!Array.isArray(raw.history)) throw new Error('訊號檔缺少歷史讀數。');
  return raw as unknown as AiCycleSignal;
}

export function parseAiCycleWeeklyRuns(raw: unknown): AiCycleWeeklyRun[] {
  if (!isRecord(raw) || !Array.isArray(raw.runs)) return [];
  return raw.runs.filter((run): run is AiCycleWeeklyRun =>
    isRecord(run) && typeof run.as_of_date === 'string' && ISO_DATE.test(run.as_of_date) && typeof run.stance_code === 'string',
  );
}

/** 新訊號的產生時間不可早於已儲存的訊號，避免舊檔覆蓋新檔。 */
export function isNewerSignal(candidate: AiCycleSignal, stored: AiCycleSignal | null) {
  if (!stored) return true;
  return Date.parse(candidate.generated_at) >= Date.parse(stored.generated_at);
}

export function signalAgeDays(signal: AiCycleSignal, now = new Date()) {
  const asOf = Date.parse(`${signal.as_of_date}T00:00:00Z`);
  return Math.max(0, Math.floor((now.getTime() - asOf) / 86_400_000));
}

// 每週更新一次；超過十日未見新訊號，視為每週工作失效。
export const SIGNAL_OVERDUE_DAYS = 10;

// ---------------------------------------------------------------------------
// 分析提示詞
// ---------------------------------------------------------------------------

export const AI_CYCLE_ANALYSIS_SYSTEM_PROMPT = [
  '你是一名審慎的投資組合分析員，為一位個人投資者解讀「人工智能產業週期」訊號與其持倉的關係。',
  '必須遵守：',
  '1. 全文使用書面中文，不可夾雜英文；公司以股票代號稱呼即可。',
  '2. 只可引用輸入資料內的數字與結論，不可加入輸入以外的新聞、估值、價格或預測。',
  '3. 訊號是整個板塊的季度滯後參考，不是個別股票的買賣訊號，亦不是價格預測；不可把它說成確定的結論。',
  '4. 如訊號信心屬低或基本面數據已過期，必須在開首說明，並相應降低結論的強度。',
  '5. 照實說，不要美化；資料不足以支持的判斷，直接說明無法判斷。',
  '6. 不要建議具體買賣價位或股數。',
  '輸出格式（純文字，使用以下五個標題，每個標題獨佔一行並以【】包住）：',
  '【一句總結】',
  '【週期位置】（變現與泡沫風險兩個讀數各自說明甚麼、缺了哪些支柱、動量方向）',
  '【對我持倉的含義】（引用人工智能佔比、最大持倉、所屬環節）',
  '【可考慮的做法】（分別說明在甚麼情況下加碼、持有、減碼才合理，並指出本次讀數較接近哪一種）',
  '【資料限制】',
  '全文不超過七百字。',
].join('\n');

export function buildAiCycleAnalysisPrompt(signal: AiCycleSignal, exposure: AiExposure, guidance: AiCycleGuidanceItem[], question = '') {
  const round = (value: number) => Math.round(value * 1000) / 1000;
  const input = {
    讀數日期: signal.as_of_date,
    加減碼傾向: {
      結論: signal.stance.label_zh, 級別: signal.stance.level, 信心: signal.stance.confidence_zh,
      理由: signal.stance.reasons_zh, 信心說明: signal.stance.confidence_notes_zh, 上限說明: signal.stance.caps_zh,
    },
    變現指數: {
      暫定分數: signal.ami.score, 已覆蓋權重: signal.ami.weight_covered, 兩季變化: signal.ami.change_2q, 四季變化: signal.ami.change_4q,
      未採用支柱: signal.ami.pillars_not_used.map((item) => `${item.label_zh}：${item.reason_zh ?? ''}`),
    },
    泡沫風險指數: {
      暫定分數: signal.abri.score, 已覆蓋權重: signal.abri.weight_covered, 兩季變化: signal.abri.change_2q, 四季變化: signal.abri.change_4q,
      未採用支柱: signal.abri.pillars_not_used.map((item) => `${item.label_zh}：${item.reason_zh ?? ''}`),
    },
    候選週期: signal.cycle.candidate_state_zh,
    正式指數狀態: '覆蓋率未達六成，正式分數為空值；以上均為暫定讀數',
    支柱分數: [...signal.pillars.ami, ...signal.pillars.abri]
      .filter((pillar) => pillar.used_in_provisional)
      .map((pillar) => ({ 支柱: pillar.label_zh, 分數: pillar.score, 來源級別: pillar.source_tier })),
    每週脈搏: signal.pulse.status === 'UNAVAILABLE' ? '本次未能取得' : {
      觀察名單: signal.pulse.basket, 宏觀: signal.pulse.macro.map((item) => ({ 項目: item.label_zh, 數值: item.value, 四週變化: item.change_4w, 日期: item.date })),
      警示: signal.pulse.flags.map((flag) => flag.label_zh),
    },
    基本面新鮮度: { 已過期: signal.freshness.stale, 說明: signal.freshness.stale_reason_zh, 最新季結日: signal.freshness.fundamentals_latest_period_end },
    涵蓋範圍: signal.coverage_universe.note_zh,
    我的持倉: {
      人工智能佔總資產: round(exposure.aiShare),
      按環節: exposure.layers.map((layer) => ({ 環節: layer.label, 佔總資產: round(layer.shareOfTotal), 佔人工智能持倉: round(layer.shareOfAi), 數目: layer.count })),
      持倉: exposure.holdings.slice(0, 20).map((holding) => ({ 代號: holding.symbol, 環節: holding.layerLabel, 佔總資產: round(holding.shareOfTotal), 屬監察範圍: holding.monitored })),
    },
    系統規則提示: guidance.map((item) => `${item.title}：${item.text}`),
  };
  return [
    '以下是本週的訊號與我的持倉資料（比例以小數表示）：',
    JSON.stringify(input, null, 1),
    question.trim() ? `我另外想知道：${question.trim().slice(0, 500)}` : '',
    '請按系統指示的格式作答。',
  ].filter(Boolean).join('\n\n');
}
