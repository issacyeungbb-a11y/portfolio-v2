import { createHash } from 'node:crypto';

import { GoogleGenAI } from '@google/genai';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';

import { getFirebaseAdminDb } from './firebaseAdmin.js';
import {
  getAnalyzePortfolioErrorResponse,
  runPortfolioAnalysisRequest,
} from './analyzePortfolio.js';
// Runtime note:
// Vercel API routes currently import `server/scheduledAnalysis.js` directly.
// When you edit this file, you must keep `server/scheduledAnalysis.js` in sync
// until the runtime architecture is unified to a single maintained source.
import {
  compareSnapshots,
  selectRecentDistinctMonthlySnapshots,
  type SnapshotComparisonSource,
} from './snapshotComparison.js';
import { readAdminPortfolioAssets } from './portfolioSnapshotAdmin.js';
import { buildReportAllocationSummaryFromHoldings } from '../src/lib/portfolio/reportAllocationSummary.js';
import {
  convertToHKDValue,
  normalizeCurrencyCode,
} from '../src/lib/currency.js';
import type {
  AnalysisCategory,
  AnalysisPromptSettings,
  AssetType,
  ReportDataQualitySummary,
  ReportFactsPayload,
  ReportAllocationSummary,
  SnapshotFxRatesUsed,
} from '../src/types/portfolio';
import type {
  PortfolioAnalysisModel,
  PortfolioAnalysisRequest,
  PortfolioAnalysisResponse,
} from '../src/types/portfolioAnalysis.js';

const SHARED_PORTFOLIO_COLLECTION = 'portfolio';
const SHARED_PORTFOLIO_DOC_ID = 'app';
const MONTHLY_ROUTE = '/api/cron-monthly-analysis' as const;
const QUARTERLY_ROUTE = '/api/cron-quarterly-report' as const;
const DEFAULT_DIAGNOSTIC_MODEL = 'claude-opus-4-7' as const;
const DEFAULT_DIAGNOSTIC_FALLBACK_MODEL = 'gemini-3.1-pro-preview' as const;
const PREFERRED_GROUNDED_SEARCH_MODEL = 'gemini-2.5-flash' as const;
const GROUNDED_SEARCH_FALLBACK_MODELS = ['gemini-2.5-pro', 'gemini-3.1-pro-preview'] as const;
const MONTHLY_MANUAL_RELEASE_HOUR_HKT = 8;
const QUARTERLY_MANUAL_RELEASE_HOUR_HKT = 9;
const MONTHLY_BASELINE_SNAPSHOT_TOLERANCE_DAYS = 5;
export const SCHEDULED_ANALYSIS_LOGIC_VERSION = '2026-05-01-p0-round3';
const REPORT_PROMPT_VERSION = '2026-05-01-p0-round3';

type AdminAsset = Awaited<ReturnType<typeof readAdminPortfolioAssets>>[number];
type ScheduledCategory = Extract<AnalysisCategory, 'asset_analysis' | 'asset_report'>;

interface SnapshotDocument {
  id?: string;
  date: string;
  totalValueHKD: number;
  netExternalFlowHKD?: number;
  snapshotQuality?: 'strict' | 'fallback';
  coveragePct?: number;
  fallbackAssetCount?: number;
  missingAssetCount?: number;
  fxSource?: 'cron_pipeline' | 'persisted' | 'live' | 'unknown';
  fxRatesUsed?: SnapshotFxRatesUsed;
  holdings: SnapshotComparisonSource['holdings'];
}

class ScheduledAnalysisError extends Error {
  status: number;

  constructor(message: string, status = 500) {
    super(message);
    this.name = 'ScheduledAnalysisError';
    this.status = status;
  }
}

function getGeminiApiKey() {
  const apiKey = process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim();

  if (!apiKey) {
    throw new ScheduledAnalysisError(
      '未設定 GEMINI_API_KEY 或 GOOGLE_API_KEY，暫時無法執行自動分析。',
      500,
    );
  }

  return apiKey;
}

function getScheduledAnalysisModel(): PortfolioAnalysisModel {
  return process.env.ANTHROPIC_API_KEY?.trim()
    ? DEFAULT_DIAGNOSTIC_MODEL
    : DEFAULT_DIAGNOSTIC_FALLBACK_MODEL;
}

function getAssetMarketValueHKD(asset: Pick<AdminAsset, 'quantity' | 'currentPrice' | 'currency'>) {
  return convertToHKDValue(asset.quantity * asset.currentPrice, asset.currency);
}

function getAssetCostValueHKD(asset: Pick<AdminAsset, 'quantity' | 'averageCost' | 'currency'>) {
  return convertToHKDValue(asset.quantity * asset.averageCost, asset.currency);
}

function getHongKongDate(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Hong_Kong',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function getHongKongYearMonthLabel(date = new Date()) {
  const parts = new Intl.DateTimeFormat('zh-HK', {
    timeZone: 'Asia/Hong_Kong',
    year: 'numeric',
    month: 'long',
  }).formatToParts(date);
  const year = parts.find((part) => part.type === 'year')?.value ?? '';
  const month = parts.find((part) => part.type === 'month')?.value ?? '';
  return `${year}年${month}`;
}

function getCurrentQuarterNumber(date = new Date()) {
  const month = Number(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Hong_Kong',
      month: 'numeric',
    }).format(date),
  );

  return Math.floor((month - 1) / 3) + 1;
}

function getHongKongQuarterLabel(date = new Date()) {
  return `${new Intl.DateTimeFormat('zh-HK', {
    timeZone: 'Asia/Hong_Kong',
    year: 'numeric',
  }).format(date)}年Q${getCurrentQuarterNumber(date)}`;
}

function getHongKongDateParts(date = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Hong_Kong',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const getPart = (type: Intl.DateTimeFormatPartTypes) =>
    Number(formatter.find((part) => part.type === type)?.value ?? '0');

  return {
    year: getPart('year'),
    month: getPart('month'),
    day: getPart('day'),
    hour: getPart('hour'),
  };
}

function getQuarterStartMonth(month: number) {
  return Math.floor((month - 1) / 3) * 3 + 1;
}

function canGenerateMonthlyAnalysisNow(date = new Date()) {
  const { day, hour } = getHongKongDateParts(date);
  return day > 1 || (day === 1 && hour >= MONTHLY_MANUAL_RELEASE_HOUR_HKT);
}

function canGenerateQuarterlyReportNow(date = new Date()) {
  const { month, day, hour } = getHongKongDateParts(date);
  const quarterStartMonth = getQuarterStartMonth(month);
  const isQuarterOpeningMonth = month === quarterStartMonth;
  return !isQuarterOpeningMonth || day > 1 || (day === 1 && hour >= QUARTERLY_MANUAL_RELEASE_HOUR_HKT);
}

async function hasExistingMonthlyAnalysis(title: string) {
  const snapshot = await getFirebaseAdminDb()
    .collection(SHARED_PORTFOLIO_COLLECTION)
    .doc(SHARED_PORTFOLIO_DOC_ID)
    .collection('analysisSessions')
    .where('category', '==', 'asset_analysis')
    .where('title', '==', title)
    .limit(1)
    .get();

  return !snapshot.empty;
}

async function hasExistingQuarterlyReport(quarter: string) {
  const snapshot = await getFirebaseAdminDb()
    .collection(SHARED_PORTFOLIO_COLLECTION)
    .doc(SHARED_PORTFOLIO_DOC_ID)
    .collection('quarterlyReports')
    .where('quarter', '==', quarter)
    .limit(1)
    .get();

  return !snapshot.empty;
}

function getPreviousQuarterEndDate(date = new Date()) {
  const { year, month } = getHongKongDateParts(date);
  const quarterStartMonth = getQuarterStartMonth(month);
  const previousQuarterEnd = new Date(year, quarterStartMonth - 1, 0);

  return [
    previousQuarterEnd.getFullYear(),
    String(previousQuarterEnd.getMonth() + 1).padStart(2, '0'),
    String(previousQuarterEnd.getDate()).padStart(2, '0'),
  ].join('-');
}

function getDefaultServerPromptSettings(): AnalysisPromptSettings {
  return {
    asset_analysis: [
      '你是每月資產分析助手，定位是監察、告警、下月行動。',
      '系統會在正文前顯示結構化「資產分佈總覽」圖像卡；你不要生成圖表、表格或圖表資料，也不要逐項重覆卡片上的百分比分布。',
      '你只需要承接系統提供的分佈判讀、持倉與快照對比，再結合外部背景摘要，寫出短而準、可落地監察的文字結論。',
      '固定輸出欄目，並按順序使用以下標題：',
      '1. 【本月一句總結】',
      '2. 【本月資產變化摘要】',
      '3. 【組合健康檢查】',
      '4. 【三個重點觀察】',
      '5. 【下月行動建議】',
      '每段要引用可核對的持倉、變化、資金流、幣別或風險；如果資料不足，要直說，並降低結論強度。',
    ].join('\n'),
    general_question: '你是投資組合對話助手，請直接回答我當次提出的問題。',
    asset_report: [
      '你是季度資產報告撰寫助手，定位是季度總結、歸因、正式歸檔。',
      '系統會在正文前顯示結構化「資產分佈總覽」圖像卡；你不要生成圖表、表格或圖表資料，也不要逐項重覆卡片上的百分比分布。',
      '你只需要承接系統提供的分佈判讀、季度對比、趨勢與外部背景，寫成可歸檔的正式文字。',
      '固定輸出欄目，並按順序使用以下標題：',
      '1. 【管理層摘要】',
      '2. 【季度總覽】',
      '3. 【資產配置分佈】',
      '4. 【幣別曝險】',
      '5. 【重點持倉分析】',
      '6. 【季度對比摘要】',
      '7. 【主要風險與集中度】',
      '8. 【下季觀察重點】',
      '寫作要短而準，避免空泛投資常識；如果資料不足，要直說。',
    ].join('\n'),
  };
}

function normalizePromptValue(value: unknown, fallback: string) {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

async function readAnalysisPromptSettings() {
  const db = getFirebaseAdminDb();
  const defaults = getDefaultServerPromptSettings();
  const snapshot = await db
    .collection(SHARED_PORTFOLIO_COLLECTION)
    .doc(SHARED_PORTFOLIO_DOC_ID)
    .collection('analysisSettings')
    .doc('prompts')
    .get();
  const value = snapshot.exists ? (snapshot.data() as Record<string, unknown>) : {};

  return {
    asset_analysis: normalizePromptValue(value.asset_analysis, defaults.asset_analysis),
    general_question: normalizePromptValue(value.general_question, defaults.general_question),
    asset_report: normalizePromptValue(value.asset_report, defaults.asset_report),
  } satisfies AnalysisPromptSettings;
}

function normalizeHoldingForSignature(asset: AdminAsset) {
  return {
    id: asset.id,
    name: asset.name,
    symbol: asset.symbol,
    assetType: asset.assetType,
    accountSource: asset.accountSource,
    currency: asset.currency,
    quantity: Number(asset.quantity.toFixed(8)),
    averageCost: Number(asset.averageCost.toFixed(8)),
    currentPrice: Number(asset.currentPrice.toFixed(8)),
  };
}

function createSnapshotHashFromAssets(assets: AdminAsset[]) {
  const normalized = [...assets]
    .map(normalizeHoldingForSignature)
    .sort((left, right) => left.id.localeCompare(right.id));

  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}

function createCacheKey(
  snapshotHash: string,
  category: AnalysisCategory,
  analysisModel: PortfolioAnalysisModel,
  analysisQuestion: string,
  analysisBackground: string,
) {
  return createHash('sha256')
    .update(
      JSON.stringify({
        snapshotHash,
        category,
        analysisModel,
        analysisQuestion: analysisQuestion.trim(),
        analysisBackground: analysisBackground.trim(),
      }),
    )
    .digest('hex');
}

export function buildAnalysisRequestFromAssets(params: {
  assets: AdminAsset[];
  category: AnalysisCategory;
  analysisQuestion: string;
  analysisBackground: string;
  analysisModel: PortfolioAnalysisModel;
  conversationContext?: string;
  snapshotHashOverride?: string;
}): PortfolioAnalysisRequest {
  const {
    assets,
    category,
    analysisQuestion,
    analysisBackground,
    analysisModel,
    conversationContext = '',
    snapshotHashOverride,
  } = params;
  const snapshotHash = snapshotHashOverride || createSnapshotHashFromAssets(assets);
  const cacheKey = createCacheKey(
    snapshotHash,
    category,
    analysisModel,
    analysisQuestion,
    analysisBackground,
  );
  const totalValueHKD = assets.reduce(
    (sum, asset) => sum + getAssetMarketValueHKD(asset),
    0,
  );
  const totalCostHKD = assets.reduce(
    (sum, asset) => sum + getAssetCostValueHKD(asset),
    0,
  );
  const typeBuckets = new Map<AssetType, number>();
  const currencyBuckets = new Map<string, number>();

  for (const asset of assets) {
    const valueHKD = getAssetMarketValueHKD(asset);
    typeBuckets.set(asset.assetType, (typeBuckets.get(asset.assetType) ?? 0) + valueHKD);
    const normalizedCurrency = normalizeCurrencyCode(asset.currency);
    currencyBuckets.set(normalizedCurrency, (currencyBuckets.get(normalizedCurrency) ?? 0) + valueHKD);
  }

  return {
    cacheKey,
    snapshotHash,
    category,
    analysisModel,
    analysisQuestion,
    analysisBackground,
    conversationContext,
    assetCount: assets.length,
    totalValueHKD,
    totalCostHKD,
    holdings: [...assets]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((asset) => ({
        id: asset.id,
        name: asset.name,
        ticker: asset.symbol,
        assetType: asset.assetType,
        accountSource: asset.accountSource,
        currency: asset.currency,
        quantity: asset.quantity,
        averageCost: asset.averageCost,
        currentPrice: asset.currentPrice,
        marketValue: asset.quantity * asset.currentPrice,
        marketValueHKD: getAssetMarketValueHKD(asset),
        costValue: asset.quantity * asset.averageCost,
        costValueHKD: getAssetCostValueHKD(asset),
      })),
    allocationsByType: [...typeBuckets.entries()]
      .map(([assetType, bucketTotal]) => ({
        assetType,
        totalValueHKD: bucketTotal,
        percentage: totalValueHKD === 0 ? 0 : (bucketTotal / totalValueHKD) * 100,
      }))
      .sort((left, right) => right.totalValueHKD - left.totalValueHKD),
    allocationsByCurrency: [...currencyBuckets.entries()]
      .map(([currency, bucketTotal]) => ({
        currency,
        totalValueHKD: bucketTotal,
        percentage: totalValueHKD === 0 ? 0 : (bucketTotal / totalValueHKD) * 100,
      }))
      .sort((left, right) => right.totalValueHKD - left.totalValueHKD),
  };
}

function getSearchTargetAssets(assets: AdminAsset[]) {
  return [...assets]
    .filter((asset) => asset.assetType === 'stock' || asset.assetType === 'etf')
    .sort((left, right) => getAssetMarketValueHKD(right) - getAssetMarketValueHKD(left))
    .slice(0, 12);
}

export function getSearchSummaryPrompt(params: {
  assets: AdminAsset[];
  mode: 'monthly' | 'quarterly';
}) {
  const searchTargets = getSearchTargetAssets(params.assets);
  const tickers = searchTargets.map((asset) => `${asset.symbol} (${asset.name})`).join('、') || '目前無主要股票或 ETF 持倉';
  const assetTypeSummary = [...new Set(params.assets.map((asset) => asset.assetType))].join('、');

  if (params.mode === 'quarterly') {
    return [
      '請使用 Google Search 幫我整理投資組合相關的外部市場摘要，只輸出摘要文字，不要做投資分析或建議。',
      '重點整理：',
      '1. 當季主要市場表現與宏觀環境',
      '2. 目前主要持倉近況',
      '3. 可能影響本季度投資組合的關鍵背景',
      `主要股票 / ETF 代碼：${tickers}`,
      `組合資產類別：${assetTypeSummary}`,
      '請用繁體中文，寫成可直接提供給另一個 AI 做季度報告的背景摘要。',
    ].join('\n');
  }

  return [
    '請使用 Google Search 幫我整理投資組合相關的外部市場背景，只輸出精簡摘要，不要做投資分析、買賣建議或價格預測。',
    '時間範圍：只總結過去一個月最重要的變化。',
    '請按以下結構輸出，每部分 1-3 句，避免長篇新聞摘要：',
    '1. 過去一個月市場主線',
    '2. 主要宏觀因素',
    '3. 股票 / ETF 影響',
    '4. 加密貨幣影響',
    '5. 現金 / 債券 / 利率影響',
    '6. 匯率與 JPY / USD / HKD 影響',
    '7. 下月值得觀察的 3-5 個外部因素',
    `主要股票 / ETF 代碼：${tickers}`,
    `組合資產類別：${assetTypeSummary}`,
    '請優先整理可能影響上述持倉與資產類別的共同背景，不要逐項覆述所有新聞。',
    '請用繁體中文，控制在 800-1200 中文字以內，寫成可直接提供給另一個 AI 做每月資產診斷的背景摘要。',
  ].join('\n');
}

function getSearchModelCandidates() {
  const preferred = process.env.GROUNDED_GEMINI_MODEL?.trim() || PREFERRED_GROUNDED_SEARCH_MODEL;
  return [preferred, ...GROUNDED_SEARCH_FALLBACK_MODELS.filter((model) => model !== preferred)];
}

async function generateGroundedSearchSummary(params: {
  assets: AdminAsset[];
  mode: 'monthly' | 'quarterly';
}) {
  const ai = new GoogleGenAI({ apiKey: getGeminiApiKey() });
  const prompt = getSearchSummaryPrompt(params);
  const candidates = getSearchModelCandidates();
  let lastError: unknown = null;

  for (const model of candidates) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: prompt,
        config: {
          maxOutputTokens: 1500,
          tools: [{ googleSearch: {} }],
        },
      });

      const summary = response.text?.trim();

      if (summary) {
        return {
          provider: 'google' as const,
          model,
          summary,
        };
      }

      console.warn(
        `[scheduledAnalysis] Gemini grounding returned empty summary for model ${model}; trying fallback if available.`,
      );
    } catch (error) {
      console.warn(
        `[scheduledAnalysis] Gemini grounding fallback from model ${model}: ${
          error instanceof Error ? error.message : 'unknown_error'
        }`,
      );
      lastError = error;
    }
  }

  return {
    provider: 'google' as const,
    model: candidates[0],
    summary: '未能取得有效的 Google Search 摘要；請以目前持倉與快照資料為主進行分析。',
    error: lastError instanceof Error ? lastError.message : 'grounding_failed',
  };
}

export function normalizeSnapshotDocument(
  value: Record<string, unknown>,
  snapshotId?: string,
): SnapshotDocument {
  const holdings = Array.isArray(value.holdings)
    ? value.holdings
        .filter((item) => typeof item === 'object' && item !== null)
        .map((item) => {
          const holding = item as Record<string, unknown>;

          return {
            assetId: typeof holding.assetId === 'string' ? holding.assetId : '',
            ticker:
              typeof holding.symbol === 'string'
                ? holding.symbol
                : typeof holding.ticker === 'string'
                  ? holding.ticker
                  : '',
            name:
              typeof holding.name === 'string'
                ? holding.name
                : typeof holding.assetName === 'string'
                  ? holding.assetName
                  : '',
            assetType:
              holding.assetType === 'stock' ||
              holding.assetType === 'etf' ||
              holding.assetType === 'bond' ||
              holding.assetType === 'crypto' ||
              holding.assetType === 'cash'
                ? holding.assetType
                : 'stock',
            currency:
              typeof holding.currency === 'string'
                ? normalizeCurrencyCode(holding.currency)
                : 'HKD',
            quantity: typeof holding.quantity === 'number' ? holding.quantity : 0,
            currentPrice: typeof holding.currentPrice === 'number' ? holding.currentPrice : 0,
            priceAsOf: typeof holding.priceAsOf === 'string' ? holding.priceAsOf : undefined,
            marketValueHKD: (() => {
              if (typeof holding.marketValueHKD === 'number') {
                return holding.marketValueHKD;
              }

              const currency =
                typeof holding.currency === 'string' ? holding.currency : 'HKD';

              if (typeof holding.marketValue === 'number') {
                return convertToHKDValue(holding.marketValue, currency);
              }

              const quantity = typeof holding.quantity === 'number' ? holding.quantity : 0;
              const currentPrice =
                typeof holding.currentPrice === 'number' ? holding.currentPrice : 0;
              return convertToHKDValue(quantity * currentPrice, currency);
            })(),
          };
        })
    : [];

  const fallbackTotalValueHKD = holdings.reduce((sum, holding) => sum + holding.marketValueHKD, 0);

  return {
    id: snapshotId,
    date: typeof value.date === 'string' ? value.date : '',
    totalValueHKD:
      typeof value.totalValueHKD === 'number' ? value.totalValueHKD : fallbackTotalValueHKD,
    netExternalFlowHKD:
      typeof value.netExternalFlowHKD === 'number' ? value.netExternalFlowHKD : undefined,
    snapshotQuality: value.snapshotQuality === 'fallback' ? 'fallback' : 'strict',
    coveragePct: typeof value.coveragePct === 'number' ? value.coveragePct : undefined,
    fallbackAssetCount:
      typeof value.fallbackAssetCount === 'number' ? value.fallbackAssetCount : undefined,
    missingAssetCount:
      typeof value.missingAssetCount === 'number' ? value.missingAssetCount : undefined,
    fxSource:
      value.fxSource === 'cron_pipeline' ||
      value.fxSource === 'persisted' ||
      value.fxSource === 'live'
        ? value.fxSource
        : 'unknown',
    fxRatesUsed:
      typeof value.fxRatesUsed === 'object' && value.fxRatesUsed !== null
        ? {
            USD:
              typeof (value.fxRatesUsed as Record<string, unknown>).USD === 'number'
                ? ((value.fxRatesUsed as Record<string, unknown>).USD as number)
                : undefined,
            JPY:
              typeof (value.fxRatesUsed as Record<string, unknown>).JPY === 'number'
                ? ((value.fxRatesUsed as Record<string, unknown>).JPY as number)
                : undefined,
            HKD:
              typeof (value.fxRatesUsed as Record<string, unknown>).HKD === 'number'
                ? ((value.fxRatesUsed as Record<string, unknown>).HKD as number)
                : undefined,
          }
        : undefined,
    holdings,
  };
}

function buildSnapshotFromAssets(
  assets: AdminAsset[],
  date: string,
): SnapshotComparisonSource {
  return {
    date,
    totalValueHKD: assets.reduce(
      (sum, asset) => sum + getAssetMarketValueHKD(asset),
      0,
    ),
    holdings: assets
      .slice()
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((asset) => ({
        assetId: asset.id,
        ticker: asset.symbol,
        name: asset.name,
        assetType: asset.assetType,
        currency: asset.currency,
        quantity: asset.quantity,
        currentPrice: asset.currentPrice,
        marketValueHKD: getAssetMarketValueHKD(asset),
      })),
  };
}

async function readSnapshotOnOrBefore(targetDate: string) {
  const db = getFirebaseAdminDb();
  const portfolioRef = db.collection(SHARED_PORTFOLIO_COLLECTION).doc(SHARED_PORTFOLIO_DOC_ID);
  const snapshotBefore = await portfolioRef
    .collection('portfolioSnapshots')
    .where('date', '<=', targetDate)
    .orderBy('date', 'desc')
    .limit(1)
    .get();

  if (!snapshotBefore.empty) {
    return normalizeSnapshotDocument(
      snapshotBefore.docs[0].data() as Record<string, unknown>,
      snapshotBefore.docs[0].id,
    );
  }

  return null;
}

async function readRecentSnapshotHistory(limitCount = 120) {
  const db = getFirebaseAdminDb();
  const snapshot = await db
    .collection(SHARED_PORTFOLIO_COLLECTION)
    .doc(SHARED_PORTFOLIO_DOC_ID)
    .collection('portfolioSnapshots')
    .orderBy('date', 'desc')
    .limit(limitCount)
    .get();

  return snapshot.docs.map((document) =>
    normalizeSnapshotDocument(document.data() as Record<string, unknown>, document.id),
  );
}

function getMonthKey(value: string) {
  return value.slice(0, 7);
}

async function readPreviousQuarterSnapshot() {
  const previousQuarterEndDate = getPreviousQuarterEndDate();
  return readSnapshotOnOrBefore(previousQuarterEndDate);
}

async function readLatestSnapshotMeta(date = getHongKongDate()) {
  return readSnapshotOnOrBefore(date);
}

export function getPreviousMonthStartDate(date = new Date()) {
  const { year, month } = getHongKongDateParts(date);
  const previousMonth = month === 1 ? 12 : month - 1;
  const previousYear = month === 1 ? year - 1 : year;
  return `${previousYear}-${String(previousMonth).padStart(2, '0')}-01`;
}

function getDateDistanceInDays(leftDate: string, rightDate: string) {
  const left = new Date(`${leftDate}T00:00:00Z`);
  const right = new Date(`${rightDate}T00:00:00Z`);
  return Math.abs(left.getTime() - right.getTime()) / (24 * 60 * 60 * 1000);
}

export function selectNearestSnapshotToDate(
  snapshots: SnapshotDocument[],
  targetDate: string,
  toleranceDays = MONTHLY_BASELINE_SNAPSHOT_TOLERANCE_DAYS,
) {
  const exactMonth = getMonthKey(targetDate);
  const candidates = snapshots
    .filter((snapshot) => snapshot.date && getDateDistanceInDays(snapshot.date, targetDate) <= toleranceDays)
    .sort((left, right) => {
      const distanceDelta =
        getDateDistanceInDays(left.date, targetDate) -
        getDateDistanceInDays(right.date, targetDate);

      if (distanceDelta !== 0) {
        return distanceDelta;
      }

      const leftSameMonth = getMonthKey(left.date) === exactMonth ? 1 : 0;
      const rightSameMonth = getMonthKey(right.date) === exactMonth ? 1 : 0;

      if (leftSameMonth !== rightSameMonth) {
        return rightSameMonth - leftSameMonth;
      }

      return left.date.localeCompare(right.date);
    });

  return candidates[0] ?? null;
}

async function readPreviousMonthSnapshot(date = new Date()) {
  const targetDate = getPreviousMonthStartDate(date);
  const history = await readRecentSnapshotHistory(120);
  return selectNearestSnapshotToDate(history, targetDate);
}

function getOldestPriceDate(assets: AdminAsset[]) {
  return assets
    .map((asset) => asset.lastPriceUpdatedAt ?? asset.priceAsOf ?? '')
    .filter(Boolean)
    .sort()[0];
}

function getStaleAssetCount(assets: AdminAsset[], now = new Date()) {
  return assets.filter((asset) => {
    const timestamp = asset.lastPriceUpdatedAt ?? asset.priceAsOf;
    if (!timestamp) {
      return true;
    }

    const updatedAt = new Date(timestamp);

    if (Number.isNaN(updatedAt.getTime())) {
      return true;
    }

    return now.getTime() - updatedAt.getTime() > 24 * 60 * 60 * 1000;
  }).length;
}

export function buildReportDataQualitySummary(params: {
  assets: AdminAsset[];
  snapshotMeta?: SnapshotDocument | null;
  now?: Date;
}): ReportDataQualitySummary {
  const now = params.now ?? new Date();
  const snapshotMeta = params.snapshotMeta ?? null;
  const staleAssetCount = getStaleAssetCount(params.assets, now);
  const coveragePct = snapshotMeta?.coveragePct;
  const fallbackAssetCount = snapshotMeta?.fallbackAssetCount;
  const missingAssetCount = snapshotMeta?.missingAssetCount;
  const warningMessages: string[] = [];

  if (snapshotMeta?.snapshotQuality === 'fallback') {
    warningMessages.push('快照使用 fallback 價格或降級資料。');
  }
  if (typeof coveragePct === 'number' && coveragePct < 100) {
    warningMessages.push(`價格覆蓋率只有 ${coveragePct}%。`);
  }
  if (typeof fallbackAssetCount === 'number' && fallbackAssetCount > 0) {
    warningMessages.push(`有 ${fallbackAssetCount} 項資產沿用 fallback 價格。`);
  }
  if (typeof missingAssetCount === 'number' && missingAssetCount > 0) {
    warningMessages.push(`有 ${missingAssetCount} 項資產缺少價格或快照資料。`);
  }
  if (staleAssetCount > 0) {
    warningMessages.push(`有 ${staleAssetCount} 項資產價格超過 24 小時未更新。`);
  }
  if (!snapshotMeta) {
    warningMessages.push('未能讀到最新 snapshot metadata，部分資料品質指標可能不足。');
  }

  let status: ReportDataQualitySummary['status'] = 'ok';
  if (
    warningMessages.length > 0 &&
    ((typeof missingAssetCount === 'number' && missingAssetCount > 0) ||
      (typeof coveragePct === 'number' && coveragePct < 80) ||
      !snapshotMeta)
  ) {
    status = 'warning';
  } else if (warningMessages.length > 0) {
    status = 'partial';
  }

  return {
    status,
    coveragePct,
    staleAssetCount,
    fallbackAssetCount,
    missingAssetCount,
    fxSource: snapshotMeta?.fxSource ?? 'unknown',
    fxRatesUsed: snapshotMeta?.fxRatesUsed,
    oldestPriceAsOf: getOldestPriceDate(params.assets),
    warningMessages,
  };
}

function formatReportDataQualitySummaryForPrompt(
  summary: ReportDataQualitySummary,
  title: '【資料品質檢查】' | '【資料品質與限制】',
) {
  const lines = [
    `${title}`,
    `- 狀態：${summary.status}`,
    `- 價格覆蓋率：${typeof summary.coveragePct === 'number' ? `${summary.coveragePct}%` : '未提供'}`,
    `- 匯率來源：${summary.fxSource ?? 'unknown'}`,
    `- 過期價格資產數：${summary.staleAssetCount}`,
  ];

  if (summary.oldestPriceAsOf) {
    lines.push(`- 最舊價格日期：${summary.oldestPriceAsOf}`);
  }

  if (typeof summary.fallbackAssetCount === 'number') {
    lines.push(`- fallback 價格資產數：${summary.fallbackAssetCount}`);
  }
  if (typeof summary.missingAssetCount === 'number') {
    lines.push(`- 缺失資產數：${summary.missingAssetCount}`);
  }

  if (summary.warningMessages.length > 0) {
    lines.push(...summary.warningMessages.map((message) => `- 限制：${message}`));
  } else {
    lines.push('- 資料完整，可作一般解讀。');
  }

  return lines.join('\n');
}

export function buildReportFactsPayload(params: {
  reportType: 'monthly' | 'quarterly';
  generatedAt: string;
  periodStartDate: string;
  periodEndDate: string;
  baselineSnapshot?: SnapshotDocument | null;
  currentSnapshot: SnapshotComparisonSource;
  totalCostHKD: number;
  allocationSummary: ReportAllocationSummary;
  allocationsByCurrency: PortfolioAnalysisRequest['allocationsByCurrency'];
  model: string;
  provider: 'google' | 'anthropic';
  snapshotHash: string;
  dataQualitySummary: ReportDataQualitySummary;
  topHoldingsByHKD: PortfolioAnalysisRequest['holdings'];
  comparison?: ReturnType<typeof compareSnapshots> | null;
  fxSource?: SnapshotDocument['fxSource'];
  fxRatesUsed?: SnapshotFxRatesUsed;
}) {
  const comparison = params.comparison ?? null;

  return {
    generatedAt: params.generatedAt,
    reportType: params.reportType,
    periodStartDate: params.periodStartDate,
    periodEndDate: params.periodEndDate,
    baselineSnapshotId: params.baselineSnapshot?.id,
    baselineSnapshotDate: params.baselineSnapshot?.date,
    currentSnapshotDate: params.currentSnapshot.date,
    totalValueHKD: params.currentSnapshot.totalValueHKD,
    totalCostHKD: params.totalCostHKD,
    netExternalFlowHKD: comparison?.totalValue.netExternalFlowHKD,
    netExternalFlowCoveragePct: comparison?.totalValue.netExternalFlowCoveragePct,
    investmentGainHKD: comparison?.totalValue.investmentGainHKD,
    investmentGainPercent: comparison?.totalValue.investmentGainPercent,
    cashFlowWarningMessage: comparison?.totalValue.cashFlowWarningMessage,
    fxRatesUsed: params.fxRatesUsed,
    fxSource: params.fxSource ?? 'unknown',
    dataQualitySummary: params.dataQualitySummary,
    topHoldingsByHKD: params.topHoldingsByHKD.slice(0, 10).map((holding) => ({
      ticker: holding.ticker,
      name: holding.name,
      currency: holding.currency,
      marketValueHKD: holding.marketValueHKD,
      marketValueLocal: holding.marketValue,
    })),
    allocationByType: params.allocationSummary.slices,
    allocationByCurrency: params.allocationsByCurrency,
    model: params.model,
    provider: params.provider,
    snapshotHash: params.snapshotHash,
    promptVersion: REPORT_PROMPT_VERSION,
  } satisfies ReportFactsPayload;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function sanitizeForFirestore<T>(value: T): T {
  if (value === undefined) {
    return undefined as T;
  }

  if (
    value === null ||
    typeof value === 'number' ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => sanitizeForFirestore(item))
      .filter((item) => item !== undefined) as T;
  }

  if (value instanceof Date) {
    return value;
  }

  if (!isPlainObject(value)) {
    return value;
  }

  const sanitizedEntries = Object.entries(value).flatMap(([key, nestedValue]) => {
    const sanitizedValue = sanitizeForFirestore(nestedValue);
    return sanitizedValue === undefined ? [] : [[key, sanitizedValue] as const];
  });

  return Object.fromEntries(sanitizedEntries) as T;
}

export function buildAnalysisSessionWritePayload(params: {
  response: PortfolioAnalysisResponse & { assetCount: number };
  title: string;
  allocationSummary?: ReportAllocationSummary;
  reportFactsPayload?: ReportFactsPayload;
}) {
  const sanitizedReportFactsPayload = params.reportFactsPayload
    ? sanitizeForFirestore(params.reportFactsPayload)
    : undefined;

  return {
    category: params.response.category,
    title: params.title,
    question: params.response.analysisQuestion,
    result: params.response.answer,
    model: params.response.model,
    provider: params.response.provider,
    snapshotHash: params.response.snapshotHash,
    delivery: 'scheduled',
    ...(params.allocationSummary ? { allocationSummary: params.allocationSummary } : {}),
    ...(sanitizedReportFactsPayload ? { reportFactsPayload: sanitizedReportFactsPayload } : {}),
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };
}

export function buildQuarterlyReportWritePayload(params: {
  quarter: string;
  generatedAt: string;
  report: string;
  currentSnapshotHash: string;
  previousSnapshotDate?: string;
  searchSummary: string;
  model: string;
  provider: string;
  allocationSummary?: ReportAllocationSummary;
  reportFactsPayload?: ReportFactsPayload;
}) {
  const sanitizedReportFactsPayload = params.reportFactsPayload
    ? sanitizeForFirestore(params.reportFactsPayload)
    : undefined;

  return {
    quarter: params.quarter,
    generatedAt: params.generatedAt,
    report: params.report,
    currentSnapshotHash: params.currentSnapshotHash,
    previousSnapshotDate: params.previousSnapshotDate ?? '',
    searchSummary: params.searchSummary,
    model: params.model,
    provider: params.provider,
    ...(params.allocationSummary ? { allocationSummary: params.allocationSummary } : {}),
    ...(sanitizedReportFactsPayload ? { reportFactsPayload: sanitizedReportFactsPayload } : {}),
    pdfUrl: '',
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };
}

function buildMonthlyTrendSnapshots(snapshots: SnapshotComparisonSource[]) {
  return selectRecentDistinctMonthlySnapshots(snapshots, 3);
}

function buildComparisonPromptSections(
  comparison: ReturnType<typeof compareSnapshots>,
  opts?: { limitHoldings?: number },
) {
  const limitHoldings = opts?.limitHoldings ?? 12;
  const holdingLines = comparison.holdingChanges
    .filter((change) => change.status !== 'unchanged' || Math.abs(change.contributionToPortfolioChange) > 0.01)
    .slice(0, limitHoldings)
    .map(
      (change) =>
        `- ${change.ticker} ${change.name}｜${change.status}｜` +
        `現值 ${change.currentValue.toFixed(2)} HKD｜前值 ${change.previousValue.toFixed(2)} HKD｜` +
        `倉位變化 ${change.quantityChange.toFixed(2)}｜價格變化 ${change.priceChangePercent.toFixed(1)}%｜` +
        `組合貢獻 ${change.contributionToPortfolioChange.toFixed(2)} HKD`,
    );

  const gainers = comparison.topMovers.gainers
    .map(
      (item) =>
        `- ${item.ticker}：${item.changePercent.toFixed(1)}%｜貢獻 ${item.contributionHKD.toFixed(2)} HKD`,
    )
    .join('\n');

  const losers = comparison.topMovers.losers
    .map(
      (item) =>
        `- ${item.ticker}：${item.changePercent.toFixed(1)}%｜拖累 ${item.contributionHKD.toFixed(2)} HKD`,
    )
    .join('\n');

  return [
    `【期間】${comparison.periodLabel}`,
    `【總資產變化】現值 ${comparison.totalValue.current.toFixed(2)} HKD｜前值 ${comparison.totalValue.previous.toFixed(2)} HKD｜` +
      `變化 ${comparison.totalValue.changeHKD.toFixed(2)} HKD｜${comparison.totalValue.changePercent.toFixed(1)}%`,
    typeof comparison.totalValue.netExternalFlowCoveragePct === 'number' &&
    comparison.totalValue.netExternalFlowCoveragePct < 80
      ? '【扣除資金流後變化】資金流覆蓋不足，暫不計扣除資金流後表現。'
      : typeof comparison.totalValue.netExternalFlowHKD === 'number' &&
          typeof comparison.totalValue.investmentGainHKD === 'number' &&
          typeof comparison.totalValue.investmentGainPercent === 'number'
        ? comparison.totalValue.cashFlowDataComplete
          ? `【扣除資金流後變化】淨入金／出金 ${comparison.totalValue.netExternalFlowHKD.toFixed(2)} HKD｜` +
            `投資表現 ${comparison.totalValue.investmentGainHKD.toFixed(2)} HKD｜${comparison.totalValue.investmentGainPercent.toFixed(1)}%`
          : `【扣除資金流後變化】資金流資料未完全覆蓋｜淨入金／出金 ${comparison.totalValue.netExternalFlowHKD.toFixed(2)} HKD｜` +
            `投資表現 ${comparison.totalValue.investmentGainHKD.toFixed(2)} HKD｜${comparison.totalValue.investmentGainPercent.toFixed(1)}%`
        : '【扣除資金流後變化】未能完整扣除入金／出金，以下只反映總資產變化。',
    `【資產類別變化】`,
    ...comparison.assetTypeChanges.map(
      (entry) =>
        `- ${entry.assetType}：${entry.previousPercent.toFixed(1)}% → ${entry.currentPercent.toFixed(1)}%（${entry.deltaPercent.toFixed(1)}pp）`,
    ),
    `【幣別曝險變化】`,
    ...comparison.currencyChanges.map(
      (entry) =>
        `- ${entry.currency}：${entry.previousPercent.toFixed(1)}% → ${entry.currentPercent.toFixed(1)}%（${entry.deltaPercent.toFixed(1)}pp）`,
    ),
    `【持倉變動】`,
    ...holdingLines,
    `【最大貢獻者】`,
    gainers || '- 無正貢獻持倉',
    `【最大拖累者】`,
    losers || '- 無負貢獻持倉',
  ].join('\n');
}

function formatReportAllocationSummaryForPrompt(summary: ReportAllocationSummary) {
  const sliceLines = summary.slices.map(
    (slice) =>
      `- ${slice.label}：${slice.percentage.toFixed(1)}%，${slice.totalValueHKD.toFixed(2)} HKD`,
  );
  const deltaLines = summary.deltas?.length
    ? summary.deltas.map((delta) => {
        const slice = summary.slices.find((item) => item.key === delta.key);
        const label = slice?.label ?? delta.key;
        return `- ${label}：${delta.deltaPercentagePoints >= 0 ? '+' : ''}${delta.deltaPercentagePoints.toFixed(1)}pp`;
      })
    : ['- 未有可比較的上期快照'];

  return [
    `【系統資產分佈總覽】截至 ${summary.asOfDate}`,
    `配置風格：${summary.styleTag}`,
    `提示標籤：${summary.warningTags.join('、') || '無'}`,
    `系統判讀：${summary.summarySentence ?? '未有判讀'}`,
    '目前分佈：',
    ...sliceLines,
    `${summary.comparisonLabel ?? '上期'}變化：`,
    ...deltaLines,
    '注意：以上分佈已由系統在圖像卡顯示，正文只可做判讀，不要重覆列出每個百分比。',
  ].join('\n');
}

export function buildMonthlyAnalysisQuestion(params: {
  comparison: ReturnType<typeof compareSnapshots> | null;
  allocationSummary: ReportAllocationSummary;
  dataQualitySummary: ReportDataQualitySummary;
}) {
  const comparisonText = params.comparison
    ? buildComparisonPromptSections(params.comparison, { limitHoldings: 12 })
    : '缺少基準 snapshot（上個月 1 號或合理容忍範圍內未找到）；請明確指出缺少基準 snapshot，並只根據目前持倉與系統分佈總覽做監察及下月行動建議，不要假設月度變化。';

  return [
    '請撰寫一份「每月資產分析」，定位係監察 / 告警 / 下月行動。',
    '你會同時收到：外部市場背景摘要、系統資產分佈總覽、月度對比、cash-flow adjusted return 與資料品質檢查。請把宏觀背景同我實際資產分佈、資產變化互相對照，而唔係分開各講各。',
    '資產分佈總覽已由系統用真實資料計算並顯示在正文前；不要輸出圖表資料、表格，亦不要逐項重覆百分比分布或列出所有持倉。',
    '必須按以下順序輸出，每段用【】做標題：',
    '【本月一句總結】（1 句；必須同時提及本月資產變化方向、主要宏觀 / 市場背景，以及組合最大風險或最重要機會）',
    '【本月資產變化摘要】（必須區分總資產變化、淨入金／出金、扣除資金流後表現、資金流覆蓋率、最大貢獻者 / 最大拖累者；如果回報集中於少數資產，要明確指出）',
    '【組合健康檢查】（承接系統分佈總覽，加入 risk-on / risk-off、現金 / 債券防守能力、幣別曝險判讀；如資料品質有限要主動收窄結論）',
    '【三個重點觀察】（剛好 3 點；每點都要用「宏觀背景 → 對我資產的影響 → 投資含義」格式，並引用持倉、金額、分佈或變化）',
    '【下月行動建議】（2-4 點，必須分成「必須跟進 / 可以考慮 / 暫時不建議」類型，全部都要寫明觸發條件；不要寫成直接買賣指令或確定性價格預測）',
    '',
    '規則：',
    '所有結論必須引用 input 內的資料；不要虛構新聞、估值或宏觀資料。',
    '如果 staleAssetCount > 0，要明確指出哪些結論受價格時效限制影響。',
    '如果 dataQualitySummary.status 係 partial 或 warning，組合健康檢查與下月行動建議要偏保守，避免下過強判斷。',
    '如果資金流覆蓋率唔係 100%，要保留限制提示，避免把所有升跌都當成投資回報。',
    '不要重覆 summary card 已顯示的百分比分布，只需輸出高價值觀察。',
    '每段短而準，繁體中文輸出，整份月報保持清晰可讀，不要寫成長篇文章。',
    '',
    formatReportAllocationSummaryForPrompt(params.allocationSummary),
    '',
    formatReportDataQualitySummaryForPrompt(params.dataQualitySummary, '【資料品質檢查】'),
    '',
    '對比數據：',
    comparisonText,
  ].join('\n');
}

function buildQuarterlyAnalysisQuestion(
  params: {
    currentComparison: ReturnType<typeof compareSnapshots> | null;
    trendComparisons: ReturnType<typeof compareSnapshots>[];
    allocationSummary: ReportAllocationSummary;
    dataQualitySummary: ReportDataQualitySummary;
  },
) {
  const { currentComparison, trendComparisons, allocationSummary, dataQualitySummary } = params;
  const currentComparisonText = currentComparison
    ? buildComparisonPromptSections(currentComparison, { limitHoldings: 12 })
    : '未有可比較的上季季末快照；請只根據目前持倉、系統分佈總覽與可用趨勢資料歸檔，不要假設季度變化。';
  const trendSections = trendComparisons
    .map(
      (comparison, index) =>
        [`【趨勢 ${index + 1}】`, buildComparisonPromptSections(comparison, { limitHoldings: 8 })].join('\n'),
    )
    .join('\n\n');

  return [
    '請撰寫一份「季度資產報告」，定位係總結 / 歸因 / 正式歸檔。',
    '資產分佈總覽已由系統用真實資料計算並顯示在正文前；不要輸出圖表資料、表格，亦不要逐項重覆百分比分布。',
    '必須按以下順序輸出，每段用【】做標題：',
    '【管理層摘要】',
    '【季度總覽】',
    '【資產配置分佈】',
    '【幣別曝險】',
    '【重點持倉分析】',
    '【季度對比摘要】（必須同時交代總資產變化、淨入金／出金、扣除資金流後變化；如資料不足要明確講限制）',
    '【主要風險與集中度】',
    '【下季觀察重點】',
    '',
    '規則：',
    '所有結論必須引用 input 內的資料；不要虛構新聞、估值或宏觀資料。',
    '不要重覆 summary card 已顯示的百分比分布，只需做判讀、歸因和歸檔摘要。',
    '短而準，繁體中文輸出；資料不足就直說。',
    '',
    formatReportAllocationSummaryForPrompt(allocationSummary),
    '',
    formatReportDataQualitySummaryForPrompt(dataQualitySummary, '【資料品質與限制】'),
    '',
    '今季 vs 上季對比數據：',
    currentComparisonText,
    '',
    '三個月趨勢數據：',
    trendSections || '未有足夠三個月趨勢資料。',
  ].join('\n');
}

async function saveScheduledAnalysis(
  response: PortfolioAnalysisResponse & { assetCount: number },
  title: string,
  allocationSummary?: ReportAllocationSummary,
  reportFactsPayload?: ReportFactsPayload,
) {
  const db = getFirebaseAdminDb();
  const portfolioRef = db.collection(SHARED_PORTFOLIO_COLLECTION).doc(SHARED_PORTFOLIO_DOC_ID);
  const sanitizedReportFactsPayload = reportFactsPayload
    ? sanitizeForFirestore(reportFactsPayload)
    : undefined;

  await portfolioRef.collection('analysisCache').doc(response.cacheKey).set(
    {
      cacheKey: response.cacheKey,
      snapshotHash: response.snapshotHash,
      category: response.category,
      provider: response.provider,
      model: response.model,
      analysisQuestion: response.analysisQuestion,
      analysisBackground: response.analysisBackground,
      delivery: 'scheduled',
      generatedAt: response.generatedAt,
      assetCount: response.assetCount,
      answer: response.answer,
      ...(allocationSummary ? { allocationSummary } : {}),
      ...(sanitizedReportFactsPayload ? { reportFactsPayload: sanitizedReportFactsPayload } : {}),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  await portfolioRef.collection('analysisSessions').add(
    buildAnalysisSessionWritePayload({
      response,
      title,
      allocationSummary,
      reportFactsPayload: sanitizedReportFactsPayload,
    }),
  );
}

async function saveQuarterlyReport(params: {
  quarter: string;
  generatedAt: string;
  report: string;
  currentSnapshotHash: string;
  previousSnapshotDate?: string;
  searchSummary: string;
  model: string;
  provider: string;
  allocationSummary?: ReportAllocationSummary;
  reportFactsPayload?: ReportFactsPayload;
}) {
  const db = getFirebaseAdminDb();

  await db
    .collection(SHARED_PORTFOLIO_COLLECTION)
    .doc(SHARED_PORTFOLIO_DOC_ID)
    .collection('quarterlyReports')
    .add(buildQuarterlyReportWritePayload(params));
}

async function runScheduledCategoryAnalysis(params: {
  category: ScheduledCategory;
  title: string;
  question: string;
  conversationContext: string;
  maxTokens: number;
  assets?: AdminAsset[];
}) {
  const assets = params.assets ?? await readAdminPortfolioAssets();

  if (assets.length === 0) {
    throw new ScheduledAnalysisError('目前沒有可分析的資產，已跳過自動分析。', 400);
  }

  const promptSettings = await readAnalysisPromptSettings();
  const request = buildAnalysisRequestFromAssets({
    assets,
    category: params.category,
    analysisQuestion: params.question,
    analysisBackground: promptSettings[params.category],
    analysisModel: getScheduledAnalysisModel(),
    conversationContext: params.conversationContext,
  });
  const response = await runPortfolioAnalysisRequest(request, {
    delivery: 'scheduled',
    maxTokens: params.maxTokens,
  });

  const payload = {
    ...response,
    assetCount: request.assetCount,
  };

  return {
    response: payload,
    request,
  };
}

export async function runMonthlyAssetAnalysis() {
  const assets = await readAdminPortfolioAssets();
  const currentSnapshot = buildSnapshotFromAssets(assets, getHongKongDate());
  const latestSnapshotMeta = await readLatestSnapshotMeta(currentSnapshot.date);
  const recentSnapshotHistory = await readRecentSnapshotHistory(120);
  const previousMonthSnapshot = await readPreviousMonthSnapshot();
  const dataQualitySummary = buildReportDataQualitySummary({
    assets,
    snapshotMeta: latestSnapshotMeta,
  });
  const allocationSummary = buildReportAllocationSummaryFromHoldings({
    holdings: currentSnapshot.holdings,
    asOfDate: currentSnapshot.date,
    basis: 'monthly',
    comparisonHoldings: previousMonthSnapshot?.holdings,
    comparisonLabel: previousMonthSnapshot ? '較上月月初基準' : undefined,
  });
  const searchSummary = await generateGroundedSearchSummary({
    assets,
    mode: 'monthly',
  });
  const title = `${getHongKongYearMonthLabel()}每月資產分析`;
  const comparison = previousMonthSnapshot
    ? compareSnapshots(currentSnapshot, previousMonthSnapshot, {
        periodSnapshots: recentSnapshotHistory,
      })
    : null;
  const comparisonText = comparison
    ? buildComparisonPromptSections(comparison, { limitHoldings: 12 })
    : `缺少基準 snapshot（目標 ${getPreviousMonthStartDate()}）。`;
  const question = buildMonthlyAnalysisQuestion({
    comparison,
    allocationSummary,
    dataQualitySummary,
  });
  const conversationContext = [
    'Gemini Google Search 摘要：',
    searchSummary.summary,
    '',
    formatReportAllocationSummaryForPrompt(allocationSummary),
    '',
    formatReportDataQualitySummaryForPrompt(dataQualitySummary, '【資料品質檢查】'),
    '',
    '月度對比資料：',
    comparisonText,
  ].join('\n');
  const { response, request } = await runScheduledCategoryAnalysis({
    category: 'asset_analysis',
    title,
    question,
    conversationContext,
    maxTokens: 3500,
    assets,
  });
  const reportFactsPayload = buildReportFactsPayload({
    reportType: 'monthly',
    generatedAt: response.generatedAt,
    periodStartDate: previousMonthSnapshot?.date ?? getPreviousMonthStartDate(),
    periodEndDate: currentSnapshot.date,
    baselineSnapshot: previousMonthSnapshot,
    currentSnapshot,
    totalCostHKD: request.totalCostHKD,
    allocationSummary,
    allocationsByCurrency: request.allocationsByCurrency,
    model: response.model,
    provider: response.provider,
    snapshotHash: response.snapshotHash,
    dataQualitySummary,
    topHoldingsByHKD: [...request.holdings].sort((left, right) => right.marketValueHKD - left.marketValueHKD),
    comparison,
    fxSource: latestSnapshotMeta?.fxSource,
    fxRatesUsed: latestSnapshotMeta?.fxRatesUsed,
  });
  await saveScheduledAnalysis(response, title, allocationSummary, reportFactsPayload);

  return {
    ok: true,
    category: 'asset_analysis' as const,
    title,
    model: response.model,
    provider: response.provider,
    searchModel: searchSummary.model,
    searchProvider: searchSummary.provider,
    generatedAt: response.generatedAt,
    snapshotHash: response.snapshotHash,
    cacheKey: response.cacheKey,
  };
}

export async function runManualMonthlyAssetAnalysis() {
  const title = `${getHongKongYearMonthLabel()}每月資產分析`;

  if (!canGenerateMonthlyAnalysisNow()) {
    throw new ScheduledAnalysisError(
      `每月資產分析會喺每月 1 號香港時間 ${String(MONTHLY_MANUAL_RELEASE_HOUR_HKT).padStart(2, '0')}:00 之後先可手動生成。`,
      400,
    );
  }

  if (await hasExistingMonthlyAnalysis(title)) {
    return {
      ok: true,
      skipped: true,
      category: 'asset_analysis' as const,
      title,
      route: MONTHLY_ROUTE,
      message: '今個月嘅每月資產分析已經生成，毋須重複建立。',
    };
  }

  const result = await runMonthlyAssetAnalysis();
  return {
    ...result,
    route: MONTHLY_ROUTE,
    message: '已完成每月資產分析。',
  };
}

export async function runQuarterlyAssetReport() {
  const assets = await readAdminPortfolioAssets();
  const currentSnapshot = buildSnapshotFromAssets(assets, getHongKongDate());
  const latestSnapshotMeta = await readLatestSnapshotMeta(currentSnapshot.date);
  const previousQuarterSnapshot = await readPreviousQuarterSnapshot();
  const recentSnapshotHistory = await readRecentSnapshotHistory(120);
  const dataQualitySummary = buildReportDataQualitySummary({
    assets,
    snapshotMeta: latestSnapshotMeta,
  });
  const allocationSummary = buildReportAllocationSummaryFromHoldings({
    holdings: currentSnapshot.holdings,
    asOfDate: currentSnapshot.date,
    basis: 'quarterly',
    comparisonHoldings: previousQuarterSnapshot?.holdings,
    comparisonLabel: previousQuarterSnapshot ? '較上季' : undefined,
  });
  const trendSnapshots = buildMonthlyTrendSnapshots([
    currentSnapshot,
    ...recentSnapshotHistory,
  ]);
  const trendComparisons =
    trendSnapshots.length >= 2
      ? trendSnapshots
          .slice(0, trendSnapshots.length - 1)
          .map((snapshot, index) =>
            compareSnapshots(snapshot, trendSnapshots[index + 1], {
              periodSnapshots: recentSnapshotHistory,
            }),
          )
      : [];
  const searchSummary = await generateGroundedSearchSummary({
    assets,
    mode: 'quarterly',
  });
  const title = `${getHongKongQuarterLabel()}資產報告`;
  const currentComparison = previousQuarterSnapshot
    ? compareSnapshots(currentSnapshot, previousQuarterSnapshot, {
        periodSnapshots: recentSnapshotHistory,
      })
    : null;
  const currentComparisonText = currentComparison
    ? buildComparisonPromptSections(currentComparison, { limitHoldings: 12 })
    : '未有可比較的上季季末快照。';
  const question = buildQuarterlyAnalysisQuestion({
    currentComparison,
    trendComparisons,
    allocationSummary,
    dataQualitySummary,
  });
  const currentSnapshotHash = createSnapshotHashFromAssets(assets);
  const conversationContext = [
    'Gemini Google Search 摘要：',
    searchSummary.summary,
    '',
    formatReportAllocationSummaryForPrompt(allocationSummary),
    '',
    formatReportDataQualitySummaryForPrompt(dataQualitySummary, '【資料品質與限制】'),
    '',
    '今季 vs 上季對比資料：',
    currentComparisonText,
    '',
    '三個月趨勢資料：',
    trendComparisons.length > 0
      ? trendComparisons
          .map((comparison, index) =>
            [`【趨勢 ${index + 1}】`, buildComparisonPromptSections(comparison, { limitHoldings: 8 })].join('\n'),
          )
          .join('\n\n')
      : '未有足夠三個月趨勢資料。',
  ].join('\n');
  const { response, request } = await runScheduledCategoryAnalysis({
    category: 'asset_report',
    title,
    question,
    conversationContext,
    maxTokens: 5000,
    assets,
  });
  const reportFactsPayload = buildReportFactsPayload({
    reportType: 'quarterly',
    generatedAt: response.generatedAt,
    periodStartDate: previousQuarterSnapshot?.date ?? getPreviousQuarterEndDate(),
    periodEndDate: currentSnapshot.date,
    baselineSnapshot: previousQuarterSnapshot,
    currentSnapshot,
    totalCostHKD: request.totalCostHKD,
    allocationSummary,
    allocationsByCurrency: request.allocationsByCurrency,
    model: response.model,
    provider: response.provider,
    snapshotHash: currentSnapshotHash || response.snapshotHash,
    dataQualitySummary,
    topHoldingsByHKD: [...request.holdings].sort((left, right) => right.marketValueHKD - left.marketValueHKD),
    comparison: currentComparison,
    fxSource: latestSnapshotMeta?.fxSource,
    fxRatesUsed: latestSnapshotMeta?.fxRatesUsed,
  });
  await saveScheduledAnalysis(response, title, allocationSummary, reportFactsPayload);

  await saveQuarterlyReport({
    quarter: getHongKongQuarterLabel(),
    generatedAt: response.generatedAt,
    report: response.answer,
    currentSnapshotHash,
    previousSnapshotDate: previousQuarterSnapshot?.date,
    searchSummary: searchSummary.summary,
    model: response.model,
    provider: response.provider,
    allocationSummary,
    reportFactsPayload,
  });

  return {
    ok: true,
    category: 'asset_report' as const,
    title,
    model: response.model,
    provider: response.provider,
    searchModel: searchSummary.model,
    searchProvider: searchSummary.provider,
    generatedAt: response.generatedAt,
    snapshotHash: currentSnapshotHash || response.snapshotHash,
    cacheKey: response.cacheKey,
    previousQuarterSnapshotDate: previousQuarterSnapshot?.date ?? '',
  };
}

export async function runManualQuarterlyAssetReport() {
  const quarter = getHongKongQuarterLabel();

  if (!canGenerateQuarterlyReportNow()) {
    throw new ScheduledAnalysisError(
      `季度報告會喺季度首日香港時間 ${String(QUARTERLY_MANUAL_RELEASE_HOUR_HKT).padStart(2, '0')}:00 之後先可手動生成。`,
      400,
    );
  }

  if (await hasExistingQuarterlyReport(quarter)) {
    return {
      ok: true,
      skipped: true,
      category: 'asset_report' as const,
      title: `${quarter}資產報告`,
      route: QUARTERLY_ROUTE,
      message: '今季季度報告已經生成，毋須重複建立。',
    };
  }

  const result = await runQuarterlyAssetReport();
  return {
    ...result,
    route: QUARTERLY_ROUTE,
    message: '已完成季度報告。',
  };
}

export function getScheduledAnalysisErrorResponse(
  error: unknown,
  route: typeof MONTHLY_ROUTE | typeof QUARTERLY_ROUTE,
) {
  if (error instanceof ScheduledAnalysisError) {
    return {
      status: error.status,
      body: {
        ok: false,
        route,
        message: error.message,
      },
    };
  }

  const formatted = getAnalyzePortfolioErrorResponse(error);
  return {
    status: formatted.status,
    body: {
      ...formatted.body,
      route,
    },
  };
}
