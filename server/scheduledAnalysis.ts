import { createHash } from 'node:crypto';

import { GoogleGenAI } from '@google/genai';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';

import { getFirebaseAdminDb } from './firebaseAdmin';
import {
  getAnalyzePortfolioErrorResponse,
  runPortfolioAnalysisRequest,
} from './analyzePortfolio';
import { readAdminPortfolioAssets } from './portfolioSnapshotAdmin';
import type {
  AnalysisCategory,
  AnalysisPromptSettings,
  AssetType,
  SnapshotHoldingPoint,
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
const DEFAULT_DIAGNOSTIC_MODEL = 'claude-opus-4-6' as const;
const PREFERRED_GROUNDED_SEARCH_MODEL = 'gemini-2.5-flash' as const;
const GROUNDED_SEARCH_FALLBACK_MODELS = ['gemini-2.5-pro', 'gemini-3.1-pro-preview'] as const;

type AdminAsset = Awaited<ReturnType<typeof readAdminPortfolioAssets>>[number];
type ScheduledCategory = Extract<AnalysisCategory, 'asset_analysis' | 'asset_report'>;

interface SnapshotDocument {
  id: string;
  date: string;
  capturedAt: string;
  totalValueHKD: number;
  holdings: SnapshotHoldingPoint[];
  reason?: string;
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

function convertToHKD(amount: number, currency: string) {
  const normalized = currency.trim().toUpperCase();

  if (normalized === 'USD') {
    return amount * 7.8;
  }

  if (normalized === 'JPY') {
    return amount * 0.052;
  }

  return amount;
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

function getPreviousQuarterEndDate(date = new Date()) {
  const hkNow = new Date(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Hong_Kong',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date),
  );
  const month = hkNow.getMonth() + 1;
  const year = hkNow.getFullYear();
  const previousQuarterEndMonth = month === 3 ? 12 : month - 3;
  const previousQuarterYear = month === 3 ? year - 1 : year;
  const endDay = new Date(previousQuarterYear, previousQuarterEndMonth, 0).getDate();

  return `${previousQuarterYear}-${String(previousQuarterEndMonth).padStart(2, '0')}-${String(endDay).padStart(2, '0')}`;
}

function getDefaultServerPromptSettings(): AnalysisPromptSettings {
  return {
    asset_analysis: [
      '你是專業投資組合分析助手，請以審慎、客觀、具體的方式分析我的資產配置。',
      '分析時請優先指出：',
      '1. 最值得留意的集中風險',
      '2. 資產配置是否失衡',
      '3. 幣別曝險是否過度集中',
      '4. 現金比例是否過高或過低',
      '5. 哪些持倉對總體波動影響最大',
      '請避免空泛投資常識，每個觀察盡量引用我組合內的具體持倉、比重、帳戶或金額。',
      '輸出時請先給我最重要的 3 點判斷，再補充原因與可執行的下一步建議。',
      '如果資料不足以支持某結論，要明確指出限制，不要猜測外部市場消息。',
    ].join('\n'),
    general_question: '你是投資組合對話助手，請直接回答我當次提出的問題。',
    asset_report: [
      '你是資產報告撰寫助手，請將我的投資組合整理成一份專業、可追蹤、方便回顧的資產報告。',
      '報告應優先包含：',
      '1. 組合總覽',
      '2. 重點持倉與比重',
      '3. 主要風險與集中度',
      '4. 近期變化或值得跟進項目',
      '5. 下一步觀察重點',
      '寫作風格要整齊、穩重、像交給自己日後翻查的投資筆記。',
      '避免純粹重覆持倉清單，要整理出重點與結論；但同時不要虛構新聞、估值或宏觀資料。',
      '如果可行，請把內容分成短段落，令我容易直接閱讀或複製保存。',
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
  conversationContext: string,
) {
  return createHash('sha256')
    .update(
      JSON.stringify({
        snapshotHash,
        category,
        analysisModel,
        analysisQuestion: analysisQuestion.trim(),
        analysisBackground: analysisBackground.trim(),
        conversationContext: conversationContext.trim(),
      }),
    )
    .digest('hex');
}

function buildAnalysisRequestFromAssets(params: {
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
    conversationContext,
  );
  const totalValueHKD = assets.reduce(
    (sum, asset) => sum + convertToHKD(asset.quantity * asset.currentPrice, asset.currency),
    0,
  );
  const totalCostHKD = assets.reduce(
    (sum, asset) => sum + convertToHKD(asset.quantity * asset.averageCost, asset.currency),
    0,
  );
  const typeBuckets = new Map<AssetType, number>();
  const currencyBuckets = new Map<string, number>();

  for (const asset of assets) {
    const valueHKD = convertToHKD(asset.quantity * asset.currentPrice, asset.currency);
    typeBuckets.set(asset.assetType, (typeBuckets.get(asset.assetType) ?? 0) + valueHKD);
    currencyBuckets.set(asset.currency, (currencyBuckets.get(asset.currency) ?? 0) + valueHKD);
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
        costValue: asset.quantity * asset.averageCost,
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
    .sort((left, right) => right.quantity * right.currentPrice - left.quantity * left.currentPrice)
    .slice(0, 12);
}

function getSearchSummaryPrompt(params: {
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
    '請使用 Google Search 幫我整理投資組合相關的外部市場摘要，只輸出摘要文字，不要做投資分析或建議。',
    '重點整理：',
    '1. 近期主要市場表現',
    '2. 宏觀背景重點',
    '3. 目前主要持倉近況',
    `主要股票 / ETF 代碼：${tickers}`,
    '請用繁體中文，寫成可直接提供給另一個 AI 做每月資產診斷的背景摘要。',
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
          temperature: 0.2,
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

function parseTimestamp(value: unknown) {
  if (value instanceof Timestamp) {
    return value.toDate().toISOString();
  }

  return typeof value === 'string' ? value : '';
}

function normalizeSnapshotDocument(
  id: string,
  value: Record<string, unknown>,
): SnapshotDocument {
  return {
    id,
    date: typeof value.date === 'string' ? value.date : '',
    capturedAt: parseTimestamp(value.capturedAt),
    totalValueHKD: typeof value.totalValueHKD === 'number' ? value.totalValueHKD : 0,
    holdings: Array.isArray(value.holdings)
      ? value.holdings
          .filter((item) => typeof item === 'object' && item !== null)
          .map((item) => item as SnapshotHoldingPoint)
      : [],
    reason: typeof value.reason === 'string' ? value.reason : undefined,
  };
}

async function readPreviousQuarterSnapshot() {
  const db = getFirebaseAdminDb();
  const previousQuarterEndDate = getPreviousQuarterEndDate();
  const snapshot = await db
    .collection(SHARED_PORTFOLIO_COLLECTION)
    .doc(SHARED_PORTFOLIO_DOC_ID)
    .collection('portfolioSnapshots')
    .where('date', '<=', previousQuarterEndDate)
    .orderBy('date', 'desc')
    .limit(1)
    .get();

  if (snapshot.empty) {
    return null;
  }

  const document = snapshot.docs[0];
  return normalizeSnapshotDocument(document.id, document.data() as Record<string, unknown>);
}

function buildQuarterlySnapshotContext(previousQuarterSnapshot: SnapshotDocument | null) {
  if (!previousQuarterSnapshot) {
    return '上季對比快照：未找到可用的上一季快照。';
  }

  return [
    `上季快照日期：${previousQuarterSnapshot.date}`,
    `上季總資產 HKD：${previousQuarterSnapshot.totalValueHKD}`,
    '上季持倉快照：',
    JSON.stringify(previousQuarterSnapshot.holdings, null, 2),
  ].join('\n');
}

async function saveScheduledAnalysis(
  response: PortfolioAnalysisResponse & { assetCount: number },
  title: string,
) {
  const db = getFirebaseAdminDb();
  const portfolioRef = db.collection(SHARED_PORTFOLIO_COLLECTION).doc(SHARED_PORTFOLIO_DOC_ID);

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
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  await portfolioRef.collection('analysisSessions').add({
    category: response.category,
    title,
    question: response.analysisQuestion,
    result: response.answer,
    model: response.model,
    provider: response.provider,
    snapshotHash: response.snapshotHash,
    delivery: 'scheduled',
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
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
}) {
  const db = getFirebaseAdminDb();

  await db
    .collection(SHARED_PORTFOLIO_COLLECTION)
    .doc(SHARED_PORTFOLIO_DOC_ID)
    .collection('quarterlyReports')
    .add({
      quarter: params.quarter,
      generatedAt: params.generatedAt,
      report: params.report,
      currentSnapshotHash: params.currentSnapshotHash,
      previousSnapshotDate: params.previousSnapshotDate ?? '',
      searchSummary: params.searchSummary,
      model: params.model,
      provider: params.provider,
      pdfUrl: '',
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
}

async function runScheduledCategoryAnalysis(params: {
  category: ScheduledCategory;
  title: string;
  question: string;
  conversationContext: string;
  maxTokens: number;
}) {
  const assets = await readAdminPortfolioAssets();

  if (assets.length === 0) {
    throw new ScheduledAnalysisError('目前沒有可分析的資產，已跳過自動分析。', 400);
  }

  const promptSettings = await readAnalysisPromptSettings();
  const request = buildAnalysisRequestFromAssets({
    assets,
    category: params.category,
    analysisQuestion: params.question,
    analysisBackground: promptSettings[params.category],
    analysisModel: DEFAULT_DIAGNOSTIC_MODEL,
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

  await saveScheduledAnalysis(payload, params.title);

  return payload;
}

export async function runMonthlyAssetAnalysis() {
  const assets = await readAdminPortfolioAssets();
  const searchSummary = await generateGroundedSearchSummary({
    assets,
    mode: 'monthly',
  });
  const title = `${getHongKongYearMonthLabel()}資產分析`;
  const question = [
    '請根據目前投資組合與外部市場摘要，生成本月一次的資產診斷。',
    '請集中指出最值得留意的風險、配置特徵、幣別曝險、集中度，以及未來一個月最應留意的 3 個重點。',
    '請保持診斷語氣，不要寫成報告。',
  ].join('\n');
  const conversationContext = [
    'Gemini Google Search 摘要：',
    searchSummary.summary,
  ].join('\n');
  const response = await runScheduledCategoryAnalysis({
    category: 'asset_analysis',
    title,
    question,
    conversationContext,
    maxTokens: 3000,
  });

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

export async function runQuarterlyAssetReport() {
  const assets = await readAdminPortfolioAssets();
  const previousQuarterSnapshot = await readPreviousQuarterSnapshot();
  const searchSummary = await generateGroundedSearchSummary({
    assets,
    mode: 'quarterly',
  });
  const title = `${getHongKongQuarterLabel()}資產報告`;
  const question = [
    '請根據目前投資組合、上季快照及外部市場摘要，撰寫季度資產報告。',
    '請嚴格依照以下段落標題輸出：',
    '【季度總覽】【資產配置分佈】【幣別曝險】【重點持倉分析】【季度對比摘要】【主要風險與集中度】【下季觀察重點】',
    '每個段落都要有清晰內容，不要省略標題。',
  ].join('\n');
  const currentSnapshotHash = createSnapshotHashFromAssets(assets);
  const conversationContext = [
    'Gemini Google Search 摘要：',
    searchSummary.summary,
    '',
    buildQuarterlySnapshotContext(previousQuarterSnapshot),
  ].join('\n');
  const response = await runScheduledCategoryAnalysis({
    category: 'asset_report',
    title,
    question,
    conversationContext,
    maxTokens: 4000,
  });

  await saveQuarterlyReport({
    quarter: getHongKongQuarterLabel(),
    generatedAt: response.generatedAt,
    report: response.answer,
    currentSnapshotHash,
    previousSnapshotDate: previousQuarterSnapshot?.date,
    searchSummary: searchSummary.summary,
    model: response.model,
    provider: response.provider,
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
