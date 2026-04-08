import { createHash } from 'node:crypto';

import { FieldValue } from 'firebase-admin/firestore';

import { getFirebaseAdminDb } from './firebaseAdmin.js';
import { readAdminPortfolioAssets } from './portfolioSnapshotAdmin.js';
import {
  getAnalyzePortfolioErrorResponse,
  runPortfolioAnalysisRequest,
} from './analyzePortfolio.js';
import type { AnalysisCategory, AnalysisPromptSettings, AssetType } from '../src/types/portfolio.js';
import type {
  PortfolioAnalysisModel,
  PortfolioAnalysisRequest,
  PortfolioAnalysisResponse,
} from '../src/types/portfolioAnalysis.js';

const SHARED_PORTFOLIO_COLLECTION = 'portfolio';
const SHARED_PORTFOLIO_DOC_ID = 'app';
const MONTHLY_ROUTE = '/api/cron-monthly-analysis' as const;
const QUARTERLY_ROUTE = '/api/cron-quarterly-report' as const;
const DEFAULT_ANALYSIS_MODEL = 'gemini-3.1-pro-preview' as const;

type AdminAsset = Awaited<ReturnType<typeof readAdminPortfolioAssets>>[number];

class ScheduledAnalysisError extends Error {
  status: number;

  constructor(message: string, status = 500) {
    super(message);
    this.name = 'ScheduledAnalysisError';
    this.status = status;
  }
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

function getHongKongQuarterLabel(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Hong_Kong',
    year: 'numeric',
    month: 'numeric',
  }).formatToParts(date);
  const year = parts.find((part) => part.type === 'year')?.value ?? '';
  const month = Number(parts.find((part) => part.type === 'month')?.value ?? '1');
  const quarter = Math.floor((month - 1) / 3) + 1;
  return `${year}年Q${quarter}`;
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
    general_question: [
      '你是投資組合對話助手，請直接回答我當次提出的問題。',
    ].join('\n'),
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

function createSnapshotHash(assets: AdminAsset[]) {
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
        conversationContext: '',
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
}): PortfolioAnalysisRequest {
  const { assets, category, analysisQuestion, analysisBackground, analysisModel } = params;
  const snapshotHash = createSnapshotHash(assets);
  const cacheKey = createCacheKey(
    snapshotHash,
    category,
    analysisModel,
    analysisQuestion,
    analysisBackground,
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
    conversationContext: '',
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
      assetCount: response.assetCount ?? 0,
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

async function runScheduledCategoryAnalysis(params: {
  category: Extract<AnalysisCategory, 'asset_analysis' | 'asset_report'>;
  question: string;
  title: string;
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
    analysisModel: DEFAULT_ANALYSIS_MODEL,
  });
  const response = await runPortfolioAnalysisRequest(request, { delivery: 'scheduled' });
  await saveScheduledAnalysis(
    {
      ...response,
      assetCount: request.assetCount,
    },
    params.title,
  );

  return {
    ok: true,
    category: params.category,
    model: response.model,
    provider: response.provider,
    generatedAt: response.generatedAt,
    snapshotHash: response.snapshotHash,
    cacheKey: response.cacheKey,
    title: params.title,
  };
}

export async function runMonthlyAssetAnalysis() {
  return runScheduledCategoryAnalysis({
    category: 'asset_analysis',
    title: `${getHongKongYearMonthLabel()}資產分析`,
    question: `請根據我目前投資組合，生成本月一次的資產分析。重點整理目前配置、最值得留意的風險、集中度、幣別曝險、現金比例，以及未來一個月最應留意的 3 個重點。`,
  });
}

export async function runQuarterlyAssetReport() {
  return runScheduledCategoryAnalysis({
    category: 'asset_report',
    title: `${getHongKongQuarterLabel()}資產報告`,
    question: `請根據我目前投資組合，生成本季一次的資產報告。請整理組合總覽、重點持倉、主要風險、配置特徵、本季值得跟進的事項，以及下一季觀察重點。`,
  });
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
