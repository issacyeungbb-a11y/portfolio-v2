import { createHash } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { getFirebaseAdminDb } from "./firebaseAdmin.js";
import {
  getAnalyzePortfolioErrorResponse,
  runPortfolioAnalysisRequest
} from "./analyzePortfolio.js";
import {
  compareSnapshots,
  selectRecentDistinctMonthlySnapshots,
  selectQuarterMonthEndSnapshots
} from "./snapshotComparison.js";
import { readAdminPortfolioAssets } from "./portfolioSnapshotAdmin.js";
import { buildReportAllocationSummaryFromHoldings } from "../src/lib/portfolio/reportAllocationSummary.js";
import {
  convertToHKDValue,
  normalizeCurrencyCode
} from "../src/lib/currency.js";
const SHARED_PORTFOLIO_COLLECTION = "portfolio";
const SHARED_PORTFOLIO_DOC_ID = "app";
const MONTHLY_ROUTE = "/api/cron-monthly-analysis";
const QUARTERLY_ROUTE = "/api/manual-quarterly-report";
const DEFAULT_DIAGNOSTIC_MODEL = "claude-opus-4-8";
const DEFAULT_DIAGNOSTIC_FALLBACK_MODEL = "gemini-3.1-pro-preview";
const PREFERRED_GROUNDED_SEARCH_MODEL = "gemini-2.5-flash";
const GROUNDED_SEARCH_FALLBACK_MODELS = ["gemini-2.5-pro", "gemini-3.1-pro-preview"];
const SCHEDULED_MODEL_TIMEOUT_MS = 12e4;
const MONTHLY_MANUAL_RELEASE_HOUR_HKT = 8;
const QUARTERLY_MANUAL_RELEASE_HOUR_HKT = 9;
const MONTHLY_BASELINE_SNAPSHOT_TOLERANCE_DAYS = 5;
const SCHEDULED_ANALYSIS_LOGIC_VERSION = "2026-05-01-p0-round3";
const REPORT_PROMPT_VERSION = "2026-05-01-p0-round3";
class ScheduledAnalysisError extends Error {
  status;
  constructor(message, status = 500) {
    super(message);
    this.name = "ScheduledAnalysisError";
    this.status = status;
  }
}
function getGeminiApiKey() {
  const apiKey = process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim();
  if (!apiKey) {
    throw new ScheduledAnalysisError(
      "\u672A\u8A2D\u5B9A GEMINI_API_KEY \u6216 GOOGLE_API_KEY\uFF0C\u66AB\u6642\u7121\u6CD5\u57F7\u884C\u81EA\u52D5\u5206\u6790\u3002",
      500
    );
  }
  return apiKey;
}
function getScheduledAnalysisModel() {
  return process.env.ANTHROPIC_API_KEY?.trim() ? DEFAULT_DIAGNOSTIC_MODEL : DEFAULT_DIAGNOSTIC_FALLBACK_MODEL;
}
function resolveScheduledModelProvider(model) {
  return model.startsWith("claude-") ? "anthropic" : "google";
}
function isAbortTimeoutError(error) {
  if (!(error instanceof Error)) return false;
  return /abort|timeout|aborted/i.test(`${error.name} ${error.message}`);
}
function formatHKD(value) {
  return `${value.toLocaleString("en-HK", {
    maximumFractionDigits: 0
  })} HKD`;
}
function buildScheduledAnalysisTimeoutFallback(request, params) {
  const sortedHoldings = [...request.holdings].sort((left, right) => right.marketValueHKD - left.marketValueHKD);
  const totalValueHKD = request.totalValueHKD || sortedHoldings.reduce((sum, holding) => sum + holding.marketValueHKD, 0);
  const topHoldings = sortedHoldings.slice(0, 8);
  const topHoldingLines = topHoldings.map((holding, index) => {
    const weight = totalValueHKD > 0 ? holding.marketValueHKD / totalValueHKD * 100 : 0;
    const gainLossHKD = holding.marketValueHKD - holding.costValueHKD;
    return `${index + 1}. ${holding.ticker}\uFF5C${holding.name}\uFF5C\u5E02\u503C ${formatHKD(
      holding.marketValueHKD
    )}\uFF5C\u4F54\u6BD4 ${weight.toFixed(1)}%\uFF5C\u5E33\u9762 ${gainLossHKD >= 0 ? "+" : ""}${formatHKD(gainLossHKD)}`;
  });
  const assetTypeLines = request.allocationsByType.slice(0, 8).map((item) => `- ${item.assetType}\uFF1A${item.percentage.toFixed(1)}%\uFF0C${formatHKD(item.totalValueHKD)}`);
  const currencyLines = request.allocationsByCurrency.slice(0, 8).map((item) => `- ${item.currency}\uFF1A${item.percentage.toFixed(1)}%\uFF0C${formatHKD(item.totalValueHKD)}`);
  const errorMessage = params.error instanceof Error ? params.error.message : "model_timeout";
  const answer = [
    `\u3010${params.title}\u3011`,
    "\u4E00\u53E5\u8A71\u7D50\u8AD6\uFF1A\u5206\u6790\u6A21\u578B\u4ECA\u6B21\u56DE\u61C9\u8D85\u6642\uFF0C\u7CFB\u7D71\u5DF2\u5148\u7528\u5DF2\u540C\u6B65\u6301\u5009\u3001\u914D\u7F6E\u8207\u5FEB\u7167\u8CC7\u6599\u751F\u6210\u53EF\u7528\u7248\u672C\uFF0C\u907F\u514D\u5831\u544A\u5B8C\u5168\u5931\u6557\u3002",
    "",
    "\u3010\u8CC7\u7522\u6982\u6CC1\u3011",
    `- \u7E3D\u5E02\u503C\uFF1A\u7D04 ${formatHKD(totalValueHKD)}`,
    `- \u8CC7\u7522\u6578\u91CF\uFF1A${request.assetCount} \u9805`,
    ...assetTypeLines,
    "",
    "\u3010\u4E3B\u8981\u6301\u5009\u3011",
    ...topHoldingLines,
    sortedHoldings.length > topHoldings.length ? `- \u5176\u9918 ${sortedHoldings.length - topHoldings.length} \u9805\u5408\u8A08\u7D04 ${formatHKD(
      sortedHoldings.slice(topHoldings.length).reduce((sum, holding) => sum + holding.marketValueHKD, 0)
    )}` : "",
    "",
    "\u3010\u5E63\u5225\u66DD\u96AA\u3011",
    ...currencyLines,
    "",
    "\u3010\u5F8C\u7E8C\u8DDF\u9032\u3011",
    "1. \u512A\u5148\u6AA2\u67E5\u6700\u5927\u6301\u5009\u8207\u6700\u5927\u5E33\u9762\u8667\u640D\u9805\u76EE\uFF0C\u78BA\u8A8D\u662F\u5426\u9700\u8981\u8ABF\u6574\u96C6\u4E2D\u5EA6\u3002",
    "2. \u7559\u610F\u5E63\u5225\u66DD\u96AA\u662F\u5426\u96C6\u4E2D\u65BC\u55AE\u4E00\u8CA8\u5E63\uFF0C\u5C24\u5176\u662F\u73FE\u91D1\u6D41\u8207\u6295\u8CC7\u8CA8\u5E63\u4E0D\u4E00\u81F4\u7684\u90E8\u5206\u3002",
    "3. \u5F85\u6A21\u578B\u56DE\u61C9\u7A69\u5B9A\u5F8C\uFF0C\u53EF\u91CD\u65B0\u751F\u6210\u4E00\u6B21\u5831\u544A\u53D6\u5F97\u5B8C\u6574\u5B8F\u89C0\u9023\u7D50\u8207\u884C\u52D5\u5EFA\u8B70\u3002"
  ].filter(Boolean).join("\n");
  return {
    ok: true,
    route: "/api/analyze",
    mode: "live",
    cacheKey: request.cacheKey,
    category: params.category,
    provider: resolveScheduledModelProvider(params.model),
    model: params.model,
    snapshotHash: request.snapshotHash,
    enrichmentStatus: "partial",
    analysisQuestion: request.analysisQuestion ?? "",
    analysisBackground: request.analysisBackground ?? "",
    delivery: params.delivery ?? "scheduled",
    generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
    answer,
    usedPortfolioFacts: [
      `\u7E3D\u5E02\u503C\u7D04 ${formatHKD(totalValueHKD)}`,
      `\u6301\u5009\u6578\u91CF ${request.assetCount} \u9805`,
      topHoldings[0] ? `\u6700\u5927\u6301\u5009 ${topHoldings[0].ticker}` : ""
    ].filter(Boolean),
    uncertainty: [
      `\u5206\u6790\u6A21\u578B\u56DE\u61C9\u8D85\u6642\uFF0C\u5DF2\u6539\u7528\u6301\u5009\u8CC7\u6599\u751F\u6210\u81E8\u6642\u6708\u5831\u3002\u539F\u59CB\u932F\u8AA4\uFF1A${errorMessage}`,
      "\u6B64\u7248\u672C\u672A\u5B8C\u6210\u6A21\u578B\u6DF1\u5EA6\u63A8\u7406\uFF1B\u5982\u9700\u8981\u5B8C\u6574\u5B8F\u89C0\u9023\u7D50\uFF0C\u53EF\u7A0D\u5F8C\u91CD\u65B0\u751F\u6210\u3002"
    ],
    suggestedActions: ["\u7A0D\u5F8C\u91CD\u65B0\u751F\u6210\u5B8C\u6574\u6708\u5831\u3002", "\u5148\u6AA2\u67E5\u4E3B\u8981\u6301\u5009\u3001\u8CC7\u7522\u985E\u5225\u8207\u5E63\u5225\u96C6\u4E2D\u5EA6\u3002"],
    isTimeoutFallback: true
  };
}
function getAssetMarketValueHKD(asset) {
  return convertToHKDValue(asset.quantity * asset.currentPrice, asset.currency);
}
function getAssetCostValueHKD(asset) {
  return convertToHKDValue(asset.quantity * asset.averageCost, asset.currency);
}
function getHongKongDate(date = /* @__PURE__ */ new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}
function getHongKongYearMonthLabel(date = /* @__PURE__ */ new Date()) {
  const parts = new Intl.DateTimeFormat("zh-HK", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "long"
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value ?? "";
  const month = parts.find((part) => part.type === "month")?.value ?? "";
  return `${year}\u5E74${month.endsWith("\u6708") ? month : `${month}\u6708`}`;
}
function getHongKongMonthKey(date = /* @__PURE__ */ new Date()) {
  const { year, month } = getHongKongDateParts(date);
  return `${year}-${String(month).padStart(2, "0")}`;
}
function getCoveredMonthKey(date = /* @__PURE__ */ new Date()) {
  const { year, month } = getHongKongDateParts(date);
  const coveredMonth = month === 1 ? 12 : month - 1;
  const coveredYear = month === 1 ? year - 1 : year;
  return `${coveredYear}-${String(coveredMonth).padStart(2, "0")}`;
}
function getCoveredMonthLabel(date = /* @__PURE__ */ new Date()) {
  const [year, month] = getCoveredMonthKey(date).split("-");
  return `${year}\u5E74${Number(month)}\u6708`;
}
function getCurrentQuarterNumber(date = /* @__PURE__ */ new Date()) {
  const month = Number(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Hong_Kong",
      month: "numeric"
    }).format(date)
  );
  return Math.floor((month - 1) / 3) + 1;
}
function getHongKongQuarterLabel(date = /* @__PURE__ */ new Date()) {
  return `${new Intl.DateTimeFormat("zh-HK", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric"
  }).format(date)}\u5E74Q${getCurrentQuarterNumber(date)}`;
}
function getPreviousCompletedQuarterLabel(date = /* @__PURE__ */ new Date()) {
  const { year } = getHongKongDateParts(date);
  const currentQuarterNumber = getCurrentQuarterNumber(date);
  const previousQuarterNumber = currentQuarterNumber === 1 ? 4 : currentQuarterNumber - 1;
  const previousQuarterYear = currentQuarterNumber === 1 ? year - 1 : year;
  return `${previousQuarterYear}\u5E74Q${previousQuarterNumber}`;
}
function getHongKongDateParts(date = /* @__PURE__ */ new Date()) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false
  }).formatToParts(date);
  const getPart = (type) => Number(formatter.find((part) => part.type === type)?.value ?? "0");
  return {
    year: getPart("year"),
    month: getPart("month"),
    day: getPart("day"),
    hour: getPart("hour")
  };
}
function getQuarterStartMonth(month) {
  return Math.floor((month - 1) / 3) * 3 + 1;
}
function canGenerateMonthlyAnalysisNow(date = /* @__PURE__ */ new Date()) {
  const { day, hour } = getHongKongDateParts(date);
  return day > 1 || day === 1 && hour >= MONTHLY_MANUAL_RELEASE_HOUR_HKT;
}
function canGenerateQuarterlyReportNow(date = /* @__PURE__ */ new Date()) {
  const { month, day, hour } = getHongKongDateParts(date);
  const quarterStartMonth = getQuarterStartMonth(month);
  const isQuarterOpeningMonth = month === quarterStartMonth;
  return isQuarterOpeningMonth && (day > 1 || day === 1 && hour >= QUARTERLY_MANUAL_RELEASE_HOUR_HKT);
}
async function resolveMonthlyAnalysisSessionTarget(params) {
  const db = getFirebaseAdminDb();
  const docId = getCoveredMonthlyAnalysisSessionDocId(params.coveredMonthKey);
  const monthlyDoc = await db.collection(SHARED_PORTFOLIO_COLLECTION).doc(SHARED_PORTFOLIO_DOC_ID).collection("analysisSessions").doc(docId).get();
  if (!monthlyDoc.exists) {
    return { docId, collisionWithLegacy: false };
  }
  const data = monthlyDoc.data();
  const reportFactsPayload = data && typeof data.reportFactsPayload === "object" && data.reportFactsPayload !== null ? data.reportFactsPayload : null;
  const periodStartDate = typeof reportFactsPayload?.periodStartDate === "string" ? reportFactsPayload.periodStartDate : typeof data?.periodStartDate === "string" ? data.periodStartDate : "";
  const periodEndDate = typeof reportFactsPayload?.periodEndDate === "string" ? reportFactsPayload.periodEndDate : typeof data?.periodEndDate === "string" ? data.periodEndDate : "";
  if (periodStartDate === params.periodStartDate && periodEndDate === params.periodEndDate) {
    return { docId, collisionWithLegacy: false };
  }
  return { docId: `${docId}-v2`, collisionWithLegacy: true };
}
async function hasExistingMonthlyAnalysis(params) {
  const db = getFirebaseAdminDb();
  const monthlyDoc = await db.collection(SHARED_PORTFOLIO_COLLECTION).doc(SHARED_PORTFOLIO_DOC_ID).collection("analysisSessions").doc(params.sessionDocId).get();
  if (monthlyDoc.exists) {
    const data = monthlyDoc.data();
    const reportFactsPayload = data && typeof data.reportFactsPayload === "object" && data.reportFactsPayload !== null ? data.reportFactsPayload : null;
    const periodStartDate = typeof reportFactsPayload?.periodStartDate === "string" ? reportFactsPayload.periodStartDate : typeof data?.periodStartDate === "string" ? data.periodStartDate : "";
    const periodEndDate = typeof reportFactsPayload?.periodEndDate === "string" ? reportFactsPayload.periodEndDate : typeof data?.periodEndDate === "string" ? data.periodEndDate : "";
    return periodStartDate === params.periodStartDate && periodEndDate === params.periodEndDate;
  }
  const snapshot = await db.collection(SHARED_PORTFOLIO_COLLECTION).doc(SHARED_PORTFOLIO_DOC_ID).collection("analysisSessions").where("category", "==", "asset_analysis").where("title", "==", params.title).limit(1).get();
  return !snapshot.empty;
}
async function hasExistingQuarterlyReport(quarter) {
  const doc = await getFirebaseAdminDb().collection(SHARED_PORTFOLIO_COLLECTION).doc(SHARED_PORTFOLIO_DOC_ID).collection("quarterlyReports").doc(getQuarterlyReportDocId(quarter)).get();
  if (doc.exists) {
    return {
      exists: true,
      isTimeoutFallback: doc.data()?.isTimeoutFallback === true
    };
  }
  const snapshot = await getFirebaseAdminDb().collection(SHARED_PORTFOLIO_COLLECTION).doc(SHARED_PORTFOLIO_DOC_ID).collection("quarterlyReports").where("quarter", "==", quarter).limit(1).get();
  return {
    exists: !snapshot.empty,
    isTimeoutFallback: snapshot.docs[0]?.data()?.isTimeoutFallback === true
  };
}
function getPreviousQuarterEndDate(date = /* @__PURE__ */ new Date()) {
  const { year, month } = getHongKongDateParts(date);
  const quarterStartMonth = getQuarterStartMonth(month);
  const previousQuarterEnd = new Date(year, quarterStartMonth - 1, 0);
  return [
    previousQuarterEnd.getFullYear(),
    String(previousQuarterEnd.getMonth() + 1).padStart(2, "0"),
    String(previousQuarterEnd.getDate()).padStart(2, "0")
  ].join("-");
}
function getQuarterEndDateBefore(quarterEndDate) {
  const normalized = quarterEndDate.trim().slice(0, 10);
  const match = /^(\d{4})-(\d{2})-\d{2}$/.exec(normalized);
  if (!match) {
    throw new Error(`Invalid quarter end date: ${quarterEndDate}`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month === 3) return `${year - 1}-12-31`;
  if (month === 6) return `${year}-03-31`;
  if (month === 9) return `${year}-06-30`;
  if (month === 12) return `${year}-09-30`;
  throw new Error(`Invalid quarter end month: ${quarterEndDate}`);
}
function getMonthlyAnalysisSessionDocId(dateKey) {
  const normalized = dateKey.trim();
  if (!normalized) {
    return "monthly-unknown";
  }
  return `monthly-${normalized.slice(0, 7)}`;
}
function getCoveredMonthlyAnalysisSessionDocId(coveredMonthKey) {
  const normalized = coveredMonthKey.trim();
  return normalized ? `monthly-${normalized.slice(0, 7)}` : "monthly-unknown";
}
function getQuarterlyReportDocId(quarter) {
  return `quarterly-${quarter}`;
}
function isFirestoreAlreadyExistsError(error) {
  if (!error || typeof error !== "object") {
    return false;
  }
  const value = error;
  const code = value.code;
  const message = typeof value.message === "string" ? value.message.toLowerCase() : "";
  return code === 6 || code === "6" || typeof code === "string" && code.toLowerCase().includes("already-exists") || message.includes("already exists");
}
function getDefaultServerPromptSettings() {
  return {
    asset_analysis: [
      "\u4F60\u662F\u6BCF\u6708\u8CC7\u7522\u5206\u6790\u52A9\u624B\uFF0C\u5B9A\u4F4D\u662F\u76E3\u5BDF\u3001\u544A\u8B66\u3001\u4E0B\u6708\u884C\u52D5\u3002",
      "\u7CFB\u7D71\u6703\u5728\u6B63\u6587\u524D\u986F\u793A\u7D50\u69CB\u5316\u300C\u8CC7\u7522\u5206\u4F48\u7E3D\u89BD\u300D\u5716\u50CF\u5361\uFF1B\u4F60\u4E0D\u8981\u751F\u6210\u5716\u8868\u3001\u8868\u683C\u6216\u5716\u8868\u8CC7\u6599\uFF0C\u4E5F\u4E0D\u8981\u9010\u9805\u91CD\u8986\u5361\u7247\u4E0A\u7684\u767E\u5206\u6BD4\u5206\u5E03\u3002",
      "\u4F60\u5FC5\u9808\u5F15\u7528\u7CFB\u7D71\u63D0\u4F9B\u7684\u300C\u904E\u53BB\u4E00\u500B\u6708\u5B8F\u89C0\u8207\u5E02\u5834\u80CC\u666F\u6458\u8981\u300D\uFF0C\u4E26\u5C07\u5176\u8207\u76EE\u524D\u8CC7\u7522\u914D\u7F6E\u3001\u6708\u5EA6\u8B8A\u5316\u3001\u5E63\u5225\u66DD\u96AA\u9010\u9805\u5C0D\u7167\uFF1B\u4E0D\u8981\u53EA\u505A\u4E00\u822C\u914D\u7F6E\u8A3A\u65B7\u3002",
      "\u56FA\u5B9A\u8F38\u51FA\u6B04\u76EE\uFF0C\u4E26\u6309\u9806\u5E8F\u4F7F\u7528\u4EE5\u4E0B\u6A19\u984C\uFF1A",
      "1. \u3010\u672C\u6708\u4E00\u53E5\u7E3D\u7D50\u3011\uFF08\u5FC5\u9808\u540C\u6642\u63D0\u53CA\u672C\u6708\u8CC7\u7522\u8B8A\u5316\u65B9\u5411\u3001\u904E\u53BB\u4E00\u500B\u6708\u4E3B\u8981\u5B8F\u89C0 / \u5E02\u5834\u80CC\u666F\u3001\u7D44\u5408\u6700\u5927\u98A8\u96AA\u6216\u6700\u5927\u6A5F\u6703\uFF09",
      "2. \u3010\u672C\u6708\u8CC7\u7522\u8B8A\u5316\u6458\u8981\u3011\uFF08\u5FC5\u9808\u5340\u5206\u7E3D\u8CC7\u7522\u8B8A\u5316\u3001\u6DE8\u5165\u91D1 / \u51FA\u91D1\u3001\u6263\u9664\u8CC7\u91D1\u6D41\u5F8C\u8868\u73FE\u3001\u8CC7\u91D1\u6D41\u8986\u84CB\u7387\u3001\u6700\u5927\u8CA2\u737B\u8005 / \u6700\u5927\u62D6\u7D2F\u8005\uFF0C\u4E26\u5224\u65B7\u5347\u5E45\u662F\u5426\u96C6\u4E2D\u65BC\u5C11\u6578\u9AD8 beta / \u52A0\u5BC6 / \u79D1\u6280\u8CC7\u7522\uFF09",
      "3. \u3010\u7D44\u5408\u5065\u5EB7\u6AA2\u67E5\u3011\uFF08\u5FC5\u9808\u52A0\u5165\u5B8F\u89C0\u58D3\u529B\u6E2C\u8A66\uFF1Arisk-on \u6301\u7E8C\u6642\u5982\u4F55\u53D7\u60E0\u3001risk-off \u6642\u6700\u5927\u98A8\u96AA\u3001\u73FE\u91D1 / \u50B5\u5238\u662F\u5426\u8DB3\u5920\u9632\u5B88\u3001USD / HKD / JPY \u5E63\u5225\u66DD\u96AA\u662F\u5426\u9700\u8981\u7559\u610F\uFF1B\u5982\u679C dataQualitySummary.status \u4E0D\u662F ok\uFF0C\u8981\u9650\u5236\u7D50\u8AD6\u5F37\u5EA6\uFF09",
      "4. \u3010\u4E09\u500B\u91CD\u9EDE\u89C0\u5BDF\u3011\uFF08\u525B\u597D 3 \u9EDE\uFF1B\u6BCF\u9EDE\u5FC5\u9808\u4F7F\u7528\u300C\u5B8F\u89C0\u80CC\u666F \u2192 \u5C0D\u6211\u8CC7\u7522\u7684\u5F71\u97FF \u2192 \u6295\u8CC7\u542B\u7FA9\u300D\u683C\u5F0F\uFF0C\u4E0D\u53EF\u53EA\u5217\u6301\u5009\u96C6\u4E2D\u5EA6\uFF0C\u4EA6\u4E0D\u53EF\u53EA\u5BEB\u666E\u901A\u65B0\u805E\u6458\u8981\uFF09",
      "5. \u3010\u4E0B\u6708\u884C\u52D5\u5EFA\u8B70\u3011\uFF08\u5FC5\u9808\u5206\u6210\u300C\u5FC5\u9808\u8DDF\u9032 / \u53EF\u4EE5\u8003\u616E / \u66AB\u6642\u4E0D\u5EFA\u8B70\u300D\uFF0C\u6BCF\u9805\u90FD\u8981\u6709\u89F8\u767C\u689D\u4EF6\uFF1B\u4E0D\u8981\u5BEB\u6210\u76F4\u63A5\u8CB7\u8CE3\u6307\u4EE4\uFF0C\u4E0D\u8981\u7D66\u78BA\u5B9A\u6027\u50F9\u683C\u9810\u6E2C\uFF09",
      "\u6BCF\u6BB5\u8981\u5F15\u7528\u53EF\u6838\u5C0D\u7684\u6301\u5009\u3001\u8B8A\u5316\u3001\u8CC7\u91D1\u6D41\u3001\u5E63\u5225\u6216\u98A8\u96AA\uFF1B\u5982\u679C\u8CC7\u6599\u4E0D\u8DB3\uFF0C\u8981\u76F4\u8AAA\uFF0C\u4E26\u964D\u4F4E\u7D50\u8AD6\u5F37\u5EA6\u3002",
      "\u5982\u679C comparison \u986F\u793A\u6301\u5009 previous value \u70BA 0\uFF0C\u6216\u5927\u91CF\u6301\u5009\u88AB\u6A19\u793A\u70BA new\uFF0C\u4E0D\u53EF\u76F4\u63A5\u89E3\u8B80\u70BA\u55AE\u6708\u50F9\u683C\u8CA2\u737B\uFF1B\u5FC5\u9808\u8AAA\u660E\u53EF\u80FD\u6DF7\u5408\u65B0\u5EFA\u5009\u3001\u8CC7\u6599\u88DC\u9304\u3001snapshot matching \u6216 baseline holdings \u7F3A\u5931\u3002",
      "\u5982\u679C\u67D0\u8CC7\u7522 costValue \u6216 averageCost \u70BA 0\uFF0C\u4E0D\u53EF\u5224\u65B7\u70BA\u5168\u70BA\u672A\u5BE6\u73FE\u5229\u6F64\uFF1B\u5FC5\u9808\u5BEB\u660E\u6210\u672C\u8CC7\u6599\u70BA 0 \u6216\u7F3A\u5931\uFF0C\u7121\u6CD5\u6E96\u78BA\u5224\u65B7\u5BE6\u969B\u76C8\u8667\uFF0C\u4E26\u628A\u88DC\u56DE\u6210\u672C\u8CC7\u6599\u5217\u70BA\u5FC5\u9808\u8DDF\u9032\u3002",
      "\u5E63\u5225\u66DD\u96AA\u5FC5\u9808\u5206\u6E05\u5831\u50F9\u8CA8\u5E63\u66DD\u96AA\u8207\u7D93\u6FDF\u98A8\u96AA\u66DD\u96AA\uFF1B\u52A0\u5BC6\u8CA8\u5E63\u4EE5 USD \u5831\u50F9\uFF0C\u4E0D\u7B49\u65BC\u5B8C\u5168\u7F8E\u5143\u8CC7\u7522\u3002",
      "\u4E0B\u6708\u884C\u52D5\u5EFA\u8B70\u7684\u89F8\u767C\u689D\u4EF6\u8981\u76E1\u91CF\u91CF\u5316\uFF0C\u4F8B\u5982\u55AE\u4E00\u8CC7\u7522 > 20%\u3001\u52A0\u5BC6\u5408\u8A08 > 30%\u3001\u73FE\u91D1 < 3%\u3001SGOV + \u73FE\u91D1 < 10%\u3001BTC 7 \u65E5\u8DCC\u5E45 > 15%\u3001\u9AD8 beta \u80A1\u7968\u5408\u8A08\u8D85\u904E\u80A1\u7968\u90E8\u4F4D 60%\u3002",
      "\u5982\u679C dataQualitySummary.status \u662F partial / warning\uFF0C\u5FC5\u9808\u628A\u8CC7\u6599\u4FEE\u5FA9\u5217\u5165\u300C\u5FC5\u9808\u8DDF\u9032\u300D\uFF0C\u4E0D\u53EF\u53EA\u653E\u5728\u5099\u8A3B\u3002"
    ].join("\n"),
    general_question: "\u4F60\u662F\u6295\u8CC7\u7D44\u5408\u5C0D\u8A71\u52A9\u624B\uFF0C\u8ACB\u76F4\u63A5\u56DE\u7B54\u6211\u7576\u6B21\u63D0\u51FA\u7684\u554F\u984C\u3002",
    asset_report: [
      "\u4F60\u662F\u5B63\u5EA6\u8CC7\u7522\u5831\u544A\u64B0\u5BEB\u52A9\u624B\uFF0C\u5B9A\u4F4D\u662F\u5B63\u5EA6\u7E3D\u7D50\u3001\u6B78\u56E0\u3001\u6B63\u5F0F\u6B78\u6A94\u3002",
      "\u7CFB\u7D71\u6703\u5728\u6B63\u6587\u524D\u986F\u793A\u7D50\u69CB\u5316\u300C\u8CC7\u7522\u5206\u4F48\u7E3D\u89BD\u300D\u5716\u50CF\u5361\uFF1B\u4F60\u4E0D\u8981\u751F\u6210\u5716\u8868\u3001\u8868\u683C\u6216\u5716\u8868\u8CC7\u6599\uFF0C\u4E5F\u4E0D\u8981\u9010\u9805\u91CD\u8986\u5361\u7247\u4E0A\u7684\u767E\u5206\u6BD4\u5206\u5E03\u3002",
      "\u4F60\u53EA\u9700\u8981\u627F\u63A5\u7CFB\u7D71\u63D0\u4F9B\u7684\u5206\u4F48\u5224\u8B80\u3001\u5B63\u5EA6\u5C0D\u6BD4\u3001\u8DA8\u52E2\u8207\u5916\u90E8\u80CC\u666F\uFF0C\u5BEB\u6210\u53EF\u6B78\u6A94\u7684\u6B63\u5F0F\u6587\u5B57\u3002",
      "\u56FA\u5B9A\u8F38\u51FA\u6B04\u76EE\uFF0C\u4E26\u6309\u9806\u5E8F\u4F7F\u7528\u4EE5\u4E0B\u6A19\u984C\uFF1A",
      "1. \u3010\u7BA1\u7406\u5C64\u6458\u8981\u3011",
      "2. \u3010\u5B63\u5EA6\u7E3D\u89BD\u3011",
      "3. \u3010\u8CC7\u7522\u914D\u7F6E\u5206\u4F48\u3011",
      "4. \u3010\u5E63\u5225\u66DD\u96AA\u3011",
      "5. \u3010\u91CD\u9EDE\u6301\u5009\u5206\u6790\u3011",
      "6. \u3010\u5B63\u5EA6\u5C0D\u6BD4\u6458\u8981\u3011",
      "7. \u3010\u4E3B\u8981\u98A8\u96AA\u8207\u96C6\u4E2D\u5EA6\u3011",
      "8. \u3010\u4E0B\u5B63\u89C0\u5BDF\u91CD\u9EDE\u3011",
      "\u5BEB\u4F5C\u8981\u77ED\u800C\u6E96\uFF0C\u907F\u514D\u7A7A\u6CDB\u6295\u8CC7\u5E38\u8B58\uFF1B\u5982\u679C\u8CC7\u6599\u4E0D\u8DB3\uFF0C\u8981\u76F4\u8AAA\u3002"
    ].join("\n")
  };
}
function normalizePromptValue(value, fallback) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}
async function readAnalysisPromptSettings() {
  const db = getFirebaseAdminDb();
  const defaults = getDefaultServerPromptSettings();
  const snapshot = await db.collection(SHARED_PORTFOLIO_COLLECTION).doc(SHARED_PORTFOLIO_DOC_ID).collection("analysisSettings").doc("prompts").get();
  const value = snapshot.exists ? snapshot.data() : {};
  return {
    asset_analysis: normalizePromptValue(value.asset_analysis, defaults.asset_analysis),
    general_question: normalizePromptValue(value.general_question, defaults.general_question),
    asset_report: normalizePromptValue(value.asset_report, defaults.asset_report)
  };
}
function normalizeHoldingForSignature(asset) {
  return {
    id: asset.id,
    name: asset.name,
    symbol: asset.symbol,
    assetType: asset.assetType,
    accountSource: asset.accountSource,
    currency: asset.currency,
    quantity: Number(asset.quantity.toFixed(8)),
    averageCost: Number(asset.averageCost.toFixed(8)),
    currentPrice: Number(asset.currentPrice.toFixed(8))
  };
}
function createSnapshotHashFromAssets(assets) {
  const normalized = [...assets].map(normalizeHoldingForSignature).sort((left, right) => left.id.localeCompare(right.id));
  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}
function createSnapshotHashFromSnapshot(snapshot) {
  const normalized = {
    date: snapshot.date,
    totalValueHKD: Number(snapshot.totalValueHKD.toFixed(4)),
    holdings: [...snapshot.holdings].map((holding) => ({
      assetId: holding.assetId,
      ticker: holding.ticker,
      name: holding.name,
      assetType: holding.assetType,
      accountSource: holding.accountSource ?? "",
      currency: holding.currency,
      quantity: Number(holding.quantity.toFixed(8)),
      currentPrice: Number(holding.currentPrice.toFixed(8)),
      marketValueHKD: Number(holding.marketValueHKD.toFixed(4))
    })).sort(
      (left, right) => `${left.assetId}|${left.ticker}|${left.currency}`.localeCompare(
        `${right.assetId}|${right.ticker}|${right.currency}`
      )
    )
  };
  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}
function createCacheKey(snapshotHash, category, analysisModel, analysisQuestion, analysisBackground) {
  return createHash("sha256").update(
    JSON.stringify({
      snapshotHash,
      category,
      analysisModel,
      analysisQuestion: analysisQuestion.trim(),
      analysisBackground: analysisBackground.trim()
    })
  ).digest("hex");
}
function buildAnalysisRequestFromAssets(params) {
  const {
    assets,
    category,
    analysisQuestion,
    analysisBackground,
    analysisModel,
    conversationContext = "",
    snapshotHashOverride
  } = params;
  const snapshotHash = snapshotHashOverride || createSnapshotHashFromAssets(assets);
  const cacheKey = createCacheKey(
    snapshotHash,
    category,
    analysisModel,
    analysisQuestion,
    analysisBackground
  );
  const totalValueHKD = assets.reduce(
    (sum, asset) => sum + getAssetMarketValueHKD(asset),
    0
  );
  const totalCostHKD = assets.reduce(
    (sum, asset) => sum + getAssetCostValueHKD(asset),
    0
  );
  const typeBuckets = /* @__PURE__ */ new Map();
  const currencyBuckets = /* @__PURE__ */ new Map();
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
    holdings: [...assets].sort((left, right) => left.id.localeCompare(right.id)).map((asset) => ({
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
      costValueHKD: getAssetCostValueHKD(asset)
    })),
    allocationsByType: [...typeBuckets.entries()].map(([assetType, bucketTotal]) => ({
      assetType,
      totalValueHKD: bucketTotal,
      percentage: totalValueHKD === 0 ? 0 : bucketTotal / totalValueHKD * 100
    })).sort((left, right) => right.totalValueHKD - left.totalValueHKD),
    allocationsByCurrency: [...currencyBuckets.entries()].map(([currency, bucketTotal]) => ({
      currency,
      totalValueHKD: bucketTotal,
      percentage: totalValueHKD === 0 ? 0 : bucketTotal / totalValueHKD * 100
    })).sort((left, right) => right.totalValueHKD - left.totalValueHKD)
  };
}
function getSearchTargetAssets(assets) {
  return [...assets].filter((asset) => asset.assetType === "stock" || asset.assetType === "etf").sort((left, right) => getAssetMarketValueHKD(right) - getAssetMarketValueHKD(left)).slice(0, 12);
}
function getSearchSummaryPrompt(params) {
  const searchTargets = getSearchTargetAssets(params.assets);
  const tickers = searchTargets.map((asset) => `${asset.symbol} (${asset.name})`).join("\u3001") || "\u76EE\u524D\u7121\u4E3B\u8981\u80A1\u7968\u6216 ETF \u6301\u5009";
  const assetTypeSummary = [...new Set(params.assets.map((asset) => asset.assetType))].join("\u3001");
  if (params.mode === "quarterly") {
    return [
      "\u8ACB\u4F7F\u7528 Google Search \u5E6B\u6211\u6574\u7406\u6295\u8CC7\u7D44\u5408\u76F8\u95DC\u7684\u5916\u90E8\u5E02\u5834\u6458\u8981\uFF0C\u53EA\u8F38\u51FA\u6458\u8981\u6587\u5B57\uFF0C\u4E0D\u8981\u505A\u6295\u8CC7\u5206\u6790\u6216\u5EFA\u8B70\u3002",
      "\u91CD\u9EDE\u6574\u7406\uFF1A",
      "1. \u7576\u5B63\u4E3B\u8981\u5E02\u5834\u8868\u73FE\u8207\u5B8F\u89C0\u74B0\u5883",
      "2. \u76EE\u524D\u4E3B\u8981\u6301\u5009\u8FD1\u6CC1",
      "3. \u53EF\u80FD\u5F71\u97FF\u672C\u5B63\u5EA6\u6295\u8CC7\u7D44\u5408\u7684\u95DC\u9375\u80CC\u666F",
      `\u4E3B\u8981\u80A1\u7968 / ETF \u4EE3\u78BC\uFF1A${tickers}`,
      `\u7D44\u5408\u8CC7\u7522\u985E\u5225\uFF1A${assetTypeSummary}`,
      "\u8ACB\u7528\u7E41\u9AD4\u4E2D\u6587\uFF0C\u5BEB\u6210\u53EF\u76F4\u63A5\u63D0\u4F9B\u7D66\u53E6\u4E00\u500B AI \u505A\u5B63\u5EA6\u5831\u544A\u7684\u80CC\u666F\u6458\u8981\u3002"
    ].join("\n");
  }
  return [
    "\u8ACB\u4F7F\u7528 Google Search \u5E6B\u6211\u6574\u7406\u6295\u8CC7\u7D44\u5408\u76F8\u95DC\u7684\u5916\u90E8\u5E02\u5834\u80CC\u666F\uFF0C\u53EA\u8F38\u51FA\u7CBE\u7C21\u6458\u8981\uFF0C\u4E0D\u8981\u505A\u6295\u8CC7\u5206\u6790\u3001\u8CB7\u8CE3\u5EFA\u8B70\u6216\u50F9\u683C\u9810\u6E2C\u3002",
    "\u6642\u9593\u7BC4\u570D\uFF1A\u53EA\u7E3D\u7D50\u904E\u53BB\u4E00\u500B\u6708\u6700\u91CD\u8981\u7684\u8B8A\u5316\u3002",
    "\u8ACB\u6309\u4EE5\u4E0B\u7D50\u69CB\u8F38\u51FA\uFF0C\u6BCF\u90E8\u5206 1-3 \u53E5\uFF0C\u907F\u514D\u9577\u7BC7\u65B0\u805E\u6458\u8981\uFF1A",
    "1. \u904E\u53BB\u4E00\u500B\u6708\u5E02\u5834\u4E3B\u7DDA\uFF1A\u5FC5\u9808\u660E\u78BA\u5224\u65B7\u504F risk-on / risk-off / mixed\uFF0C\u4E26\u7C21\u8FF0\u4E3B\u56E0",
    "2. \u4E3B\u8981\u5B8F\u89C0\u56E0\u7D20\uFF1A\u805A\u7126\u5229\u7387\u3001\u901A\u8139\u3001\u7F8E\u5143\u3001\u80A1\u5E02\u60C5\u7DD2\u3001\u52A0\u5BC6\u5E02\u5834",
    "3. \u80A1\u7968 / ETF \u5F71\u97FF",
    "4. \u52A0\u5BC6\u8CA8\u5E63\u5F71\u97FF",
    "5. \u73FE\u91D1 / \u50B5\u5238 / \u5229\u7387\u5F71\u97FF",
    "6. \u532F\u7387\u8207 USD / HKD / JPY \u5F71\u97FF",
    "7. \u4E0B\u6708\u503C\u5F97\u89C0\u5BDF\u7684 3-5 \u500B\u5916\u90E8\u56E0\u7D20",
    `\u4E3B\u8981\u80A1\u7968 / ETF \u4EE3\u78BC\uFF1A${tickers}`,
    `\u7D44\u5408\u8CC7\u7522\u985E\u5225\uFF1A${assetTypeSummary}`,
    "\u8ACB\u512A\u5148\u6574\u7406\u53EF\u80FD\u5F71\u97FF\u4E0A\u8FF0\u6301\u5009\u8207\u8CC7\u7522\u985E\u5225\u7684\u5171\u540C\u80CC\u666F\uFF0C\u4E0D\u8981\u9010\u9805\u8986\u8FF0\u6240\u6709\u65B0\u805E\u3002",
    "\u8ACB\u7528\u7E41\u9AD4\u4E2D\u6587\uFF0C\u63A7\u5236\u5728 800-1200 \u4E2D\u6587\u5B57\u4EE5\u5167\uFF0C\u5BEB\u6210\u53EF\u76F4\u63A5\u63D0\u4F9B\u7D66\u53E6\u4E00\u500B AI \u505A\u6BCF\u6708\u8CC7\u7522\u8A3A\u65B7\u7684\u80CC\u666F\u6458\u8981\u3002"
  ].join("\n");
}
function getSearchModelCandidates() {
  const preferred = process.env.GROUNDED_GEMINI_MODEL?.trim() || PREFERRED_GROUNDED_SEARCH_MODEL;
  return [preferred, ...GROUNDED_SEARCH_FALLBACK_MODELS.filter((model) => model !== preferred)];
}
function getGeminiResponseText(response) {
  if (typeof response?.text === "string") {
    return response.text.trim();
  }
  const candidates = response?.candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) return "";
  const content = candidates[0]?.content;
  const parts = content?.parts;
  if (!Array.isArray(parts)) return "";
  return parts.map((part) => {
    if (typeof part !== "object" || part === null) return "";
    const text = part.text;
    return typeof text === "string" ? text : "";
  }).join("\n").trim();
}
function getGroundingFailureReason(error) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (/spending cap/i.test(message)) {
    return {
      reason: "Google AI Studio \u5C08\u6848\u5DF2\u8D85\u51FA\u6BCF\u6708 spending cap\uFF0C\u56E0\u6B64 Gemini Google Search grounding \u88AB\u66AB\u505C\u3002",
      followUp: "\u8ACB\u5230 AI Studio \u7684 Spend / Billing \u8A2D\u5B9A\u63D0\u9AD8\u6216\u91CD\u8A2D\u6BCF\u6708\u4E0A\u9650\uFF0C\u7136\u5F8C\u91CD\u65B0\u751F\u6210\u5831\u544A\u3002"
    };
  }
  if (/quota|rate limit|resource exhausted|429/i.test(message)) {
    return {
      reason: "Google Gemini / Google Search grounding \u914D\u984D\u66AB\u6642\u7528\u76E1\u6216\u88AB\u9650\u6D41\u3002",
      followUp: "\u8ACB\u7A0D\u5F8C\u518D\u8A66\uFF0C\u6216\u6AA2\u67E5 Google AI Studio / Google Cloud \u7684 API \u914D\u984D\u8A2D\u5B9A\u3002"
    };
  }
  if (/api key|permission|forbidden|unauthorized|billing/i.test(message)) {
    return {
      reason: "Google API key\u3001\u6B0A\u9650\u6216\u5E33\u55AE\u8A2D\u5B9A\u672A\u80FD\u901A\u904E Google Search grounding \u8981\u6C42\u3002",
      followUp: "\u8ACB\u6AA2\u67E5 Vercel \u74B0\u5883\u8B8A\u6578\u5167\u7684 GEMINI_API_KEY / GOOGLE_API_KEY\uFF0C\u4EE5\u53CA Google AI Studio \u5E33\u55AE\u8207\u6B0A\u9650\u8A2D\u5B9A\u3002"
    };
  }
  if (isAbortTimeoutError(error)) {
    return {
      reason: "Google Search grounding \u8ACB\u6C42\u903E\u6642\uFF0C\u672A\u80FD\u5728\u9650\u5B9A\u6642\u9593\u5167\u56DE\u50B3\u6458\u8981\u3002",
      followUp: "\u8ACB\u7A0D\u5F8C\u91CD\u65B0\u751F\u6210\uFF1B\u5982\u60C5\u6CC1\u6301\u7E8C\uFF0C\u53EF\u80FD\u9700\u8981\u5EF6\u9577 function timeout \u6216\u964D\u4F4E\u641C\u5C0B\u6458\u8981\u7BC4\u570D\u3002"
    };
  }
  return {
    reason: "Google Search grounding \u672A\u80FD\u56DE\u50B3\u6709\u6548\u6458\u8981\u3002",
    followUp: "\u8ACB\u7A0D\u5F8C\u91CD\u65B0\u751F\u6210\uFF1B\u5982\u60C5\u6CC1\u6301\u7E8C\uFF0C\u8ACB\u6AA2\u67E5 Vercel runtime logs \u5167\u7684 Gemini grounding \u932F\u8AA4\u3002"
  };
}
function buildGroundingUnavailableSummary(params) {
  const periodLabel = params.mode === "monthly" ? "\u672C\u6708" : "\u672C\u5B63";
  const { reason, followUp } = getGroundingFailureReason(params.error);
  return [
    `\u5B8F\u89C0\u80CC\u666F${periodLabel}\u672A\u80FD\u53D6\u5F97\u6709\u6548 Google Search \u6458\u8981\u3002`,
    `\u539F\u56E0\uFF1A${reason}`,
    `\u8DDF\u9032\uFF1A${followUp}`,
    "\u5728\u91CD\u65B0\u751F\u6210\u524D\uFF0C\u5831\u544A\u53EA\u6703\u4EE5\u76EE\u524D\u6301\u5009\u3001\u8CC7\u7522\u5FEB\u7167\u3001\u8CC7\u7522\u5206\u4F48\u8207\u6708\u5EA6/\u5B63\u5EA6\u8B8A\u5316\u4F5C\u70BA\u4E3B\u8981\u5206\u6790\u57FA\u790E\uFF1B\u8ACB\u907F\u514D\u628A\u5B8F\u89C0\u5224\u8B80\u8996\u70BA\u5DF2\u5B8C\u6210\u7684\u5916\u90E8\u5E02\u5834\u6838\u5BE6\u3002"
  ].join("\n");
}
async function generateGeminiContentViaRest(args) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    args.model
  )}:generateContent?key=${encodeURIComponent(args.apiKey)}`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: args.prompt }] }],
      generationConfig: {
        ...typeof args.maxOutputTokens === "number" ? { maxOutputTokens: args.maxOutputTokens } : {}
      },
      ...args.googleSearch ? { tools: [{ googleSearch: {} }] } : {}
    }),
    signal: AbortSignal.timeout(args.googleSearch ? 45e3 : 6e4)
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = typeof payload === "object" && payload !== null && "error" in payload && typeof payload.error?.message === "string" ? payload.error.message : `Gemini REST request failed with status ${response.status}`;
    throw new Error(message);
  }
  return payload;
}
async function generateGroundedSearchSummary(params) {
  const prompt = getSearchSummaryPrompt(params);
  const candidates = getSearchModelCandidates();
  let lastError = null;
  for (const model of candidates) {
    try {
      const response = await generateGeminiContentViaRest({
        apiKey: getGeminiApiKey(),
        model,
        prompt,
        maxOutputTokens: 2500,
        googleSearch: true
      });
      const summary = getGeminiResponseText(response);
      if (summary) {
        return {
          provider: "google",
          model,
          summary
        };
      }
      console.warn(
        `[scheduledAnalysis] Gemini grounding returned empty summary for model ${model}; trying fallback if available.`
      );
    } catch (error) {
      console.warn(
        `[scheduledAnalysis] Gemini grounding fallback from model ${model}: ${error instanceof Error ? error.message : "unknown_error"}`
      );
      lastError = error;
    }
  }
  return {
    provider: "google",
    model: candidates[0],
    summary: buildGroundingUnavailableSummary({ mode: params.mode, error: lastError }),
    error: lastError instanceof Error ? lastError.message : "grounding_failed"
  };
}
function normalizeSnapshotDocument(value, snapshotId) {
  const holdings = Array.isArray(value.holdings) ? value.holdings.filter((item) => typeof item === "object" && item !== null).map((item) => {
    const holding = item;
    return {
      assetId: typeof holding.assetId === "string" ? holding.assetId : "",
      ticker: typeof holding.symbol === "string" ? holding.symbol : typeof holding.ticker === "string" ? holding.ticker : "",
      name: typeof holding.name === "string" ? holding.name : typeof holding.assetName === "string" ? holding.assetName : "",
      assetType: holding.assetType === "stock" || holding.assetType === "etf" || holding.assetType === "bond" || holding.assetType === "crypto" || holding.assetType === "cash" ? holding.assetType : "stock",
      accountSource: typeof holding.accountSource === "string" && holding.accountSource.trim() ? holding.accountSource.trim() : void 0,
      currency: typeof holding.currency === "string" ? normalizeCurrencyCode(holding.currency) : "HKD",
      quantity: typeof holding.quantity === "number" ? holding.quantity : 0,
      currentPrice: typeof holding.currentPrice === "number" ? holding.currentPrice : 0,
      priceAsOf: typeof holding.priceAsOf === "string" ? holding.priceAsOf : void 0,
      marketValueHKD: (() => {
        if (typeof holding.marketValueHKD === "number") {
          return holding.marketValueHKD;
        }
        const currency = typeof holding.currency === "string" ? holding.currency : "HKD";
        if (typeof holding.marketValue === "number") {
          return convertToHKDValue(holding.marketValue, currency);
        }
        const quantity = typeof holding.quantity === "number" ? holding.quantity : 0;
        const currentPrice = typeof holding.currentPrice === "number" ? holding.currentPrice : 0;
        return convertToHKDValue(quantity * currentPrice, currency);
      })()
    };
  }) : [];
  const fallbackTotalValueHKD = holdings.reduce((sum, holding) => sum + holding.marketValueHKD, 0);
  return {
    id: snapshotId,
    date: typeof value.date === "string" ? value.date : "",
    totalValueHKD: typeof value.totalValueHKD === "number" ? value.totalValueHKD : fallbackTotalValueHKD,
    netExternalFlowHKD: typeof value.netExternalFlowHKD === "number" ? value.netExternalFlowHKD : void 0,
    snapshotQuality: value.snapshotQuality === "fallback" ? "fallback" : "strict",
    coveragePct: typeof value.coveragePct === "number" ? value.coveragePct : void 0,
    fallbackAssetCount: typeof value.fallbackAssetCount === "number" ? value.fallbackAssetCount : void 0,
    missingAssetCount: typeof value.missingAssetCount === "number" ? value.missingAssetCount : void 0,
    fxSource: value.fxSource === "cron_pipeline" || value.fxSource === "persisted" || value.fxSource === "live" ? value.fxSource : "unknown",
    fxRatesUsed: typeof value.fxRatesUsed === "object" && value.fxRatesUsed !== null ? {
      USD: typeof value.fxRatesUsed.USD === "number" ? value.fxRatesUsed.USD : void 0,
      JPY: typeof value.fxRatesUsed.JPY === "number" ? value.fxRatesUsed.JPY : void 0,
      HKD: typeof value.fxRatesUsed.HKD === "number" ? value.fxRatesUsed.HKD : void 0
    } : void 0,
    holdings
  };
}
function buildSnapshotFromAssets(assets, date) {
  return {
    date,
    totalValueHKD: assets.reduce(
      (sum, asset) => sum + getAssetMarketValueHKD(asset),
      0
    ),
    holdings: assets.slice().sort((left, right) => left.id.localeCompare(right.id)).map((asset) => ({
      assetId: asset.id,
      ticker: asset.symbol,
      name: asset.name,
      assetType: asset.assetType,
      accountSource: asset.accountSource,
      currency: asset.currency,
      quantity: asset.quantity,
      currentPrice: asset.currentPrice,
      marketValueHKD: getAssetMarketValueHKD(asset)
    }))
  };
}
function getSnapshotAssetLookupKey(value) {
  return `${(value.symbol ?? value.ticker ?? "").trim().toUpperCase()}|${(value.currency ?? "").trim().toUpperCase()}`;
}
function buildAssetsFromSnapshot(snapshot, liveAssets) {
  const assetsById = new Map(liveAssets.map((asset) => [asset.id, asset]));
  const assetsByTickerCurrency = new Map(
    liveAssets.map((asset) => [getSnapshotAssetLookupKey(asset), asset])
  );
  return snapshot.holdings.map((holding) => {
    const matchedAsset = assetsById.get(holding.assetId) ?? assetsByTickerCurrency.get(getSnapshotAssetLookupKey(holding));
    const averageCost = matchedAsset?.averageCost ?? 0;
    return {
      id: holding.assetId || getSnapshotAssetLookupKey(holding),
      name: holding.name,
      symbol: holding.ticker,
      assetType: holding.assetType,
      accountSource: holding.accountSource === "Futu" || holding.accountSource === "IB" || holding.accountSource === "Crypto" || holding.accountSource === "Other" ? holding.accountSource : matchedAsset?.accountSource ?? "Other",
      currency: holding.currency,
      quantity: holding.quantity,
      averageCost,
      currentPrice: holding.currentPrice
    };
  });
}
function buildSnapshotDataQualitySummary(params) {
  const warningMessages = ["\u4EE5\u5B63\u672B\uFF0F\u6708\u521D\u6B78\u6A94\u5FEB\u7167\u54C1\u8CEA\u70BA\u6E96\uFF1B\u904E\u671F\u5373\u6642\u50F9\u683C\u6578\u91CF\u4E0D\u9069\u7528\u3002"];
  const coveragePct = params.snapshotMeta.coveragePct;
  const fallbackAssetCount = params.snapshotMeta.fallbackAssetCount;
  const missingAssetCount = params.snapshotMeta.missingAssetCount;
  if (params.snapshotMeta.snapshotQuality === "fallback") {
    warningMessages.push("\u5FEB\u7167\u4F7F\u7528 fallback \u50F9\u683C\u6216\u964D\u7D1A\u8CC7\u6599\u3002");
  }
  if (typeof coveragePct === "number" && coveragePct < 100) {
    warningMessages.push(`\u5FEB\u7167\u50F9\u683C\u8986\u84CB\u7387\u53EA\u6709 ${coveragePct}%\u3002`);
  }
  if (typeof fallbackAssetCount === "number" && fallbackAssetCount > 0) {
    warningMessages.push(`\u5FEB\u7167\u6709 ${fallbackAssetCount} \u9805\u8CC7\u7522\u6CBF\u7528 fallback \u50F9\u683C\u3002`);
  }
  if (typeof missingAssetCount === "number" && missingAssetCount > 0) {
    warningMessages.push(`\u5FEB\u7167\u6709 ${missingAssetCount} \u9805\u8CC7\u7522\u7F3A\u5C11\u50F9\u683C\u6216\u8CC7\u6599\u3002`);
  }
  let status = "ok";
  if (typeof missingAssetCount === "number" && missingAssetCount > 0 || typeof coveragePct === "number" && coveragePct < 80) {
    status = "warning";
  } else if (params.snapshotMeta.snapshotQuality === "fallback" || typeof coveragePct === "number" && coveragePct < 100 || typeof fallbackAssetCount === "number" && fallbackAssetCount > 0) {
    status = "partial";
  }
  return {
    status,
    coveragePct,
    staleAssetCount: 0,
    fallbackAssetCount,
    missingAssetCount,
    fxSource: params.snapshotMeta.fxSource ?? "unknown",
    fxRatesUsed: params.snapshotMeta.fxRatesUsed,
    oldestPriceAsOf: "",
    warningMessages
  };
}
async function readSnapshotOnOrBefore(targetDate) {
  const db = getFirebaseAdminDb();
  const portfolioRef = db.collection(SHARED_PORTFOLIO_COLLECTION).doc(SHARED_PORTFOLIO_DOC_ID);
  const snapshotBefore = await portfolioRef.collection("portfolioSnapshots").where("date", "<=", targetDate).orderBy("date", "desc").limit(1).get();
  if (!snapshotBefore.empty) {
    return normalizeSnapshotDocument(
      snapshotBefore.docs[0].data(),
      snapshotBefore.docs[0].id
    );
  }
  return null;
}
async function readRecentSnapshotHistory(limitCount = 120) {
  const db = getFirebaseAdminDb();
  const snapshot = await db.collection(SHARED_PORTFOLIO_COLLECTION).doc(SHARED_PORTFOLIO_DOC_ID).collection("portfolioSnapshots").orderBy("date", "desc").limit(limitCount).get();
  return snapshot.docs.map(
    (document) => normalizeSnapshotDocument(document.data(), document.id)
  );
}
function getMonthKey(value) {
  return value.slice(0, 7);
}
async function readPreviousQuarterSnapshot() {
  const previousQuarterEndDate = getPreviousQuarterEndDate();
  return readSnapshotOnOrBefore(previousQuarterEndDate);
}
async function readLatestSnapshotMeta(date = getHongKongDate()) {
  return readSnapshotOnOrBefore(date);
}
function getPreviousMonthStartDate(date = /* @__PURE__ */ new Date()) {
  const { year, month } = getHongKongDateParts(date);
  const previousMonth = month === 1 ? 12 : month - 1;
  const previousYear = month === 1 ? year - 1 : year;
  return `${previousYear}-${String(previousMonth).padStart(2, "0")}-01`;
}
function getCurrentMonthStartDate(date = /* @__PURE__ */ new Date()) {
  const { year, month } = getHongKongDateParts(date);
  return `${year}-${String(month).padStart(2, "0")}-01`;
}
function getDateDistanceInDays(leftDate, rightDate) {
  const left = /* @__PURE__ */ new Date(`${leftDate}T00:00:00Z`);
  const right = /* @__PURE__ */ new Date(`${rightDate}T00:00:00Z`);
  return Math.abs(left.getTime() - right.getTime()) / (24 * 60 * 60 * 1e3);
}
function selectNearestSnapshotToDate(snapshots, targetDate, toleranceDays = MONTHLY_BASELINE_SNAPSHOT_TOLERANCE_DAYS) {
  const exactMonth = getMonthKey(targetDate);
  const candidates = snapshots.filter((snapshot) => snapshot.date && getDateDistanceInDays(snapshot.date, targetDate) <= toleranceDays).sort((left, right) => {
    const distanceDelta = getDateDistanceInDays(left.date, targetDate) - getDateDistanceInDays(right.date, targetDate);
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
async function readPreviousMonthSnapshot(date = /* @__PURE__ */ new Date()) {
  const targetDate = getPreviousMonthStartDate(date);
  const history = await readRecentSnapshotHistory(120);
  return selectNearestSnapshotToDate(history, targetDate);
}
async function readCurrentMonthStartSnapshot(date = /* @__PURE__ */ new Date()) {
  const targetDate = getCurrentMonthStartDate(date);
  const history = await readRecentSnapshotHistory(120);
  return selectNearestSnapshotToDate(history, targetDate, MONTHLY_BASELINE_SNAPSHOT_TOLERANCE_DAYS);
}
function getOldestPriceDate(assets) {
  return assets.map((asset) => asset.lastPriceUpdatedAt ?? asset.priceAsOf ?? "").filter(Boolean).sort()[0];
}
function getStaleAssetCount(assets, now = /* @__PURE__ */ new Date()) {
  return assets.filter((asset) => {
    const timestamp = asset.lastPriceUpdatedAt ?? asset.priceAsOf;
    if (!timestamp) {
      return true;
    }
    const updatedAt = new Date(timestamp);
    if (Number.isNaN(updatedAt.getTime())) {
      return true;
    }
    return now.getTime() - updatedAt.getTime() > 24 * 60 * 60 * 1e3;
  }).length;
}
function buildReportDataQualitySummary(params) {
  const now = params.now ?? /* @__PURE__ */ new Date();
  const snapshotMeta = params.snapshotMeta ?? null;
  const staleAssetCount = getStaleAssetCount(params.assets, now);
  const coveragePct = snapshotMeta?.coveragePct;
  const fallbackAssetCount = snapshotMeta?.fallbackAssetCount;
  const missingAssetCount = snapshotMeta?.missingAssetCount;
  const warningMessages = [];
  if (snapshotMeta?.snapshotQuality === "fallback") {
    warningMessages.push("\u5FEB\u7167\u4F7F\u7528 fallback \u50F9\u683C\u6216\u964D\u7D1A\u8CC7\u6599\u3002");
  }
  if (typeof coveragePct === "number" && coveragePct < 100) {
    warningMessages.push(`\u50F9\u683C\u8986\u84CB\u7387\u53EA\u6709 ${coveragePct}%\u3002`);
  }
  if (typeof fallbackAssetCount === "number" && fallbackAssetCount > 0) {
    warningMessages.push(`\u6709 ${fallbackAssetCount} \u9805\u8CC7\u7522\u6CBF\u7528 fallback \u50F9\u683C\u3002`);
  }
  if (typeof missingAssetCount === "number" && missingAssetCount > 0) {
    warningMessages.push(`\u6709 ${missingAssetCount} \u9805\u8CC7\u7522\u7F3A\u5C11\u50F9\u683C\u6216\u5FEB\u7167\u8CC7\u6599\u3002`);
  }
  if (staleAssetCount > 0) {
    warningMessages.push(`\u6709 ${staleAssetCount} \u9805\u8CC7\u7522\u50F9\u683C\u8D85\u904E 24 \u5C0F\u6642\u672A\u66F4\u65B0\u3002`);
  }
  if (!snapshotMeta) {
    warningMessages.push("\u672A\u80FD\u8B80\u5230\u6700\u65B0 snapshot metadata\uFF0C\u90E8\u5206\u8CC7\u6599\u54C1\u8CEA\u6307\u6A19\u53EF\u80FD\u4E0D\u8DB3\u3002");
  }
  let status = "ok";
  if (warningMessages.length > 0 && (typeof missingAssetCount === "number" && missingAssetCount > 0 || typeof coveragePct === "number" && coveragePct < 80 || !snapshotMeta)) {
    status = "warning";
  } else if (warningMessages.length > 0) {
    status = "partial";
  }
  return {
    status,
    coveragePct,
    staleAssetCount,
    fallbackAssetCount,
    missingAssetCount,
    fxSource: snapshotMeta?.fxSource ?? "unknown",
    fxRatesUsed: snapshotMeta?.fxRatesUsed,
    oldestPriceAsOf: getOldestPriceDate(params.assets),
    warningMessages
  };
}
function formatReportDataQualitySummaryForPrompt(summary, title) {
  const lines = [
    `${title}`,
    `- \u72C0\u614B\uFF1A${summary.status}`,
    `- \u50F9\u683C\u8986\u84CB\u7387\uFF1A${typeof summary.coveragePct === "number" ? `${summary.coveragePct}%` : "\u672A\u63D0\u4F9B"}`,
    `- \u532F\u7387\u4F86\u6E90\uFF1A${summary.fxSource ?? "unknown"}`,
    `- \u904E\u671F\u50F9\u683C\u8CC7\u7522\u6578\uFF1A${summary.staleAssetCount}`
  ];
  if (summary.oldestPriceAsOf) {
    lines.push(`- \u6700\u820A\u50F9\u683C\u65E5\u671F\uFF1A${summary.oldestPriceAsOf}`);
  }
  if (typeof summary.fallbackAssetCount === "number") {
    lines.push(`- fallback \u50F9\u683C\u8CC7\u7522\u6578\uFF1A${summary.fallbackAssetCount}`);
  }
  if (typeof summary.missingAssetCount === "number") {
    lines.push(`- \u7F3A\u5931\u8CC7\u7522\u6578\uFF1A${summary.missingAssetCount}`);
  }
  if (summary.warningMessages.length > 0) {
    lines.push(...summary.warningMessages.map((message) => `- \u9650\u5236\uFF1A${message}`));
  } else {
    lines.push("- \u8CC7\u6599\u5B8C\u6574\uFF0C\u53EF\u4F5C\u4E00\u822C\u89E3\u8B80\u3002");
  }
  return lines.join("\n");
}
function getAccountSourceLabel(accountSource) {
  if (accountSource === "Futu") return "Futu";
  if (accountSource === "IB") return "IB";
  if (accountSource === "Crypto") return "Crypto";
  if (accountSource === "Other") return "\u5176\u4ED6";
  return accountSource || "\u672A\u8A18\u9304";
}
function getReportHoldingGroupKey(holding) {
  return [
    holding.ticker.trim().toUpperCase(),
    holding.name.trim().toLowerCase(),
    String(holding.assetType || "").trim().toLowerCase(),
    holding.currency.trim().toUpperCase()
  ].join("|");
}
function buildGroupedCurrentHoldings(holdings) {
  const groups = /* @__PURE__ */ new Map();
  for (const holding of holdings) {
    const groupKey = getReportHoldingGroupKey(holding);
    const marketValueLocal = holding.quantity * holding.currentPrice;
    const accountSource = holding.accountSource?.trim() || "unknown";
    const existing = groups.get(groupKey);
    if (!existing) {
      groups.set(groupKey, {
        ticker: holding.ticker,
        name: holding.name,
        assetType: holding.assetType,
        currency: holding.currency,
        quantity: holding.quantity,
        currentPrice: holding.currentPrice,
        marketValueHKD: holding.marketValueHKD,
        marketValueLocal,
        accountSources: [
          {
            accountSource,
            label: getAccountSourceLabel(accountSource),
            quantity: holding.quantity,
            marketValueHKD: holding.marketValueHKD,
            marketValueLocal
          }
        ]
      });
      continue;
    }
    existing.quantity += holding.quantity;
    existing.marketValueHKD += holding.marketValueHKD;
    existing.marketValueLocal = (existing.marketValueLocal ?? 0) + marketValueLocal;
    existing.currentPrice = existing.quantity === 0 ? holding.currentPrice : (existing.marketValueLocal ?? 0) / existing.quantity;
    const accountSources = existing.accountSources ?? [];
    const accountEntry = accountSources.find((entry) => entry.accountSource === accountSource);
    if (accountEntry) {
      accountEntry.quantity += holding.quantity;
      accountEntry.marketValueHKD += holding.marketValueHKD;
      accountEntry.marketValueLocal = (accountEntry.marketValueLocal ?? 0) + marketValueLocal;
    } else {
      accountSources.push({
        accountSource,
        label: getAccountSourceLabel(accountSource),
        quantity: holding.quantity,
        marketValueHKD: holding.marketValueHKD,
        marketValueLocal
      });
    }
    existing.accountSources = accountSources.sort(
      (left, right) => right.marketValueHKD - left.marketValueHKD
    );
  }
  return [...groups.values()].sort((left, right) => right.marketValueHKD - left.marketValueHKD);
}
function buildReportFactsPayload(params) {
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
    fxSource: params.fxSource ?? "unknown",
    dataQualitySummary: params.dataQualitySummary,
    topHoldingsByHKD: params.topHoldingsByHKD.slice(0, 10).map((holding) => ({
      ticker: holding.ticker,
      name: holding.name,
      currency: holding.currency,
      marketValueHKD: holding.marketValueHKD,
      marketValueLocal: holding.marketValue
    })),
    currentHoldings: buildGroupedCurrentHoldings(params.currentSnapshot.holdings),
    allocationByType: params.allocationSummary.slices,
    allocationByCurrency: params.allocationsByCurrency,
    model: params.model,
    provider: params.provider,
    snapshotHash: params.snapshotHash,
    promptVersion: REPORT_PROMPT_VERSION
  };
}
function isPlainObject(value) {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
function sanitizeForFirestore(value) {
  if (value === void 0) {
    return void 0;
  }
  if (value === null || typeof value === "number" || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeForFirestore(item)).filter((item) => item !== void 0);
  }
  if (value instanceof Date) {
    return value;
  }
  if (!isPlainObject(value)) {
    return value;
  }
  const sanitizedEntries = Object.entries(value).flatMap(([key, nestedValue]) => {
    const sanitizedValue = sanitizeForFirestore(nestedValue);
    return sanitizedValue === void 0 ? [] : [[key, sanitizedValue]];
  });
  return Object.fromEntries(sanitizedEntries);
}
function buildAnalysisSessionWritePayload(params) {
  const sanitizedReportFactsPayload = params.reportFactsPayload ? sanitizeForFirestore(params.reportFactsPayload) : void 0;
  return {
    category: params.response.category,
    title: params.title,
    question: params.response.analysisQuestion,
    result: params.response.answer,
    model: params.response.model,
    provider: params.response.provider,
    snapshotHash: params.response.snapshotHash,
    delivery: params.delivery ?? "scheduled",
    isTimeoutFallback: params.response.isTimeoutFallback === true,
    ...params.periodStartDate ? { periodStartDate: params.periodStartDate } : {},
    ...params.periodEndDate ? { periodEndDate: params.periodEndDate } : {},
    ...params.allocationSummary ? { allocationSummary: params.allocationSummary } : {},
    ...sanitizedReportFactsPayload ? { reportFactsPayload: sanitizedReportFactsPayload } : {},
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp()
  };
}
function buildQuarterlyReportWritePayload(params) {
  const sanitizedReportFactsPayload = params.reportFactsPayload ? sanitizeForFirestore(params.reportFactsPayload) : void 0;
  return {
    quarter: params.quarter,
    generatedAt: params.generatedAt,
    report: params.report,
    currentSnapshotHash: params.currentSnapshotHash,
    previousSnapshotDate: params.previousSnapshotDate ?? "",
    searchSummary: params.searchSummary,
    model: params.model,
    provider: params.provider,
    isTimeoutFallback: params.isTimeoutFallback === true,
    ...params.allocationSummary ? { allocationSummary: params.allocationSummary } : {},
    ...sanitizedReportFactsPayload ? { reportFactsPayload: sanitizedReportFactsPayload } : {},
    pdfUrl: "",
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp()
  };
}
function buildMonthlyTrendSnapshots(snapshots) {
  return selectRecentDistinctMonthlySnapshots(snapshots, 3);
}
function buildComparisonPromptSections(comparison, opts) {
  const limitHoldings = opts?.limitHoldings ?? 12;
  const holdingLines = comparison.holdingChanges.filter((change) => change.status !== "unchanged" || Math.abs(change.contributionToPortfolioChange) > 0.01).slice(0, limitHoldings).map(
    (change) => `- ${change.ticker} ${change.name}\uFF5C${change.status}\uFF5C\u73FE\u503C ${change.currentValue.toFixed(2)} HKD\uFF5C\u524D\u503C ${change.previousValue.toFixed(2)} HKD\uFF5C\u5009\u4F4D\u8B8A\u5316 ${change.quantityChange.toFixed(2)}\uFF5C\u50F9\u683C\u8B8A\u5316 ${change.priceChangePercent.toFixed(1)}%\uFF5C\u50F9\u683C\u6548\u61C9 ${change.priceEffectHKD.toFixed(2)} HKD\uFF5C\u8CB7\u8CE3\u6548\u61C9 ${change.flowEffectHKD.toFixed(2)} HKD\uFF5C\u7D44\u5408\u8B8A\u5316 ${change.contributionToPortfolioChange.toFixed(2)} HKD`
  );
  const gainers = comparison.topMovers.gainers.map(
    (item) => `- ${item.ticker}\uFF1A${item.changePercent.toFixed(1)}%\uFF5C\u8CA2\u737B ${item.contributionHKD.toFixed(2)} HKD`
  ).join("\n");
  const losers = comparison.topMovers.losers.map(
    (item) => `- ${item.ticker}\uFF1A${item.changePercent.toFixed(1)}%\uFF5C\u62D6\u7D2F ${item.contributionHKD.toFixed(2)} HKD`
  ).join("\n");
  return [
    `\u3010\u671F\u9593\u3011${comparison.periodLabel}`,
    `\u3010\u7E3D\u8CC7\u7522\u8B8A\u5316\u3011\u73FE\u503C ${comparison.totalValue.current.toFixed(2)} HKD\uFF5C\u524D\u503C ${comparison.totalValue.previous.toFixed(2)} HKD\uFF5C\u8B8A\u5316 ${comparison.totalValue.changeHKD.toFixed(2)} HKD\uFF5C${comparison.totalValue.changePercent.toFixed(1)}%`,
    typeof comparison.totalValue.netExternalFlowCoveragePct === "number" && comparison.totalValue.netExternalFlowCoveragePct < 80 ? "\u3010\u6263\u9664\u8CC7\u91D1\u6D41\u5F8C\u8B8A\u5316\u3011\u8CC7\u91D1\u6D41\u8986\u84CB\u4E0D\u8DB3\uFF0C\u66AB\u4E0D\u8A08\u6263\u9664\u8CC7\u91D1\u6D41\u5F8C\u8868\u73FE\u3002" : typeof comparison.totalValue.netExternalFlowHKD === "number" && typeof comparison.totalValue.investmentGainHKD === "number" && typeof comparison.totalValue.investmentGainPercent === "number" ? comparison.totalValue.cashFlowDataComplete ? `\u3010\u6263\u9664\u8CC7\u91D1\u6D41\u5F8C\u8B8A\u5316\u3011\u6DE8\u5165\u91D1\uFF0F\u51FA\u91D1 ${comparison.totalValue.netExternalFlowHKD.toFixed(2)} HKD\uFF5C\u6295\u8CC7\u8868\u73FE ${comparison.totalValue.investmentGainHKD.toFixed(2)} HKD\uFF5C${comparison.totalValue.investmentGainPercent.toFixed(1)}%` : `\u3010\u6263\u9664\u8CC7\u91D1\u6D41\u5F8C\u8B8A\u5316\u3011\u8CC7\u91D1\u6D41\u8CC7\u6599\u672A\u5B8C\u5168\u8986\u84CB\uFF5C\u6DE8\u5165\u91D1\uFF0F\u51FA\u91D1 ${comparison.totalValue.netExternalFlowHKD.toFixed(2)} HKD\uFF5C\u6295\u8CC7\u8868\u73FE ${comparison.totalValue.investmentGainHKD.toFixed(2)} HKD\uFF5C${comparison.totalValue.investmentGainPercent.toFixed(1)}%` : "\u3010\u6263\u9664\u8CC7\u91D1\u6D41\u5F8C\u8B8A\u5316\u3011\u672A\u80FD\u5B8C\u6574\u6263\u9664\u5165\u91D1\uFF0F\u51FA\u91D1\uFF0C\u4EE5\u4E0B\u53EA\u53CD\u6620\u7E3D\u8CC7\u7522\u8B8A\u5316\u3002",
    `\u3010\u8CC7\u7522\u985E\u5225\u8B8A\u5316\u3011`,
    ...comparison.assetTypeChanges.map(
      (entry) => `- ${entry.assetType}\uFF1A${entry.previousPercent.toFixed(1)}% \u2192 ${entry.currentPercent.toFixed(1)}%\uFF08${entry.deltaPercent.toFixed(1)}pp\uFF09`
    ),
    `\u3010\u5E63\u5225\u66DD\u96AA\u8B8A\u5316\u3011`,
    ...comparison.currencyChanges.map(
      (entry) => `- ${entry.currency}\uFF1A${entry.previousPercent.toFixed(1)}% \u2192 ${entry.currentPercent.toFixed(1)}%\uFF08${entry.deltaPercent.toFixed(1)}pp\uFF09`
    ),
    `\u3010\u6301\u5009\u8B8A\u52D5\u3011`,
    ...holdingLines,
    `\u3010\u6700\u5927\u8CA2\u737B\u8005\u3011`,
    gainers || "- \u7121\u6B63\u8CA2\u737B\u6301\u5009",
    `\u3010\u6700\u5927\u62D6\u7D2F\u8005\u3011`,
    losers || "- \u7121\u8CA0\u8CA2\u737B\u6301\u5009",
    `\u3010\u671F\u5167\u65B0\u589E\u6301\u5009\u3011`,
    comparison.newHoldings.map((item) => `- ${item.ticker}\uFF1A${item.valueHKD.toFixed(2)} HKD`).join("\n") || "- \u7121\u65B0\u589E\u6301\u5009"
  ].join("\n");
}
function formatReportAllocationSummaryForPrompt(summary) {
  const sliceLines = summary.slices.map(
    (slice) => `- ${slice.label}\uFF1A${slice.percentage.toFixed(1)}%\uFF0C${slice.totalValueHKD.toFixed(2)} HKD`
  );
  const deltaLines = summary.deltas?.length ? summary.deltas.map((delta) => {
    const slice = summary.slices.find((item) => item.key === delta.key);
    const label = slice?.label ?? delta.key;
    return `- ${label}\uFF1A${delta.deltaPercentagePoints >= 0 ? "+" : ""}${delta.deltaPercentagePoints.toFixed(1)}pp`;
  }) : ["- \u672A\u6709\u53EF\u6BD4\u8F03\u7684\u4E0A\u671F\u5FEB\u7167"];
  return [
    `\u3010\u7CFB\u7D71\u8CC7\u7522\u5206\u4F48\u7E3D\u89BD\u3011\u622A\u81F3 ${summary.asOfDate}`,
    `\u914D\u7F6E\u98A8\u683C\uFF1A${summary.styleTag}`,
    `\u63D0\u793A\u6A19\u7C64\uFF1A${summary.warningTags.join("\u3001") || "\u7121"}`,
    `\u7CFB\u7D71\u5224\u8B80\uFF1A${summary.summarySentence ?? "\u672A\u6709\u5224\u8B80"}`,
    "\u76EE\u524D\u5206\u4F48\uFF1A",
    ...sliceLines,
    `${summary.comparisonLabel ?? "\u4E0A\u671F"}\u8B8A\u5316\uFF1A`,
    ...deltaLines,
    "\u6CE8\u610F\uFF1A\u4EE5\u4E0A\u5206\u4F48\u5DF2\u7531\u7CFB\u7D71\u5728\u5716\u50CF\u5361\u986F\u793A\uFF0C\u6B63\u6587\u53EA\u53EF\u505A\u5224\u8B80\uFF0C\u4E0D\u8981\u91CD\u8986\u5217\u51FA\u6BCF\u500B\u767E\u5206\u6BD4\u3002"
  ].join("\n");
}
function buildMonthlyAnalysisQuestion(params) {
  const comparisonText = params.comparison ? buildComparisonPromptSections(params.comparison, { limitHoldings: 12 }) : "\u7F3A\u5C11\u57FA\u6E96 snapshot\uFF08\u4E0A\u500B\u6708 1 \u865F\u6216\u5408\u7406\u5BB9\u5FCD\u7BC4\u570D\u5167\u672A\u627E\u5230\uFF09\uFF1B\u8ACB\u660E\u78BA\u6307\u51FA\u7F3A\u5C11\u57FA\u6E96 snapshot\uFF0C\u4E26\u53EA\u6839\u64DA\u76EE\u524D\u6301\u5009\u8207\u7CFB\u7D71\u5206\u4F48\u7E3D\u89BD\u505A\u76E3\u5BDF\u53CA\u4E0B\u6708\u884C\u52D5\u5EFA\u8B70\uFF0C\u4E0D\u8981\u5047\u8A2D\u6708\u5EA6\u8B8A\u5316\u3002";
  const macroSummaryText = [
    "\u3010\u904E\u53BB\u4E00\u500B\u6708\u5B8F\u89C0\u8207\u5E02\u5834\u80CC\u666F\u6458\u8981\u3011",
    params.searchSummary.trim() || "\u672A\u6709\u53EF\u7528\u7684\u5916\u90E8\u5E02\u5834\u80CC\u666F\u6458\u8981\uFF1B\u5982\u5F15\u7528\u5B8F\u89C0\u5224\u8B80\uFF0C\u8ACB\u660E\u78BA\u6307\u51FA\u8CC7\u6599\u9650\u5236\u3002",
    "\u4F60\u5FC5\u9808\u5F15\u7528\u6B64\u6458\u8981\uFF0C\u4E26\u5C07\u5176\u8207\u76EE\u524D\u8CC7\u7522\u914D\u7F6E\u3001\u6708\u5EA6\u8B8A\u5316\u3001\u5E63\u5225\u66DD\u96AA\u9010\u9805\u5C0D\u7167\uFF1B\u4E0D\u53EF\u53EA\u505A\u4E00\u822C\u914D\u7F6E\u8A3A\u65B7\u3002"
  ].join("\n");
  return [
    "\u8ACB\u64B0\u5BEB\u4E00\u4EFD\u300C\u6BCF\u6708\u8CC7\u7522\u5206\u6790\u300D\uFF0C\u5B9A\u4F4D\u4FC2\u76E3\u5BDF / \u544A\u8B66 / \u4E0B\u6708\u884C\u52D5\u3002",
    "\u4F60\u6703\u540C\u6642\u6536\u5230\uFF1A\u5916\u90E8\u5E02\u5834\u80CC\u666F\u6458\u8981\u3001\u7CFB\u7D71\u8CC7\u7522\u5206\u4F48\u7E3D\u89BD\u3001\u6708\u5EA6\u5C0D\u6BD4\u3001cash-flow adjusted return \u8207\u8CC7\u6599\u54C1\u8CEA\u6AA2\u67E5\u3002\u8ACB\u628A\u5B8F\u89C0\u80CC\u666F\u540C\u6211\u5BE6\u969B\u8CC7\u7522\u5206\u4F48\u3001\u8CC7\u7522\u8B8A\u5316\u4E92\u76F8\u5C0D\u7167\uFF0C\u800C\u5514\u4FC2\u5206\u958B\u5404\u8B1B\u5404\u3002",
    "\u8CC7\u7522\u5206\u4F48\u7E3D\u89BD\u5DF2\u7531\u7CFB\u7D71\u7528\u771F\u5BE6\u8CC7\u6599\u8A08\u7B97\u4E26\u986F\u793A\u5728\u6B63\u6587\u524D\uFF1B\u4E0D\u8981\u8F38\u51FA\u5716\u8868\u8CC7\u6599\u3001\u8868\u683C\uFF0C\u4EA6\u4E0D\u8981\u9010\u9805\u91CD\u8986\u767E\u5206\u6BD4\u5206\u5E03\u6216\u5217\u51FA\u6240\u6709\u6301\u5009\u3002",
    "\u5FC5\u9808\u6309\u4EE5\u4E0B\u9806\u5E8F\u8F38\u51FA\uFF0C\u6BCF\u6BB5\u7528\u3010\u3011\u505A\u6A19\u984C\uFF1A",
    "\u3010\u672C\u6708\u4E00\u53E5\u7E3D\u7D50\u3011\uFF081 \u53E5\uFF1B\u5FC5\u9808\u540C\u6642\u63D0\u53CA\u672C\u6708\u8CC7\u7522\u8B8A\u5316\u65B9\u5411\u3001\u4E3B\u8981\u5B8F\u89C0 / \u5E02\u5834\u80CC\u666F\uFF0C\u4EE5\u53CA\u7D44\u5408\u6700\u5927\u98A8\u96AA\u6216\u6700\u91CD\u8981\u6A5F\u6703\uFF09",
    "\u3010\u672C\u6708\u8CC7\u7522\u8B8A\u5316\u6458\u8981\u3011\uFF08\u5FC5\u9808\u5340\u5206\u7E3D\u8CC7\u7522\u8B8A\u5316\u3001\u6DE8\u5165\u91D1\uFF0F\u51FA\u91D1\u3001\u6263\u9664\u8CC7\u91D1\u6D41\u5F8C\u8868\u73FE\u3001\u8CC7\u91D1\u6D41\u8986\u84CB\u7387\u3001\u6700\u5927\u8CA2\u737B\u8005 / \u6700\u5927\u62D6\u7D2F\u8005\uFF1B\u5982\u679C\u56DE\u5831\u96C6\u4E2D\u65BC\u5C11\u6578\u8CC7\u7522\uFF0C\u8981\u660E\u78BA\u6307\u51FA\uFF09",
    "\u3010\u7D44\u5408\u5065\u5EB7\u6AA2\u67E5\u3011\uFF08\u627F\u63A5\u7CFB\u7D71\u5206\u4F48\u7E3D\u89BD\uFF0C\u52A0\u5165 risk-on / risk-off\u3001\u73FE\u91D1 / \u50B5\u5238\u9632\u5B88\u80FD\u529B\u3001\u5E63\u5225\u66DD\u96AA\u5224\u8B80\uFF1B\u5982\u8CC7\u6599\u54C1\u8CEA\u6709\u9650\u8981\u4E3B\u52D5\u6536\u7A84\u7D50\u8AD6\uFF09",
    "\u3010\u4E09\u500B\u91CD\u9EDE\u89C0\u5BDF\u3011\uFF08\u525B\u597D 3 \u9EDE\uFF1B\u6BCF\u9EDE\u90FD\u8981\u7528\u300C\u5B8F\u89C0\u80CC\u666F \u2192 \u5C0D\u6211\u8CC7\u7522\u7684\u5F71\u97FF \u2192 \u6295\u8CC7\u542B\u7FA9\u300D\u683C\u5F0F\uFF0C\u4E26\u5F15\u7528\u6301\u5009\u3001\u91D1\u984D\u3001\u5206\u4F48\u6216\u8B8A\u5316\uFF09",
    "\u3010\u4E0B\u6708\u884C\u52D5\u5EFA\u8B70\u3011\uFF082-4 \u9EDE\uFF0C\u5FC5\u9808\u5206\u6210\u300C\u5FC5\u9808\u8DDF\u9032 / \u53EF\u4EE5\u8003\u616E / \u66AB\u6642\u4E0D\u5EFA\u8B70\u300D\u985E\u578B\uFF0C\u5168\u90E8\u90FD\u8981\u5BEB\u660E\u89F8\u767C\u689D\u4EF6\uFF1B\u4E0D\u8981\u5BEB\u6210\u76F4\u63A5\u8CB7\u8CE3\u6307\u4EE4\u6216\u78BA\u5B9A\u6027\u50F9\u683C\u9810\u6E2C\uFF09",
    "",
    "\u898F\u5247\uFF1A",
    "\u6240\u6709\u7D50\u8AD6\u5FC5\u9808\u5F15\u7528 input \u5167\u7684\u8CC7\u6599\uFF1B\u4E0D\u8981\u865B\u69CB\u65B0\u805E\u3001\u4F30\u503C\u6216\u5B8F\u89C0\u8CC7\u6599\u3002",
    "\u5982\u679C staleAssetCount > 0\uFF0C\u8981\u660E\u78BA\u6307\u51FA\u54EA\u4E9B\u7D50\u8AD6\u53D7\u50F9\u683C\u6642\u6548\u9650\u5236\u5F71\u97FF\u3002",
    "\u5982\u679C dataQualitySummary.status \u4FC2 partial \u6216 warning\uFF0C\u7D44\u5408\u5065\u5EB7\u6AA2\u67E5\u8207\u4E0B\u6708\u884C\u52D5\u5EFA\u8B70\u8981\u504F\u4FDD\u5B88\uFF0C\u907F\u514D\u4E0B\u904E\u5F37\u5224\u65B7\u3002",
    "\u5982\u679C dataQualitySummary.status \u4FC2 partial \u6216 warning\uFF0C\u3010\u4E0B\u6708\u884C\u52D5\u5EFA\u8B70\u3011\u5FC5\u9808\u628A\u8CC7\u6599\u4FEE\u5FA9\u5217\u5165\u300C\u5FC5\u9808\u8DDF\u9032\u300D\uFF0C\u4E0D\u53EF\u53EA\u653E\u5728\u5099\u8A3B\u3002",
    "\u5982\u679C\u8CC7\u91D1\u6D41\u8986\u84CB\u7387\u5514\u4FC2 100%\uFF0C\u8981\u4FDD\u7559\u9650\u5236\u63D0\u793A\uFF0C\u907F\u514D\u628A\u6240\u6709\u5347\u8DCC\u90FD\u7576\u6210\u6295\u8CC7\u56DE\u5831\u3002",
    "\u5982\u679C comparison \u986F\u793A\u67D0\u6301\u5009 previous value \u70BA 0\uFF0C\u6216\u5927\u91CF\u6301\u5009\u88AB\u6A19\u793A\u70BA new\uFF0C\u4E0D\u53EF\u76F4\u63A5\u8AAA\u8A72\u6301\u5009\u8CA2\u737B\u4E86\u5168\u90E8\u5347\u5E45\uFF1B\u9664\u975E\u6709\u53EF\u6BD4\u524D\u503C\uFF0C\u5426\u5247\u5FC5\u9808\u5BEB\u660E\u8B8A\u5316\u53EF\u80FD\u6DF7\u5408\u65B0\u5EFA\u5009\u3001\u8CC7\u6599\u88DC\u9304\u3001snapshot matching \u6216 baseline holdings \u7F3A\u5931\u3002",
    "\u5982\u679C\u67D0\u8CC7\u7522 costValue \u6216 averageCost \u70BA 0\uFF0C\u4E0D\u53EF\u628A\u5DEE\u984D\u5224\u65B7\u70BA\u5168\u70BA\u672A\u5BE6\u73FE\u5229\u6F64\uFF1B\u5FC5\u9808\u5BEB\u6210\u300C\u6210\u672C\u8CC7\u6599\u70BA 0 \u6216\u7F3A\u5931\uFF0C\u7121\u6CD5\u6E96\u78BA\u5224\u65B7\u5BE6\u969B\u76C8\u8667\u300D\uFF0C\u4E26\u628A\u88DC\u56DE\u6210\u672C\u8CC7\u6599\u5217\u70BA\u300C\u5FC5\u9808\u8DDF\u9032\u300D\u3002",
    "\u5E63\u5225\u66DD\u96AA\u5206\u6790\u5FC5\u9808\u5206\u6E05\u5831\u50F9\u8CA8\u5E63\u66DD\u96AA\u3001\u7D93\u6FDF\u98A8\u96AA\u66DD\u96AA\uFF1B\u52A0\u5BC6\u8CA8\u5E63\u4EE5 USD \u5831\u50F9\uFF0C\u4E0D\u7B49\u65BC\u5B8C\u5168\u7F8E\u5143\u8CC7\u7522\u3002",
    "\u4E0B\u6708\u884C\u52D5\u5EFA\u8B70\u7684\u89F8\u767C\u689D\u4EF6\u5FC5\u9808\u76E1\u91CF\u91CF\u5316\uFF0C\u4F8B\u5982\uFF1A\u55AE\u4E00\u8CC7\u7522 > 20%\u3001\u52A0\u5BC6\u5408\u8A08 > 30%\u3001\u73FE\u91D1 < 3%\u3001SGOV + \u73FE\u91D1 < 10%\u3001BTC 7 \u65E5\u8DCC\u5E45 > 15%\u3001\u9AD8 beta \u80A1\u7968\u5408\u8A08\u8D85\u904E\u80A1\u7968\u90E8\u4F4D 60%\u3002",
    "\u4E0D\u8981\u91CD\u8986 summary card \u5DF2\u986F\u793A\u7684\u767E\u5206\u6BD4\u5206\u5E03\uFF0C\u53EA\u9700\u8F38\u51FA\u9AD8\u50F9\u503C\u89C0\u5BDF\u3002",
    "\u6BCF\u6BB5\u77ED\u800C\u6E96\uFF0C\u7E41\u9AD4\u4E2D\u6587\u8F38\u51FA\uFF0C\u6574\u4EFD\u6708\u5831\u4FDD\u6301\u6E05\u6670\u53EF\u8B80\uFF0C\u4E0D\u8981\u5BEB\u6210\u9577\u7BC7\u6587\u7AE0\u3002",
    "",
    macroSummaryText,
    "",
    formatReportAllocationSummaryForPrompt(params.allocationSummary),
    "",
    formatReportDataQualitySummaryForPrompt(params.dataQualitySummary, "\u3010\u8CC7\u6599\u54C1\u8CEA\u6AA2\u67E5\u3011"),
    "",
    "\u5C0D\u6BD4\u6578\u64DA\uFF1A",
    comparisonText
  ].join("\n");
}
function buildQuarterlyAnalysisQuestion(params) {
  const { currentComparison, trendComparisons, allocationSummary, dataQualitySummary } = params;
  const currentComparisonText = currentComparison ? buildComparisonPromptSections(currentComparison, { limitHoldings: 12 }) : "\u672A\u6709\u53EF\u6BD4\u8F03\u7684\u4E0A\u4E0A\u5B63\u672B\u5FEB\u7167\uFF1B\u8ACB\u53EA\u6839\u64DA\u5B63\u672B\u5FEB\u7167\u3001\u7CFB\u7D71\u5206\u4F48\u7E3D\u89BD\u8207\u53EF\u7528\u8DA8\u52E2\u8CC7\u6599\u6B78\u6A94\uFF0C\u4E0D\u8981\u5047\u8A2D\u5B63\u5EA6\u8B8A\u5316\u3002";
  const trendSections = trendComparisons.map(
    (comparison, index) => [`\u3010\u8DA8\u52E2 ${index + 1}\u3011`, buildComparisonPromptSections(comparison, { limitHoldings: 8 })].join("\n")
  ).join("\n\n");
  const macroSummaryText = [
    "\u3010\u672C\u5B63\u5B8F\u89C0\u8207\u5E02\u5834\u80CC\u666F\u6458\u8981\u3011",
    params.searchSummary.trim() || "\u672A\u6709\u53EF\u7528\u7684\u5916\u90E8\u5E02\u5834\u80CC\u666F\u6458\u8981\uFF1B\u5982\u5F15\u7528\u5B8F\u89C0\u5224\u8B80\uFF0C\u8ACB\u660E\u78BA\u6307\u51FA\u8CC7\u6599\u9650\u5236\u3002",
    "\u4F60\u5FC5\u9808\u5F15\u7528\u6B64\u6458\u8981\uFF0C\u4E26\u5C07\u5176\u8207\u5B63\u5EA6\u8CC7\u7522\u8B8A\u5316\u3001\u914D\u7F6E\u5206\u4F48\u3001\u5E63\u5225\u66DD\u96AA\u4E92\u76F8\u5C0D\u7167\uFF1B\u4E0D\u53EF\u53EA\u505A\u4E00\u822C\u914D\u7F6E\u8A3A\u65B7\u3002"
  ].join("\n");
  const trendMissingText = params.trendMissingLabels?.length ? `\u5B63\u5167\u6708\u5EA6\u8DA8\u52E2\u9650\u5236\uFF1A${params.trendMissingLabels.join("\u3001")} \u5FEB\u7167\u7F3A\u5931\uFF0C\u8DA8\u52E2\u6BB5\u4E0D\u5B8C\u6574\u3002` : "\u5B63\u5167\u6708\u5EA6\u8DA8\u52E2\u5FEB\u7167\u5B8C\u6574\u3002";
  return [
    "\u8ACB\u64B0\u5BEB\u4E00\u4EFD\u300C\u5B63\u5EA6\u8CC7\u7522\u5831\u544A\u300D\uFF0C\u5B9A\u4F4D\u4FC2\u7E3D\u7D50 / \u6B78\u56E0 / \u6B63\u5F0F\u6B78\u6A94\u3002",
    "\u8CC7\u7522\u5206\u4F48\u7E3D\u89BD\u5DF2\u7531\u7CFB\u7D71\u7528\u771F\u5BE6\u8CC7\u6599\u8A08\u7B97\u4E26\u986F\u793A\u5728\u6B63\u6587\u524D\uFF1B\u4E0D\u8981\u8F38\u51FA\u5716\u8868\u8CC7\u6599\u3001\u8868\u683C\uFF0C\u4EA6\u4E0D\u8981\u9010\u9805\u91CD\u8986\u767E\u5206\u6BD4\u5206\u5E03\u3002",
    "\u5FC5\u9808\u6309\u4EE5\u4E0B\u9806\u5E8F\u8F38\u51FA\uFF0C\u6BCF\u6BB5\u7528\u3010\u3011\u505A\u6A19\u984C\uFF1A",
    "\u3010\u7BA1\u7406\u5C64\u6458\u8981\u3011",
    "\u3010\u5B63\u5EA6\u7E3D\u89BD\u3011",
    "\u3010\u8CC7\u7522\u914D\u7F6E\u5206\u4F48\u3011",
    "\u3010\u5E63\u5225\u66DD\u96AA\u3011",
    "\u3010\u91CD\u9EDE\u6301\u5009\u5206\u6790\u3011",
    "\u3010\u5B63\u5EA6\u5C0D\u6BD4\u6458\u8981\u3011\uFF08\u5FC5\u9808\u540C\u6642\u4EA4\u4EE3\u7E3D\u8CC7\u7522\u8B8A\u5316\u3001\u6DE8\u5165\u91D1\uFF0F\u51FA\u91D1\u3001\u6263\u9664\u8CC7\u91D1\u6D41\u5F8C\u8B8A\u5316\uFF1B\u5982\u8CC7\u6599\u4E0D\u8DB3\u8981\u660E\u78BA\u8B1B\u9650\u5236\uFF09",
    "\u3010\u4E3B\u8981\u98A8\u96AA\u8207\u96C6\u4E2D\u5EA6\u3011",
    "\u3010\u4E0B\u5B63\u89C0\u5BDF\u91CD\u9EDE\u3011",
    "",
    macroSummaryText,
    "",
    "\u898F\u5247\uFF1A",
    "\u6240\u6709\u7D50\u8AD6\u5FC5\u9808\u5F15\u7528 input \u5167\u7684\u8CC7\u6599\uFF1B\u4E0D\u8981\u865B\u69CB\u65B0\u805E\u3001\u4F30\u503C\u6216\u5B8F\u89C0\u8CC7\u6599\u3002",
    "\u6700\u5927\u8CA2\u737B\u8005\uFF0F\u62D6\u7D2F\u8005\u6309\u50F9\u683C\u6548\u61C9\u6392\u5E8F\uFF1B\u8CB7\u8CE3\u6548\u61C9\u4EE3\u8868\u52A0\u6E1B\u5009\u884C\u70BA\uFF0C\u4E0D\u53EF\u8207\u6295\u8CC7\u56DE\u5831\u6DF7\u70BA\u4E00\u8AC7\u3002",
    "\u5982\u679C\u67D0\u8CC7\u7522 costValue \u6216 averageCost \u70BA 0\uFF0C\u4E0D\u53EF\u5224\u65B7\u70BA\u5168\u70BA\u672A\u5BE6\u73FE\u5229\u6F64\uFF1B\u5FC5\u9808\u5BEB\u660E\u6210\u672C\u8CC7\u6599\u70BA 0 \u6216\u7F3A\u5931\uFF0C\u7121\u6CD5\u6E96\u78BA\u5224\u65B7\u5BE6\u969B\u76C8\u8667\uFF0C\u4E26\u628A\u88DC\u56DE\u6210\u672C\u8CC7\u6599\u5217\u70BA\u4E0B\u5B63\u89C0\u5BDF\u91CD\u9EDE\u3002",
    "\u5982\u679C previousValue \u70BA 0 \u6216\u5927\u91CF new \u6301\u5009\uFF0C\u4E0D\u53EF\u76F4\u63A5\u89E3\u8B80\u70BA\u5B63\u5EA6\u50F9\u683C\u8CA2\u737B\uFF1B\u5FC5\u9808\u8AAA\u660E\u53EF\u80FD\u6DF7\u5408\u65B0\u5EFA\u5009\u3001\u8CC7\u6599\u88DC\u9304\u3001snapshot matching \u6216 baseline holdings \u7F3A\u5931\u3002",
    "\u5E63\u5225\u66DD\u96AA\u5FC5\u9808\u5206\u6E05\u5831\u50F9\u8CA8\u5E63\u66DD\u96AA\u8207\u7D93\u6FDF\u98A8\u96AA\u66DD\u96AA\uFF1B\u52A0\u5BC6\u8CA8\u5E63\u4EE5 USD \u5831\u50F9\uFF0C\u4E0D\u7B49\u65BC\u5B8C\u5168\u7F8E\u5143\u8CC7\u7522\u3002",
    "\u5982\u679C dataQualitySummary.status \u662F partial / warning\uFF0C\u7D50\u8AD6\u8981\u4FDD\u5B88\u5316\uFF0C\u4E26\u628A\u8CC7\u6599\u4FEE\u5FA9\u5217\u5165\u4E0B\u5B63\u89C0\u5BDF\u91CD\u9EDE\u3002",
    "\u5982\u679C\u8CC7\u91D1\u6D41\u8986\u84CB\u7387\u5514\u4FC2 100%\uFF0C\u8981\u4FDD\u7559\u9650\u5236\u63D0\u793A\uFF0C\u907F\u514D\u628A\u6240\u6709\u5347\u8DCC\u90FD\u7576\u6210\u6295\u8CC7\u56DE\u5831\u3002",
    "\u3010\u4E0B\u5B63\u89C0\u5BDF\u91CD\u9EDE\u3011\u6BCF\u9EDE\u9808\u5E36\u91CF\u5316\u89F8\u767C\u689D\u4EF6\uFF0C\u4F8B\u5982\u55AE\u4E00\u8CC7\u7522 > 20%\u3001\u52A0\u5BC6\u5408\u8A08 > 30%\u3001\u73FE\u91D1 < 3%\u3001SGOV + \u73FE\u91D1 < 10%\u3001BTC 7 \u65E5\u8DCC\u5E45 > 15%\u3001\u9AD8 beta \u80A1\u7968\u5408\u8A08\u8D85\u904E\u80A1\u7968\u90E8\u4F4D 60%\u3002",
    "\u4E0D\u8981\u91CD\u8986 summary card \u5DF2\u986F\u793A\u7684\u767E\u5206\u6BD4\u5206\u5E03\uFF0C\u53EA\u9700\u505A\u5224\u8B80\u3001\u6B78\u56E0\u548C\u6B78\u6A94\u6458\u8981\u3002",
    "\u77ED\u800C\u6E96\uFF0C\u7E41\u9AD4\u4E2D\u6587\u8F38\u51FA\uFF1B\u8CC7\u6599\u4E0D\u8DB3\u5C31\u76F4\u8AAA\u3002",
    "",
    formatReportAllocationSummaryForPrompt(allocationSummary),
    "",
    formatReportDataQualitySummaryForPrompt(dataQualitySummary, "\u3010\u8CC7\u6599\u54C1\u8CEA\u8207\u9650\u5236\u3011"),
    "",
    "\u4ECA\u5B63 vs \u4E0A\u5B63\u5C0D\u6BD4\u6578\u64DA\uFF1A",
    currentComparisonText,
    "",
    "\u5B63\u5167\u6708\u5EA6\u8DA8\u52E2\u6578\u64DA\uFF1A",
    trendMissingText,
    trendSections || "\u672A\u6709\u8DB3\u5920\u4E09\u500B\u6708\u8DA8\u52E2\u8CC7\u6599\u3002"
  ].join("\n");
}
async function saveScheduledAnalysis(response, title, allocationSummary, reportFactsPayload, sessionDocId, delivery = "scheduled", overwriteSession = false, periodStartDate, periodEndDate) {
  const db = getFirebaseAdminDb();
  const portfolioRef = db.collection(SHARED_PORTFOLIO_COLLECTION).doc(SHARED_PORTFOLIO_DOC_ID);
  const sanitizedReportFactsPayload = reportFactsPayload ? sanitizeForFirestore(reportFactsPayload) : void 0;
  await portfolioRef.collection("analysisCache").doc(response.cacheKey).set(
    {
      cacheKey: response.cacheKey,
      snapshotHash: response.snapshotHash,
      category: response.category,
      provider: response.provider,
      model: response.model,
      analysisQuestion: response.analysisQuestion,
      analysisBackground: response.analysisBackground,
      delivery,
      generatedAt: response.generatedAt,
      assetCount: response.assetCount,
      answer: response.answer,
      isTimeoutFallback: response.isTimeoutFallback === true,
      ...allocationSummary ? { allocationSummary } : {},
      ...sanitizedReportFactsPayload ? { reportFactsPayload: sanitizedReportFactsPayload } : {},
      updatedAt: FieldValue.serverTimestamp()
    },
    { merge: true }
  );
  const sessionPayload = buildAnalysisSessionWritePayload({
    response,
    title,
    allocationSummary,
    reportFactsPayload: sanitizedReportFactsPayload,
    delivery,
    periodStartDate,
    periodEndDate
  });
  if (sessionDocId) {
    const sessionRef = portfolioRef.collection("analysisSessions").doc(sessionDocId);
    if (overwriteSession) {
      await sessionRef.set(sessionPayload);
    } else {
      await sessionRef.create(sessionPayload);
    }
    return;
  }
  await portfolioRef.collection("analysisSessions").add(sessionPayload);
}
async function saveQuarterlyReport(params) {
  const db = getFirebaseAdminDb();
  await db.collection(SHARED_PORTFOLIO_COLLECTION).doc(SHARED_PORTFOLIO_DOC_ID).collection("quarterlyReports").doc(getQuarterlyReportDocId(params.quarter)).set(buildQuarterlyReportWritePayload(params));
}
async function runScheduledCategoryAnalysis(params) {
  const assets = params.assets ?? await readAdminPortfolioAssets();
  if (assets.length === 0) {
    throw new ScheduledAnalysisError(
      params.delivery === "manual" ? "\u76EE\u524D\u6C92\u6709\u53EF\u5206\u6790\u7684\u8CC7\u7522\uFF0C\u5DF2\u8DF3\u904E\u5206\u6790\u3002" : "\u76EE\u524D\u6C92\u6709\u53EF\u5206\u6790\u7684\u8CC7\u7522\uFF0C\u5DF2\u8DF3\u904E\u81EA\u52D5\u5206\u6790\u3002",
      400
    );
  }
  const promptSettings = await readAnalysisPromptSettings();
  const request = buildAnalysisRequestFromAssets({
    assets,
    category: params.category,
    analysisQuestion: params.question,
    analysisBackground: promptSettings[params.category],
    analysisModel: getScheduledAnalysisModel(),
    conversationContext: params.conversationContext,
    snapshotHashOverride: params.snapshotHashOverride
  });
  let response;
  try {
    response = await runPortfolioAnalysisRequest(request, {
      delivery: params.delivery ?? "scheduled",
      maxTokens: params.maxTokens,
      modelTimeoutMs: SCHEDULED_MODEL_TIMEOUT_MS
    });
  } catch (error) {
    if (!isAbortTimeoutError(error)) {
      throw error;
    }
    response = buildScheduledAnalysisTimeoutFallback(request, {
      title: params.title,
      model: request.analysisModel,
      category: params.category,
      delivery: params.delivery ?? "scheduled",
      error
    });
  }
  const payload = {
    ...response,
    assetCount: request.assetCount
  };
  return {
    response: payload,
    request
  };
}
async function runMonthlyAssetAnalysis(options = {}) {
  const liveAssets = await readAdminPortfolioAssets();
  const currentSnapshot = await readCurrentMonthStartSnapshot();
  if (!currentSnapshot) {
    throw new ScheduledAnalysisError("\u672A\u627E\u5230\u672C\u6708\u6708\u521D\u5FEB\u7167\uFF0C\u7121\u6CD5\u751F\u6210\u6BCF\u6708\u8CC7\u7522\u5206\u6790\u3002", 400);
  }
  const assets = buildAssetsFromSnapshot(currentSnapshot, liveAssets);
  const currentSnapshotHash = createSnapshotHashFromSnapshot(currentSnapshot);
  const recentSnapshotHistory = await readRecentSnapshotHistory(120);
  const previousMonthSnapshot = await readPreviousMonthSnapshot();
  const coveredMonthKey = getCoveredMonthKey();
  const title = `${getCoveredMonthLabel()}\u6BCF\u6708\u8CC7\u7522\u5206\u6790`;
  const monthlySessionTarget = await resolveMonthlyAnalysisSessionTarget({
    coveredMonthKey,
    periodStartDate: previousMonthSnapshot?.date ?? getPreviousMonthStartDate(),
    periodEndDate: currentSnapshot.date
  });
  const existingMonthlyAnalysis = await hasExistingMonthlyAnalysis({
    title,
    sessionDocId: monthlySessionTarget.docId,
    periodStartDate: previousMonthSnapshot?.date ?? getPreviousMonthStartDate(),
    periodEndDate: currentSnapshot.date
  });
  if (!options.overwriteExisting && existingMonthlyAnalysis) {
    return {
      ok: true,
      skipped: true,
      category: "asset_analysis",
      title,
      route: MONTHLY_ROUTE,
      message: "\u8986\u84CB\u6708\u4EFD\u5605\u6BCF\u6708\u8CC7\u7522\u5206\u6790\u5DF2\u7D93\u751F\u6210\uFF0C\u6BCB\u9808\u91CD\u8907\u5EFA\u7ACB\u3002"
    };
  }
  const dataQualitySummary = buildSnapshotDataQualitySummary({
    snapshotMeta: currentSnapshot
  });
  const allocationSummary = buildReportAllocationSummaryFromHoldings({
    holdings: currentSnapshot.holdings,
    asOfDate: currentSnapshot.date,
    basis: "monthly",
    comparisonHoldings: previousMonthSnapshot?.holdings,
    comparisonLabel: previousMonthSnapshot ? `\u8F03 ${previousMonthSnapshot.date} \u57FA\u6E96` : void 0
  });
  const searchSummary = await generateGroundedSearchSummary({
    assets,
    mode: "monthly"
  });
  const comparison = previousMonthSnapshot ? compareSnapshots(currentSnapshot, previousMonthSnapshot, {
    periodSnapshots: recentSnapshotHistory
  }) : null;
  const question = buildMonthlyAnalysisQuestion({
    comparison,
    allocationSummary,
    dataQualitySummary,
    searchSummary: searchSummary.summary
  });
  const { response, request } = await runScheduledCategoryAnalysis({
    category: "asset_analysis",
    title,
    question,
    conversationContext: "",
    maxTokens: 3500,
    assets,
    snapshotHashOverride: currentSnapshotHash,
    delivery: options.delivery ?? "scheduled"
  });
  const reportFactsPayload = buildReportFactsPayload({
    reportType: "monthly",
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
    snapshotHash: currentSnapshotHash,
    dataQualitySummary,
    topHoldingsByHKD: [...request.holdings].sort((left, right) => right.marketValueHKD - left.marketValueHKD),
    comparison,
    fxSource: currentSnapshot.fxSource,
    fxRatesUsed: currentSnapshot.fxRatesUsed
  });
  try {
    await saveScheduledAnalysis(
      response,
      title,
      allocationSummary,
      reportFactsPayload,
      monthlySessionTarget.docId,
      options.delivery ?? "scheduled",
      options.overwriteExisting === true,
      previousMonthSnapshot?.date ?? getPreviousMonthStartDate(),
      currentSnapshot.date
    );
  } catch (error) {
    if (!options.overwriteExisting && isFirestoreAlreadyExistsError(error)) {
      return {
        ok: true,
        skipped: true,
        category: "asset_analysis",
        title,
        route: MONTHLY_ROUTE,
        message: "\u8986\u84CB\u6708\u4EFD\u5605\u6BCF\u6708\u8CC7\u7522\u5206\u6790\u5DF2\u7D93\u751F\u6210\uFF0C\u6BCB\u9808\u91CD\u8907\u5EFA\u7ACB\u3002"
      };
    }
    throw error;
  }
  return {
    ok: true,
    category: "asset_analysis",
    title,
    model: response.model,
    provider: response.provider,
    searchModel: searchSummary.model,
    searchProvider: searchSummary.provider,
    generatedAt: response.generatedAt,
    snapshotHash: response.snapshotHash,
    cacheKey: response.cacheKey,
    replacedExisting: existingMonthlyAnalysis && options.overwriteExisting === true,
    legacyCollision: monthlySessionTarget.collisionWithLegacy,
    message: monthlySessionTarget.collisionWithLegacy ? "\u5DF2\u751F\u6210\u6BCF\u6708\u8CC7\u7522\u5206\u6790\uFF1B\u5075\u6E2C\u5230\u820A\u5236\u540C\u540D\u6587\u4EF6\uFF0C\u4ECA\u6B21\u5DF2\u5BEB\u5165 v2 \u6587\u4EF6\uFF0C\u820A\u5236\u6587\u4EF6\u9700\u4EBA\u624B\u8655\u7406\u3002" : void 0
  };
}
async function runManualMonthlyAssetAnalysis() {
  if (!canGenerateMonthlyAnalysisNow()) {
    throw new ScheduledAnalysisError(
      `\u6BCF\u6708\u8CC7\u7522\u5206\u6790\u6703\u55BA\u6BCF\u6708 1 \u865F\u9999\u6E2F\u6642\u9593 ${String(MONTHLY_MANUAL_RELEASE_HOUR_HKT).padStart(2, "0")}:00 \u4E4B\u5F8C\u5148\u53EF\u624B\u52D5\u751F\u6210\u3002`,
      400
    );
  }
  const result = await runMonthlyAssetAnalysis({ overwriteExisting: true, delivery: "manual" });
  return {
    ...result,
    route: MONTHLY_ROUTE,
    message: typeof result.message === "string" ? result.message : result.replacedExisting ? "\u5DF2\u91CD\u65B0\u751F\u6210\u4E26\u8986\u84CB\u672C\u6708\u6BCF\u6708\u8CC7\u7522\u5206\u6790\u3002" : "\u5DF2\u5B8C\u6210\u6BCF\u6708\u8CC7\u7522\u5206\u6790\u3002"
  };
}
async function runQuarterlyAssetReport() {
  const liveAssets = await readAdminPortfolioAssets();
  const quarterEndDate = getPreviousQuarterEndDate();
  const quarterStartBaselineDate = getQuarterEndDateBefore(quarterEndDate);
  const currentSnapshot = await readSnapshotOnOrBefore(quarterEndDate);
  if (!currentSnapshot) {
    throw new ScheduledAnalysisError(`\u672A\u627E\u5230 ${quarterEndDate} \u6216\u4E4B\u524D\u7684\u5B63\u672B\u5FEB\u7167\uFF0C\u7121\u6CD5\u751F\u6210\u5B63\u5EA6\u5831\u544A\u3002`, 400);
  }
  const previousQuarterSnapshot = await readSnapshotOnOrBefore(quarterStartBaselineDate);
  const assets = buildAssetsFromSnapshot(currentSnapshot, liveAssets);
  const currentSnapshotHash = createSnapshotHashFromSnapshot(currentSnapshot);
  const recentSnapshotHistory = await readRecentSnapshotHistory(120);
  const dataQualitySummary = buildSnapshotDataQualitySummary({
    snapshotMeta: currentSnapshot
  });
  const allocationSummary = buildReportAllocationSummaryFromHoldings({
    holdings: currentSnapshot.holdings,
    asOfDate: currentSnapshot.date,
    basis: "quarterly",
    comparisonHoldings: previousQuarterSnapshot?.holdings,
    comparisonLabel: previousQuarterSnapshot ? `\u8F03 ${previousQuarterSnapshot.date} \u57FA\u6E96` : void 0
  });
  const quarterTrend = selectQuarterMonthEndSnapshots(
    [currentSnapshot, ...recentSnapshotHistory],
    quarterEndDate,
    previousQuarterSnapshot?.date ?? quarterStartBaselineDate
  );
  const trendComparisons = quarterTrend.points.slice(1).flatMap((point, index) => {
    const previousPoint = quarterTrend.points[index];
    if (!point.snapshot || !previousPoint?.snapshot) {
      return [];
    }
    return [
      compareSnapshots(point.snapshot, previousPoint.snapshot, {
        periodSnapshots: recentSnapshotHistory
      })
    ];
  });
  const searchSummary = await generateGroundedSearchSummary({
    assets,
    mode: "quarterly"
  });
  const quarter = getPreviousCompletedQuarterLabel();
  const title = `${quarter}\u8CC7\u7522\u5831\u544A`;
  const currentComparison = previousQuarterSnapshot ? compareSnapshots(currentSnapshot, previousQuarterSnapshot, {
    periodSnapshots: recentSnapshotHistory
  }) : null;
  const currentComparisonText = currentComparison ? buildComparisonPromptSections(currentComparison, { limitHoldings: 12 }) : "\u672A\u6709\u53EF\u6BD4\u8F03\u7684\u4E0A\u5B63\u5B63\u672B\u5FEB\u7167\u3002";
  const question = buildQuarterlyAnalysisQuestion({
    currentComparison,
    trendComparisons,
    allocationSummary,
    dataQualitySummary,
    searchSummary: searchSummary.summary,
    trendMissingLabels: quarterTrend.missingLabels
  });
  const { response, request } = await runScheduledCategoryAnalysis({
    category: "asset_report",
    title,
    question,
    conversationContext: "",
    maxTokens: 5e3,
    assets,
    snapshotHashOverride: currentSnapshotHash,
    delivery: "manual"
  });
  const reportFactsPayload = buildReportFactsPayload({
    reportType: "quarterly",
    generatedAt: response.generatedAt,
    periodStartDate: previousQuarterSnapshot?.date ?? quarterStartBaselineDate,
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
    fxSource: currentSnapshot.fxSource,
    fxRatesUsed: currentSnapshot.fxRatesUsed
  });
  await saveScheduledAnalysis(
    response,
    title,
    allocationSummary,
    reportFactsPayload,
    void 0,
    "manual",
    true,
    previousQuarterSnapshot?.date ?? quarterStartBaselineDate,
    currentSnapshot.date
  );
  await saveQuarterlyReport({
    quarter,
    generatedAt: response.generatedAt,
    report: response.answer,
    currentSnapshotHash,
    previousSnapshotDate: previousQuarterSnapshot?.date,
    searchSummary: searchSummary.summary,
    model: response.model,
    provider: response.provider,
    isTimeoutFallback: response.isTimeoutFallback === true,
    allocationSummary,
    reportFactsPayload
  });
  return {
    ok: true,
    category: "asset_report",
    title,
    model: response.model,
    provider: response.provider,
    searchModel: searchSummary.model,
    searchProvider: searchSummary.provider,
    generatedAt: response.generatedAt,
    snapshotHash: currentSnapshotHash || response.snapshotHash,
    cacheKey: response.cacheKey,
    previousQuarterSnapshotDate: previousQuarterSnapshot?.date ?? ""
  };
}
async function runManualQuarterlyAssetReport(options = {}) {
  const quarter = getPreviousCompletedQuarterLabel();
  if (!canGenerateQuarterlyReportNow()) {
    throw new ScheduledAnalysisError(
      `\u5B63\u5EA6\u5831\u544A\u53EA\u6703\u55BA\u6BCF\u5B63\u5B8C\u7D50\u5F8C\u4E0B\u4E00\u5B63\u9996\u6708\uFF081\u30014\u30017\u300110 \u6708\uFF09\u9999\u6E2F\u6642\u9593 ${String(QUARTERLY_MANUAL_RELEASE_HOUR_HKT).padStart(2, "0")}:00 \u4E4B\u5F8C\u5148\u53EF\u624B\u52D5\u751F\u6210\u3002`,
      400
    );
  }
  const existingQuarterlyReport = await hasExistingQuarterlyReport(quarter);
  if (!options.overwriteExisting && existingQuarterlyReport.exists) {
    return {
      ok: true,
      skipped: true,
      category: "asset_report",
      title: `${quarter}\u8CC7\u7522\u5831\u544A`,
      route: QUARTERLY_ROUTE,
      message: existingQuarterlyReport.isTimeoutFallback ? "\u672C\u5B63\u73FE\u6709\u5831\u544A\u70BA\u8D85\u6642\u964D\u7D1A\u7248\u672C\uFF0C\u53EF\u7528\u8986\u84CB\u6A21\u5F0F\u91CD\u65B0\u751F\u6210\u3002" : "\u4ECA\u5B63\u5B63\u5EA6\u5831\u544A\u5DF2\u7D93\u751F\u6210\uFF0C\u6BCB\u9808\u91CD\u8907\u5EFA\u7ACB\u3002"
    };
  }
  const result = await runQuarterlyAssetReport();
  return {
    ...result,
    route: QUARTERLY_ROUTE,
    message: options.overwriteExisting ? "\u5DF2\u91CD\u65B0\u751F\u6210\u4E26\u8986\u84CB\u5B63\u5EA6\u5831\u544A\u3002" : "\u5DF2\u5B8C\u6210\u5B63\u5EA6\u5831\u544A\u3002"
  };
}
function getScheduledAnalysisErrorResponse(error, route) {
  if (error instanceof ScheduledAnalysisError) {
    return {
      status: error.status,
      body: {
        ok: false,
        route,
        message: error.message
      }
    };
  }
  const formatted = getAnalyzePortfolioErrorResponse(error);
  return {
    status: formatted.status,
    body: {
      ...formatted.body,
      route
    }
  };
}
export {
  SCHEDULED_ANALYSIS_LOGIC_VERSION,
  buildAnalysisRequestFromAssets,
  buildAnalysisSessionWritePayload,
  buildGroundingUnavailableSummary,
  buildMonthlyAnalysisQuestion,
  buildQuarterlyReportWritePayload,
  buildReportDataQualitySummary,
  buildReportFactsPayload,
  buildScheduledAnalysisTimeoutFallback,
  getCoveredMonthKey,
  getCoveredMonthLabel,
  getCoveredMonthlyAnalysisSessionDocId,
  getCurrentMonthStartDate,
  getDefaultServerPromptSettings,
  getMonthlyAnalysisSessionDocId,
  getPreviousMonthStartDate,
  getQuarterEndDateBefore,
  getScheduledAnalysisErrorResponse,
  getSearchSummaryPrompt,
  normalizeSnapshotDocument,
  runManualMonthlyAssetAnalysis,
  runManualQuarterlyAssetReport,
  runMonthlyAssetAnalysis,
  runQuarterlyAssetReport,
  sanitizeForFirestore,
  selectNearestSnapshotToDate
};
