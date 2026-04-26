import { useEffect, useMemo, useState } from 'react';

import { jsPDF } from 'jspdf';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';

import { EmptyState } from '../components/ui/EmptyState';
import { getHoldingValueInCurrency, mockPortfolio } from '../data/mockPortfolio';
import { useAnalysisCache } from '../hooks/useAnalysisCache';
import { useAnalysisSessions } from '../hooks/useAnalysisSessions';
import { useAnalysisThreadTurns, useAnalysisThreads } from '../hooks/useAnalysisThreads';
import { useAnalysisSettings } from '../hooks/useAnalysisSettings';
import { useDisplayCurrency } from '../hooks/useDisplayCurrency';
import { usePortfolioAssets } from '../hooks/usePortfolioAssets';
import { useTopBar, type TopBarConfig } from '../layout/TopBarContext';
import { storage } from '../lib/firebase/client';
import {
  appendAnalysisThreadTurn,
  createAnalysisThreadWithTurn,
  type AnalysisThread,
  type AnalysisThreadTurn,
} from '../lib/firebase/analysisThreads';
import { recalculateHoldingAllocations } from '../lib/firebase/assets';
import { ReportAllocationSummaryCard } from '../components/portfolio/ReportAllocationSummaryCard';
import {
  getQuarterlyReportsErrorMessage,
  subscribeToQuarterlyReports,
  updateQuarterlyReportPdfUrl,
  type QuarterlyReport,
} from '../lib/firebase/quarterlyReports';
import { callPortfolioFunction } from '../lib/api/vercelFunctions';
import {
  buildPortfolioAnalysisRequest,
  createPortfolioAnalysisCacheKey,
  createPortfolioSnapshotHash,
  createPortfolioSnapshotSignature,
} from '../lib/portfolio/analysisSnapshot';
import { StatusMessages } from '../components/ui/StatusMessages';
import type { AnalysisCategory, AnalysisSession, Holding } from '../types/portfolio';
import type {
  CachedPortfolioAnalysis,
  PortfolioAnalysisModel,
  PortfolioAnalysisResponse,
} from '../types/portfolioAnalysis';

type SnapshotHashStatus = 'idle' | 'loading' | 'ready' | 'error';
type ConversationTurn = {
  question: string;
  answer: string;
  generatedAt: string;
  model: string;
};

type ConversationArchiveItem = {
  id: string;
  title: string;
  updatedAt: string;
  turnCount: number;
  source: 'thread' | 'legacy';
};

const LEGACY_THREAD_PREFIX = 'legacy:';

function makeLegacyConversationId(sessionId: string) {
  return `${LEGACY_THREAD_PREFIX}${sessionId}`;
}

function isLegacyConversationId(value: string) {
  return value.startsWith(LEGACY_THREAD_PREFIX);
}

function getLegacyConversationSessionId(value: string) {
  return value.slice(LEGACY_THREAD_PREFIX.length);
}

const REPORT_SECTION_TITLES = [
  '【本月一句總結】',
  '【本月資產變化摘要】',
  '【組合健康檢查】',
  '【三個重點觀察】',
  '【下月行動建議】',
  '【管理層摘要】',
  '【季度總覽】',
  '【資產配置分佈】',
  '【幣別曝險】',
  '【重點持倉分析】',
  '【季度對比摘要】',
  '【主要風險與集中度】',
  '【下季觀察重點】',
] as const;

const REPORT_SECTION_TITLE_SET = new Set<string>(REPORT_SECTION_TITLES);
const NOTO_FONT_CANDIDATE_URLS = [
  'https://cdn.jsdelivr.net/npm/noto-cjk-base64@latest/dist/NotoSansCJKtc-Regular-normal.js',
  'https://cdn.jsdelivr.net/npm/noto-cjk-base64@latest/dist/NotoSansTC-Regular-normal.js',
] as const;

const analysisCategoryOptions: Array<{
  value: AnalysisCategory;
  label: string;
  shortLabel: string;
  helper: string;
  questionPlaceholder: string;
}> = [
  {
    value: 'general_question',
    label: '一般問題',
    shortLabel: '對話',
    helper: '即時對話',
    questionPlaceholder: '輸入問題後送出',
  },
  {
    value: 'asset_analysis',
    label: '每月資產分析',
    shortLabel: '月報',
    helper: '按月手動生成',
    questionPlaceholder: '例如：根據目前資產配置，請分析當前最值得留意的重點。',
  },
  {
    value: 'asset_report',
    label: '季度投資報告',
    shortLabel: '季報',
    helper: '按季手動生成',
    questionPlaceholder: '',
  },
];

const analysisModelOptions: Array<{
  value: PortfolioAnalysisModel;
  label: string;
  hint: string;
}> = [
  {
    value: 'gemini-3.1-pro-preview',
    label: 'Google Gemini',
    hint: '3.1 Pro Preview',
  },
  {
    value: 'claude-opus-4-7',
    label: 'Claude Opus',
    hint: '4.7',
  },
];

interface ReportSection {
  title?: string;
  body: string;
}

function formatAnalysisTime(value: string) {
  if (!value) {
    return '尚未分析';
  }

  try {
    return new Intl.DateTimeFormat('zh-HK', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function formatGeneratedAt(value: string) {
  if (!value) {
    return '尚未生成';
  }

  try {
    return new Intl.DateTimeFormat('zh-HK', {
      timeZone: 'Asia/Hong_Kong',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(new Date(value));
  } catch {
    return value;
  }
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
  const { month } = getHongKongDateParts(date);
  return Math.floor((month - 1) / 3) + 1;
}

function getHongKongQuarterLabel(date = new Date()) {
  return `${new Intl.DateTimeFormat('zh-HK', {
    timeZone: 'Asia/Hong_Kong',
    year: 'numeric',
  }).format(date)}年Q${getCurrentQuarterNumber(date)}`;
}

function canGenerateMonthlyAnalysisNow(date = new Date()) {
  const { day, hour } = getHongKongDateParts(date);
  return day > 1 || (day === 1 && hour >= 8);
}

function canGenerateQuarterlyReportNow(date = new Date()) {
  const { month, day, hour } = getHongKongDateParts(date);
  const quarterStartMonth = Math.floor((month - 1) / 3) * 3 + 1;
  const isQuarterOpeningMonth = month === quarterStartMonth;
  return !isQuarterOpeningMonth || day > 1 || (day === 1 && hour >= 9);
}

function isMonthlyAnalysisRecord(title: string) {
  const normalized = title.trim();

  if (!normalized) {
    return false;
  }

  return /^\d{4}年.+(每月)?資產分析$/.test(normalized);
}

function createAnalysisTitle(question: string) {
  const trimmed = question.trim();

  if (!trimmed) {
    return '投資組合分析';
  }

  return trimmed.length > 26 ? `${trimmed.slice(0, 26)}...` : trimmed;
}

function truncateText(value: string, maxLength: number) {
  const trimmed = value.trim();

  if (trimmed.length <= maxLength) {
    return trimmed;
  }

  return `${trimmed.slice(0, maxLength).trimEnd()}...`;
}

function getAnalysisModelLabel(model: string) {
  return model || '未指定模型';
}

function buildConversationTurnFromSession(session: AnalysisSession): ConversationTurn {
  return {
    question: session.question,
    answer: session.result,
    generatedAt: session.updatedAt,
    model: session.model,
  };
}

function formatConversationContext(turns: ConversationTurn[]) {
  return turns
    .map(
      (turn, index) => `第 ${index + 1} 輪\n使用者：${turn.question}\nAI：${turn.answer}`,
    )
    .join('\n\n');
}

function buildQuarterlyReportContext(report: QuarterlyReport) {
  return [
    `季度報告：${report.quarter}`,
    `生成時間：${report.generatedAt}`,
    `snapshotHash：${report.currentSnapshotHash ?? '未提供'}`,
    '',
    report.report,
  ].join('\n');
}

function extractBase64FontPayload(rawText: string) {
  const trimmed = rawText.trim();

  if (!trimmed) {
    return '';
  }

  if (trimmed.startsWith('data:font/')) {
    return trimmed.split(',')[1] ?? '';
  }

  const directBase64Match = trimmed.match(/['"`]([A-Za-z0-9+/=]{2000,})['"`]/);

  if (directBase64Match?.[1]) {
    return directBase64Match[1];
  }

  const dataUrlMatch = trimmed.match(/data:font\/[^;]+;base64,([A-Za-z0-9+/=]+)/);

  if (dataUrlMatch?.[1]) {
    return dataUrlMatch[1];
  }

  return '';
}

async function tryLoadPdfFont(pdf: jsPDF) {
  for (const url of NOTO_FONT_CANDIDATE_URLS) {
    try {
      const response = await fetch(url);

      if (!response.ok) {
        continue;
      }

      const text = await response.text();
      const base64 = extractBase64FontPayload(text);

      if (!base64) {
        continue;
      }

      pdf.addFileToVFS('NotoSansCJKtc-Regular.ttf', base64);
      pdf.addFont('NotoSansCJKtc-Regular.ttf', 'NotoSansCJKtc', 'normal');
      pdf.addFileToVFS('NotoSansCJKtc-Bold.ttf', base64);
      pdf.addFont('NotoSansCJKtc-Bold.ttf', 'NotoSansCJKtc', 'bold');

      return 'NotoSansCJKtc';
    } catch (error) {
      console.warn('[quarterlyReportPdf] font load failed', {
        url,
        reason: error instanceof Error ? error.message : 'unknown_error',
      });
    }
  }

  return null;
}

function splitReportIntoSections(report: string): ReportSection[] {
  const cleaned = report.trim();

  if (!cleaned) {
    return [];
  }

  const parts = cleaned.split(/(【[^】]+】)/g).filter((part) => part.trim());
  const sections: ReportSection[] = [];

  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index].trim();

    if (REPORT_SECTION_TITLE_SET.has(part)) {
      const next = parts[index + 1]?.trim() ?? '';
      sections.push({
        title: part,
        body: next,
      });
      index += 1;
      continue;
    }

    sections.push({ body: part });
  }

  return sections;
}

function splitParagraphs(body: string) {
  const paragraphs = body
    .split(/\n+/)
    .map((entry) => entry.trim())
    .filter(Boolean);

  return paragraphs.length > 0 ? paragraphs : [''];
}

function addTextPdfFooter(pdf: jsPDF, fontFamily: string) {
  const totalPages = pdf.getNumberOfPages();

  for (let index = 1; index <= totalPages; index += 1) {
    pdf.setPage(index);
    pdf.setFont(fontFamily, 'normal');
    pdf.setFontSize(9);
    pdf.setTextColor(98, 90, 81);
    pdf.text(`第 ${index} 頁 / 共 ${totalPages} 頁`, 105, 286, { align: 'center' });
    pdf.text('Portfolio V2 · 季度資產報告 · 僅供個人參考', 105, 291, {
      align: 'center',
    });
  }
}

function parseHexColor(hexColor: string) {
  const normalized = hexColor.trim().replace('#', '');

  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) {
    return { r: 75, g: 85, b: 99 };
  }

  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16),
  };
}

function formatPdfPercentage(value: number) {
  return `${Math.round(value)}%`;
}

function formatPdfDelta(value: number) {
  if (Math.abs(value) < 0.05) {
    return '0pp';
  }

  return `${value > 0 ? '+' : ''}${Math.round(value)}pp`;
}

function getPdfComparisonText(report: QuarterlyReport) {
  const summary = report.allocationSummary;

  if (summary?.comparisonLabel && summary.deltas?.length) {
    return `${summary.comparisonLabel}變化`;
  }

  return '未有可比較的上期快照';
}

function renderDirectPdfAllocationSummary(params: {
  report: QuarterlyReport;
  pdf: jsPDF;
  fontFamily: string;
  cursorY: number;
  margin: number;
  contentWidth: number;
  ensureSpace: (requiredHeight: number) => void;
}) {
  const { report, pdf, fontFamily, margin, contentWidth, ensureSpace } = params;
  const summary = report.allocationSummary;
  let cursorY = params.cursorY;

  ensureSpace(40);
  pdf.setFont(fontFamily, 'bold');
  pdf.setFontSize(12);
  pdf.setTextColor(29, 26, 23);
  pdf.text('資產分佈總覽', margin, cursorY);
  cursorY += 7;

  pdf.setFont(fontFamily, 'normal');
  pdf.setFontSize(9);
  pdf.setTextColor(98, 90, 81);

  if (!summary) {
    pdf.text('此報告未保存資產分佈快照', margin, cursorY);
    cursorY += 10;
    return cursorY;
  }

  pdf.text(`截至 ${summary.asOfDate || '未提供日期'} · ${getPdfComparisonText(report)}`, margin, cursorY);
  cursorY += 7;

  pdf.setFillColor(244, 239, 232);
  pdf.roundedRect(margin, cursorY, contentWidth, 7, 3.5, 3.5, 'F');
  let barX = margin;

  summary.slices
    .filter((slice) => slice.percentage > 0)
    .forEach((slice) => {
      const width = Math.max(1.5, (slice.percentage / 100) * contentWidth);
      const color = parseHexColor(slice.color);
      pdf.setFillColor(color.r, color.g, color.b);
      pdf.rect(barX, cursorY, Math.min(width, margin + contentWidth - barX), 7, 'F');
      barX += width;
    });
  cursorY += 13;

  summary.slices.forEach((slice) => {
    ensureSpace(6);
    const color = parseHexColor(slice.color);
    const delta = summary.deltas?.find((item) => item.key === slice.key);
    pdf.setFillColor(color.r, color.g, color.b);
    pdf.rect(margin, cursorY - 3.2, 3, 3, 'F');
    pdf.setTextColor(29, 26, 23);
    pdf.text(
      `${slice.label} ${formatPdfPercentage(slice.percentage)}${delta ? `（${formatPdfDelta(delta.deltaPercentagePoints)}）` : ''}`,
      margin + 5,
      cursorY,
    );
    cursorY += 5.2;
  });

  ensureSpace(18);
  pdf.setFont(fontFamily, 'bold');
  pdf.setFontSize(9);
  pdf.setTextColor(15, 118, 110);
  pdf.text(`配置：${summary.styleTag}`, margin, cursorY);
  cursorY += 5.2;

  pdf.setFont(fontFamily, 'normal');
  pdf.setTextColor(98, 90, 81);
  const tagLines = pdf.splitTextToSize(`提示：${summary.warningTags.join('、') || '無'}`, contentWidth);
  tagLines.forEach((line: string) => {
    ensureSpace(5);
    pdf.text(line, margin, cursorY);
    cursorY += 4.8;
  });

  if (summary.summarySentence) {
    const sentenceLines = pdf.splitTextToSize(summary.summarySentence, contentWidth);
    sentenceLines.forEach((line: string) => {
      ensureSpace(5);
      pdf.text(line, margin, cursorY);
      cursorY += 4.8;
    });
  }

  cursorY += 4;
  return cursorY;
}

function renderDirectTextPdf(report: QuarterlyReport, pdf: jsPDF, fontFamily: string) {
  const pageHeight = 297;
  const margin = 20;
  const contentWidth = 170;
  let cursorY = margin;

  const ensureSpace = (requiredHeight: number) => {
    if (cursorY + requiredHeight > pageHeight - margin - 18) {
      pdf.addPage();
      cursorY = margin;
    }
  };

  pdf.setFont(fontFamily, 'bold');
  pdf.setFontSize(16);
  pdf.setTextColor(29, 26, 23);
  pdf.text(report.quarter, margin, cursorY);
  cursorY += 8;

  pdf.setFont(fontFamily, 'normal');
  pdf.setFontSize(10);
  pdf.setTextColor(98, 90, 81);
  pdf.text(`生成日期：${formatGeneratedAt(report.generatedAt)}`, margin, cursorY);
  cursorY += 6;

  pdf.setDrawColor(210, 198, 184);
  pdf.line(margin, cursorY, margin + contentWidth, cursorY);
  cursorY += 8;

  cursorY = renderDirectPdfAllocationSummary({
    report,
    pdf,
    fontFamily,
    cursorY,
    margin,
    contentWidth,
    ensureSpace,
  });

  const sections = splitReportIntoSections(report.report);

  sections.forEach((section) => {
    if (section.title) {
      ensureSpace(12);
      pdf.setFont(fontFamily, 'bold');
      pdf.setFontSize(12);
      pdf.setTextColor(29, 26, 23);
      pdf.text(section.title, margin, cursorY);
      cursorY += 7;
    }

    pdf.setFont(fontFamily, 'normal');
    pdf.setFontSize(10);
    pdf.setTextColor(29, 26, 23);

    splitParagraphs(section.body).forEach((paragraph) => {
      const lines = pdf.splitTextToSize(paragraph, contentWidth);

      lines.forEach((line: string) => {
        ensureSpace(6);
        pdf.text(line, margin, cursorY);
        cursorY += 5.5;
      });

      cursorY += 2;
    });

    cursorY += 3;
  });

  addTextPdfFooter(pdf, fontFamily);
  return pdf;
}

function createCanvasPage() {
  const canvas = document.createElement('canvas');
  canvas.width = 1240;
  canvas.height = 1754;
  const context = canvas.getContext('2d');

  if (!context) {
    throw new Error('無法建立 PDF 畫布，請稍後再試。');
  }

  context.fillStyle = '#fffaf4';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#1d1a17';
  context.textBaseline = 'top';

  return { canvas, context };
}

function wrapCanvasText(
  context: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
) {
  const lines: string[] = [];

  for (const paragraph of text.split('\n')) {
    if (!paragraph.trim()) {
      lines.push('');
      continue;
    }

    let current = '';

    for (const character of Array.from(paragraph)) {
      const candidate = `${current}${character}`;

      if (current && context.measureText(candidate).width > maxWidth) {
        lines.push(current);
        current = character;
      } else {
        current = candidate;
      }
    }

    if (current) {
      lines.push(current);
    }
  }

  return lines;
}

function renderCanvasAllocationSummary(params: {
  report: QuarterlyReport;
  context: CanvasRenderingContext2D;
  cursorY: number;
  marginPx: number;
  contentWidthPx: number;
}) {
  const { report, context, marginPx, contentWidthPx } = params;
  const summary = report.allocationSummary;
  let cursorY = params.cursorY;

  context.fillStyle = '#1d1a17';
  context.font = '700 30px "Noto Sans TC","PingFang TC","Microsoft JhengHei",sans-serif';
  context.fillText('資產分佈總覽', marginPx, cursorY);
  cursorY += 44;

  context.font = '400 22px "Noto Sans TC","PingFang TC","Microsoft JhengHei",sans-serif';
  context.fillStyle = '#625a51';

  if (!summary) {
    context.fillText('此報告未保存資產分佈快照', marginPx, cursorY);
    return cursorY + 48;
  }

  context.fillText(`截至 ${summary.asOfDate || '未提供日期'} · ${getPdfComparisonText(report)}`, marginPx, cursorY);
  cursorY += 42;

  context.fillStyle = '#f4efe8';
  context.fillRect(marginPx, cursorY, contentWidthPx, 22);
  let barX = marginPx;

  summary.slices
    .filter((slice) => slice.percentage > 0)
    .forEach((slice) => {
      const width = Math.max(8, (slice.percentage / 100) * contentWidthPx);
      context.fillStyle = slice.color;
      context.fillRect(barX, cursorY, Math.min(width, marginPx + contentWidthPx - barX), 22);
      barX += width;
    });
  cursorY += 48;

  context.font = '400 22px "Noto Sans TC","PingFang TC","Microsoft JhengHei",sans-serif';
  summary.slices.forEach((slice) => {
    const delta = summary.deltas?.find((item) => item.key === slice.key);
    context.fillStyle = slice.color;
    context.fillRect(marginPx, cursorY + 5, 14, 14);
    context.fillStyle = '#1d1a17';
    context.fillText(
      `${slice.label} ${formatPdfPercentage(slice.percentage)}${delta ? `（${formatPdfDelta(delta.deltaPercentagePoints)}）` : ''}`,
      marginPx + 24,
      cursorY,
    );
    cursorY += 34;
  });

  context.fillStyle = '#0f766e';
  context.font = '700 22px "Noto Sans TC","PingFang TC","Microsoft JhengHei",sans-serif';
  context.fillText(`配置：${summary.styleTag}`, marginPx, cursorY);
  cursorY += 34;

  context.fillStyle = '#625a51';
  context.font = '400 21px "Noto Sans TC","PingFang TC","Microsoft JhengHei",sans-serif';
  const infoLines = [
    ...wrapCanvasText(context, `提示：${summary.warningTags.join('、') || '無'}`, contentWidthPx),
    ...(summary.summarySentence
      ? wrapCanvasText(context, summary.summarySentence, contentWidthPx)
      : []),
  ];

  infoLines.forEach((line) => {
    context.fillText(line, marginPx, cursorY);
    cursorY += 31;
  });

  return cursorY + 18;
}

function renderCanvasFallbackPdf(report: QuarterlyReport) {
  const pdf = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });
  const pages: Array<{ canvas: HTMLCanvasElement; context: CanvasRenderingContext2D }> = [];
  const pageWidthPx = 1240;
  const pageHeightPx = 1754;
  const marginPx = 118;
  const contentWidthPx = pageWidthPx - marginPx * 2;
  const footerTopPx = pageHeightPx - 140;
  let page = createCanvasPage();
  let cursorY = marginPx;

  const ensureSpace = (requiredHeight: number) => {
    if (cursorY + requiredHeight > footerTopPx) {
      pages.push(page);
      page = createCanvasPage();
      cursorY = marginPx;
    }
  };

  page.context.font = '700 42px "Noto Sans TC","PingFang TC","Microsoft JhengHei",sans-serif';
  page.context.fillText(report.quarter, marginPx, cursorY);
  cursorY += 68;

  page.context.font = '400 24px "Noto Sans TC","PingFang TC","Microsoft JhengHei",sans-serif';
  page.context.fillStyle = '#625a51';
  page.context.fillText(`生成日期：${formatGeneratedAt(report.generatedAt)}`, marginPx, cursorY);
  cursorY += 42;

  page.context.strokeStyle = '#d2c6b8';
  page.context.beginPath();
  page.context.moveTo(marginPx, cursorY);
  page.context.lineTo(pageWidthPx - marginPx, cursorY);
  page.context.stroke();
  cursorY += 48;

  cursorY = renderCanvasAllocationSummary({
    report,
    context: page.context,
    cursorY,
    marginPx,
    contentWidthPx,
  });

  const sections = splitReportIntoSections(report.report);

  sections.forEach((section) => {
    if (section.title) {
      ensureSpace(60);
      page.context.fillStyle = '#1d1a17';
      page.context.font = '700 30px "Noto Sans TC","PingFang TC","Microsoft JhengHei",sans-serif';
      page.context.fillText(section.title, marginPx, cursorY);
      cursorY += 52;
    }

    page.context.fillStyle = '#1d1a17';
    page.context.font = '400 24px "Noto Sans TC","PingFang TC","Microsoft JhengHei",sans-serif';

    splitParagraphs(section.body).forEach((paragraph) => {
      const lines = wrapCanvasText(page.context, paragraph, contentWidthPx);

      lines.forEach((line) => {
        ensureSpace(40);
        page.context.fillText(line, marginPx, cursorY);
        cursorY += 36;
      });

      cursorY += 14;
    });

    cursorY += 18;
  });

  pages.push(page);

  const totalPages = pages.length;

  pages.forEach((entry, index) => {
    entry.context.fillStyle = '#625a51';
    entry.context.font = '400 20px "Noto Sans TC","PingFang TC","Microsoft JhengHei",sans-serif';
    entry.context.textAlign = 'center';
    entry.context.fillText(`第 ${index + 1} 頁 / 共 ${totalPages} 頁`, pageWidthPx / 2, pageHeightPx - 74);
    entry.context.fillText('Portfolio V2 · 季度資產報告 · 僅供個人參考', pageWidthPx / 2, pageHeightPx - 42);
    entry.context.textAlign = 'left';

    if (index > 0) {
      pdf.addPage();
    }

    pdf.addImage(entry.canvas.toDataURL('image/png'), 'PNG', 0, 0, 210, 297);
  });

  return pdf;
}

async function createQuarterlyReportPdf(report: QuarterlyReport) {
  const textPdf = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });
  const loadedFont = await tryLoadPdfFont(textPdf);

  if (loadedFont) {
    return renderDirectTextPdf(report, textPdf, loadedFont);
  }

  console.warn(
    '[quarterlyReportPdf] Unable to load Noto Sans CJK font, falling back to canvas rendering.',
  );
  return renderCanvasFallbackPdf(report);
}

function sanitizeQuarterStorageKey(quarter: string) {
  return quarter.trim().replace(/\s+/g, '').replace(/[/:?#[\]@!$&'()*+,;=%]/g, '-');
}

export function AnalysisPage() {
  const {
    holdings: firestoreHoldings,
    status: assetsStatus,
    error: assetsError,
    isEmpty,
  } = usePortfolioAssets();
  const {
    settings: savedPromptSettings,
    error: analysisSettingsError,
    persistSettings,
  } = useAnalysisSettings();
  const [snapshotHash, setSnapshotHash] = useState<string | null>(null);
  const [snapshotHashStatus, setSnapshotHashStatus] = useState<SnapshotHashStatus>('idle');
  const [analysisCacheKey, setAnalysisCacheKey] = useState<string | null>(null);
  const [analysisCacheKeyStatus, setAnalysisCacheKeyStatus] = useState<SnapshotHashStatus>('idle');
  const [snapshotHashError, setSnapshotHashError] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<AnalysisCategory>('general_question');
  const [selectedModel, setSelectedModel] = useState<PortfolioAnalysisModel>('gemini-3.1-pro-preview');
  const [localAnalysis, setLocalAnalysis] = useState<CachedPortfolioAnalysis | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [analysisSuccess, setAnalysisSuccess] = useState<string | null>(null);
  const [promptSettingsSuccess, setPromptSettingsSuccess] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isSavingPromptSettings, setIsSavingPromptSettings] = useState(false);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [selectedMonthlyAnalysisId, setSelectedMonthlyAnalysisId] = useState<string | null>(null);
  const [expandedMonthlyAnalysisId, setExpandedMonthlyAnalysisId] = useState<string | null>(null);
  const [isPromptSettingsOpen, setIsPromptSettingsOpen] = useState(false);
  const [visibleCount, setVisibleCount] = useState(10);
  const [generalQuestionSeedContext, setGeneralQuestionSeedContext] = useState<string>('');
  const [analysisQuestionByCategory, setAnalysisQuestionByCategory] = useState<Record<AnalysisCategory, string>>({
    asset_analysis: '',
    general_question: '',
    asset_report: '',
  });
  const [followUpQuestionByCategory, setFollowUpQuestionByCategory] = useState<Record<AnalysisCategory, string>>({
    asset_analysis: '',
    general_question: '',
    asset_report: '',
  });
  const [promptDrafts, setPromptDrafts] = useState(savedPromptSettings);
  const [reports, setReports] = useState<QuarterlyReport[]>([]);
  const [reportsStatus, setReportsStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [reportsError, setReportsError] = useState<string | null>(null);
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const [generatingReportId, setGeneratingReportId] = useState<string | null>(null);
  const [generatingPeriodicReport, setGeneratingPeriodicReport] = useState<'monthly' | 'quarterly' | null>(null);
  const [reportActionMessage, setReportActionMessage] = useState<string | null>(null);
  const [reportActionError, setReportActionError] = useState<string | null>(null);
  const [currentTimeMs, setCurrentTimeMs] = useState(() => Date.now());
  const [displayCurrency] = useDisplayCurrency();

  const holdings: Holding[] = recalculateHoldingAllocations(
    firestoreHoldings,
    (holding) => getHoldingValueInCurrency(holding, mockPortfolio.baseCurrency),
  );
  const snapshotSignature = holdings.length > 0 ? createPortfolioSnapshotSignature(holdings) : '';
  const analysisQuestion = analysisQuestionByCategory[selectedCategory];
  const followUpQuestion = followUpQuestionByCategory[selectedCategory];
  const analysisBackground = savedPromptSettings[selectedCategory];
  const currentTime = useMemo(() => new Date(currentTimeMs), [currentTimeMs]);
  const isInteractiveCategory = selectedCategory === 'general_question';
  const isPortfolioAnalysisCategory = selectedCategory === 'asset_analysis';
  const isQuarterlyCategory = selectedCategory === 'asset_report';
  const selectedCategoryOption = useMemo(
    () =>
      analysisCategoryOptions.find((option) => option.value === selectedCategory) ??
      analysisCategoryOptions[0],
    [selectedCategory],
  );
  const currentMonthLabel = useMemo(
    () => `${getHongKongYearMonthLabel(currentTime)}每月資產分析`,
    [currentTime],
  );
  const currentQuarterLabel = useMemo(() => getHongKongQuarterLabel(currentTime), [currentTime]);
  useEffect(() => {
    setLocalAnalysis(null);
    setAnalysisError(null);
    setAnalysisSuccess(null);
  }, [snapshotSignature, selectedModel, selectedCategory, analysisQuestion, analysisBackground]);

  useEffect(() => {
    setPromptDrafts(savedPromptSettings);
  }, [savedPromptSettings]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setCurrentTimeMs(Date.now());
    }, 60 * 1000);

    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    setSelectedSessionId(null);
    setVisibleCount(10);
  }, [selectedCategory]);

  useEffect(() => {
    setReportsStatus('loading');
    setReportsError(null);

    const unsubscribe = subscribeToQuarterlyReports(
      (entries) => {
        setReports(entries);
        setReportsStatus('ready');
        setReportsError(null);
      },
      (nextError) => {
        setReportsStatus('error');
        setReportsError(getQuarterlyReportsErrorMessage(nextError));
      },
    );

    return unsubscribe;
  }, []);

  useEffect(() => {
    if (reports.length === 0) {
      setSelectedReportId(null);
      return;
    }

    setSelectedReportId((current) =>
      current && reports.some((report) => report.id === current) ? current : reports[0].id,
    );
  }, [reports]);

  useEffect(() => {
    if (selectedCategory !== 'general_question') {
      setGeneralQuestionSeedContext('');
    }
  }, [selectedCategory]);

  useEffect(() => {
    if (!snapshotSignature) {
      setSnapshotHash(null);
      setSnapshotHashStatus(holdings.length === 0 ? 'idle' : 'loading');
      setSnapshotHashError(null);
      return;
    }

    let isActive = true;
    setSnapshotHashStatus('loading');
    setSnapshotHashError(null);

    createPortfolioSnapshotHash(snapshotSignature)
      .then((hash) => {
        if (!isActive) {
          return;
        }

        setSnapshotHash(hash);
        setSnapshotHashStatus('ready');
      })
      .catch((error) => {
        if (!isActive) {
          return;
        }

        setSnapshotHash(null);
        setSnapshotHashStatus('error');
        setSnapshotHashError(
          error instanceof Error ? error.message : '建立投資組合快照失敗，請稍後再試。',
        );
      });

    return () => {
      isActive = false;
    };
  }, [snapshotSignature, holdings.length]);

  useEffect(() => {
    if (!snapshotHash) {
      setAnalysisCacheKey(null);
      setAnalysisCacheKeyStatus('idle');
      return;
    }

    let isActive = true;
    setAnalysisCacheKeyStatus('loading');

    createPortfolioAnalysisCacheKey(
      snapshotHash,
      selectedCategory,
      selectedModel,
      analysisQuestion,
      analysisBackground,
    )
      .then((cacheKey) => {
        if (!isActive) {
          return;
        }

        setAnalysisCacheKey(cacheKey);
        setAnalysisCacheKeyStatus('ready');
      })
      .catch(() => {
        if (!isActive) {
          return;
        }

        setAnalysisCacheKey(null);
        setAnalysisCacheKeyStatus('error');
      });

    return () => {
      isActive = false;
    };
  }, [snapshotHash, selectedCategory, selectedModel, analysisQuestion, analysisBackground]);

  const {
    analysis: cachedAnalysis,
    error: cacheError,
    hasCachedAnalysis,
    persistAnalysis,
  } = useAnalysisCache(analysisCacheKey);
  const {
    entries: analysisSessions,
    error: analysisSessionsError,
    addAnalysisSession,
  } = useAnalysisSessions();
  const {
    entries: analysisThreads,
    error: analysisThreadsError,
  } = useAnalysisThreads();
  const monthlyAnalysisSessions = useMemo(
    () =>
      analysisSessions
        .filter(
          (session) =>
            session.category === 'asset_analysis' && isMonthlyAnalysisRecord(session.title ?? ''),
        )
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    [analysisSessions],
  );
  const currentMonthAnalysis = useMemo(
    () => monthlyAnalysisSessions.find((session) => session.title === currentMonthLabel) ?? null,
    [currentMonthLabel, monthlyAnalysisSessions],
  );
  const canGenerateCurrentMonthAnalysis = useMemo(
    () => canGenerateMonthlyAnalysisNow(currentTime) && currentMonthAnalysis == null,
    [currentMonthAnalysis, currentTime],
  );
  const selectedMonthlyAnalysis =
    monthlyAnalysisSessions.find((session) => session.id === selectedMonthlyAnalysisId) ??
    monthlyAnalysisSessions[0] ??
    null;
  useEffect(() => {
    if (monthlyAnalysisSessions.length === 0) {
      setSelectedMonthlyAnalysisId(null);
      setExpandedMonthlyAnalysisId(null);
      return;
    }

    setSelectedMonthlyAnalysisId((current) =>
      current && monthlyAnalysisSessions.some((session) => session.id === current)
        ? current
        : monthlyAnalysisSessions[0].id,
    );
    setExpandedMonthlyAnalysisId((current) =>
      current && monthlyAnalysisSessions.some((session) => session.id === current)
        ? current
        : monthlyAnalysisSessions[0].id,
    );
  }, [monthlyAnalysisSessions]);
  const conversationArchiveSessions: ConversationArchiveItem[] =
    selectedCategory === 'general_question'
      ? [
          ...analysisThreads
            .filter((thread) => !thread.sourceReportId)
            .map(
              (thread): ConversationArchiveItem => ({
                id: thread.id,
                title: thread.title,
                updatedAt: thread.updatedAt,
                turnCount: thread.turnCount,
                source: 'thread',
              }),
            ),
          ...analysisSessions
            .filter((session) => session.category === 'general_question')
            .map(
              (session): ConversationArchiveItem => ({
                id: makeLegacyConversationId(session.id),
                title: session.title || createAnalysisTitle(session.question),
                updatedAt: session.updatedAt,
                turnCount: 1,
                source: 'legacy',
              }),
            ),
        ].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      : [];
  const canAnalyze =
    assetsStatus === 'ready' &&
    holdings.length > 0 &&
    snapshotHashStatus === 'ready' &&
    analysisCacheKeyStatus === 'ready' &&
    !isAnalyzing &&
    !isQuarterlyCategory;
  const selectedReport = useMemo(
    () => reports.find((report) => report.id === selectedReportId) ?? null,
    [reports, selectedReportId],
  );
  const latestReport = reports[0] ?? null;
  const currentQuarterReport = useMemo(
    () => reports.find((report) => report.quarter === currentQuarterLabel) ?? null,
    [currentQuarterLabel, reports],
  );
  const canGenerateCurrentQuarterReport = useMemo(
    () => canGenerateQuarterlyReportNow(currentTime) && currentQuarterReport == null,
    [currentQuarterReport, currentTime],
  );
  const selectedQuarterlyReportThread = useMemo(
    () =>
      selectedReport
        ? analysisThreads.find((thread) => thread.sourceReportId === selectedReport.id) ?? null
        : null,
    [analysisThreads, selectedReport],
  );
  const selectedSections = useMemo(
    () => splitReportIntoSections(selectedReport?.report ?? ''),
    [selectedReport],
  );
  const activeAnalysis = localAnalysis ?? cachedAnalysis;
  const enrichmentWarning =
    activeAnalysis?.enrichmentStatus && activeAnalysis.enrichmentStatus !== 'ok'
      ? '部分歷史數據載入失敗，AI 內容可能不完整'
      : null;
  const selectedLegacyConversationSession = useMemo(() => {
    if (!selectedSessionId || !isLegacyConversationId(selectedSessionId)) {
      return null;
    }

    const sessionId = getLegacyConversationSessionId(selectedSessionId);
    return analysisSessions.find((session) => session.id === sessionId && session.category === 'general_question') ?? null;
  }, [analysisSessions, selectedSessionId]);
  const selectedAnalysisThreadId =
    selectedCategory === 'general_question' &&
    selectedSessionId &&
    !isLegacyConversationId(selectedSessionId)
      ? selectedSessionId
      : null;
  const selectedQuarterlyReportThreadId = selectedQuarterlyReportThread?.id ?? null;
  const {
    entries: selectedThreadTurns,
  } = useAnalysisThreadTurns(selectedAnalysisThreadId);
  const {
    entries: selectedQuarterlyThreadTurns,
    status: selectedQuarterlyThreadTurnsStatus,
  } = useAnalysisThreadTurns(selectedQuarterlyReportThreadId);
  const activeConversationTurns = useMemo(() => {
    if (selectedLegacyConversationSession) {
      return [buildConversationTurnFromSession(selectedLegacyConversationSession)];
    }

    return selectedThreadTurns.map((turn) => ({
      question: turn.question,
      answer: turn.answer,
      generatedAt: turn.generatedAt,
      model: turn.model,
    }));
  }, [selectedLegacyConversationSession, selectedThreadTurns]);
  const quarterlyActiveConversationTurns = useMemo(
    () =>
      selectedQuarterlyThreadTurns.map((turn) => ({
        question: turn.question,
        answer: turn.answer,
        generatedAt: turn.generatedAt,
        model: turn.model,
      })),
    [selectedQuarterlyThreadTurns],
  );
  const topBarConfig = useMemo<TopBarConfig>(
    () => ({
      title: '分析與報告',
      subtitle: '向 AI 提問、生成月報或查看季度報告。',
      primaryStatus: {
        label:
          isAnalyzing || generatingPeriodicReport
            ? '生成中'
            : analysisError || reportActionError || snapshotHashStatus === 'error'
              ? '生成失敗'
              : canGenerateCurrentMonthAnalysis || canGenerateCurrentQuarterReport
                ? '可生成'
                : '可提問',
        tone:
          analysisError || reportActionError || snapshotHashStatus === 'error'
            ? 'danger'
            : isAnalyzing || generatingPeriodicReport || canGenerateCurrentMonthAnalysis || canGenerateCurrentQuarterReport
              ? 'warning'
              : 'success',
      },
      actions: (
        <button
          className="button button-secondary"
          type="button"
          onClick={() => setIsPromptSettingsOpen(true)}
        >
          分析設定
        </button>
      ),
    }),
    [
      analysisError,
      canGenerateCurrentMonthAnalysis,
      canGenerateCurrentQuarterReport,
      generatingPeriodicReport,
      isAnalyzing,
      reportActionError,
      snapshotHashStatus,
      setIsPromptSettingsOpen,
    ],
  );
  useTopBar(topBarConfig);

  async function handleAnalyzePortfolio(quickQuestion?: string) {
    if (!snapshotHash || holdings.length === 0 || isQuarterlyCategory) {
      setAnalysisError('目前沒有完整的資產快照可供分析。');
      return;
    }

    const effectiveAnalysisQuestion = (quickQuestion ?? analysisQuestion).trim();
    if (!effectiveAnalysisQuestion) {
      return;
    }

    setAnalysisError(null);
    setAnalysisSuccess(null);
    setPromptSettingsSuccess(null);
    setIsAnalyzing(true);

    try {
      const resolvedCacheKey = await createPortfolioAnalysisCacheKey(
        snapshotHash,
        selectedCategory,
        selectedModel,
        effectiveAnalysisQuestion,
        analysisBackground,
      );
      const conversationContext =
        isInteractiveCategory && activeConversationTurns.length === 0
          ? generalQuestionSeedContext
          : isInteractiveCategory
            ? formatConversationContext(activeConversationTurns)
            : '';
      const request = await buildPortfolioAnalysisRequest(
        holdings,
        snapshotHash,
        resolvedCacheKey,
        selectedCategory,
        selectedModel,
        effectiveAnalysisQuestion,
        analysisBackground,
        conversationContext,
      );
      const response = (await callPortfolioFunction('analyze', request)) as PortfolioAnalysisResponse;

      const cachedResult: CachedPortfolioAnalysis = {
        cacheKey: response.cacheKey,
        snapshotHash: response.snapshotHash,
        category: response.category,
        provider: response.provider,
        model: response.model,
        enrichmentStatus: response.enrichmentStatus,
        analysisQuestion: response.analysisQuestion,
        analysisBackground: response.analysisBackground,
        delivery: response.delivery ?? 'manual',
        generatedAt: response.generatedAt,
        assetCount: holdings.length,
        answer: response.answer,
      };

      setLocalAnalysis(cachedResult);
      setAnalysisQuestionByCategory((current) => ({
        ...current,
        [selectedCategory]: '',
      }));
      setFollowUpQuestionByCategory((current) => ({
        ...current,
        [selectedCategory]: '',
      }));
      await persistAnalysis(cachedResult);
      if (isInteractiveCategory) {
        const usedSeedContext = activeConversationTurns.length === 0 && generalQuestionSeedContext.trim().length > 0;
        if (!selectedSessionId || isLegacyConversationId(selectedSessionId)) {
          const threadId = await createAnalysisThreadWithTurn({
            title: createAnalysisTitle(response.analysisQuestion),
            question: response.analysisQuestion,
            answer: response.answer,
            model: response.model,
            provider: response.provider,
            snapshotHash: response.snapshotHash,
            generatedAt: response.generatedAt,
          });
          setSelectedSessionId(threadId);
        } else {
          await appendAnalysisThreadTurn(selectedSessionId, {
            question: response.analysisQuestion,
            answer: response.answer,
            model: response.model,
            provider: response.provider,
            snapshotHash: response.snapshotHash,
            generatedAt: response.generatedAt,
          });
        }
        setAnalysisSuccess(
          !selectedSessionId || isLegacyConversationId(selectedSessionId)
            ? '已開啟新對話。'
            : '已加入追問。',
        );
        if (usedSeedContext) {
          setGeneralQuestionSeedContext('');
        }
        return;
      }

      const savedSession: Omit<AnalysisSession, 'id' | 'updatedAt' | 'createdAt'> = {
        category: response.category,
        title: createAnalysisTitle(response.analysisQuestion),
        question: response.analysisQuestion,
        result: response.answer,
        model: response.model,
        provider: response.provider,
        snapshotHash: response.snapshotHash,
        delivery: 'manual',
      };
      await addAnalysisSession(savedSession);
      setAnalysisSuccess('每月資產分析已完成。');
    } catch (error) {
      setAnalysisError(error instanceof Error ? error.message : '投資組合分析失敗，請稍後再試。');
    } finally {
      setIsAnalyzing(false);
    }
  }

  async function handleFollowUp(quickQuestion?: string) {
    if (
      !snapshotHash ||
      !holdings.length ||
      !isInteractiveCategory
    ) {
      return;
    }

    const effectiveFollowUpQuestion = (quickQuestion ?? followUpQuestion).trim();
    if (!effectiveFollowUpQuestion) {
      return;
    }

    const conversationContext = formatConversationContext(activeConversationTurns);

    setAnalysisError(null);
    setAnalysisSuccess(null);
    setPromptSettingsSuccess(null);
    setIsAnalyzing(true);

    try {
      const resolvedCacheKey = await createPortfolioAnalysisCacheKey(
        snapshotHash,
        selectedCategory,
        selectedModel,
        effectiveFollowUpQuestion,
        analysisBackground,
      );
      const request = await buildPortfolioAnalysisRequest(
        holdings,
        snapshotHash,
        resolvedCacheKey,
        selectedCategory,
        selectedModel,
        effectiveFollowUpQuestion,
        analysisBackground,
        conversationContext,
      );
      const response = (await callPortfolioFunction('analyze', request)) as PortfolioAnalysisResponse;

      const cachedResult: CachedPortfolioAnalysis = {
        cacheKey: response.cacheKey,
        snapshotHash: response.snapshotHash,
        category: response.category,
        provider: response.provider,
        model: response.model,
        enrichmentStatus: response.enrichmentStatus,
        analysisQuestion: response.analysisQuestion,
        analysisBackground: response.analysisBackground,
        delivery: response.delivery ?? 'manual',
        generatedAt: response.generatedAt,
        assetCount: holdings.length,
        answer: response.answer,
      };

      setLocalAnalysis(cachedResult);
      setAnalysisQuestionByCategory((current) => ({
        ...current,
        [selectedCategory]: '',
      }));
      setFollowUpQuestionByCategory((current) => ({
        ...current,
        [selectedCategory]: '',
      }));
      await persistAnalysis(cachedResult);
      if (!selectedSessionId || isLegacyConversationId(selectedSessionId)) {
        const threadId = await createAnalysisThreadWithTurn({
          title: createAnalysisTitle(response.analysisQuestion),
          question: response.analysisQuestion,
          answer: response.answer,
          model: response.model,
          provider: response.provider,
          snapshotHash: response.snapshotHash,
          generatedAt: response.generatedAt,
        });
        setSelectedSessionId(threadId);
      } else {
        await appendAnalysisThreadTurn(selectedSessionId, {
          question: response.analysisQuestion,
          answer: response.answer,
          model: response.model,
          provider: response.provider,
          snapshotHash: response.snapshotHash,
          generatedAt: response.generatedAt,
        });
      }
      setAnalysisSuccess('已加入追問。');
    } catch (error) {
      setAnalysisError(error instanceof Error ? error.message : '追問分析失敗，請稍後再試。');
    } finally {
      setIsAnalyzing(false);
    }
  }

  async function handleQuarterlyReportFollowUp(quickQuestion?: string) {
    if (!selectedReport) {
      return;
    }

    const effectiveFollowUpQuestion = (quickQuestion ?? followUpQuestionByCategory.asset_report).trim();
    if (!effectiveFollowUpQuestion) {
      return;
    }

    setAnalysisError(null);
    setAnalysisSuccess(null);
    setPromptSettingsSuccess(null);
    setIsAnalyzing(true);

    try {
      const conversationContext = buildQuarterlyReportContext(selectedReport);
      const followUpModel: PortfolioAnalysisModel = 'claude-opus-4-7';
      const followUpCacheKey = await createPortfolioAnalysisCacheKey(
        snapshotHash ?? selectedReport.currentSnapshotHash ?? '',
        'general_question',
        followUpModel,
        effectiveFollowUpQuestion,
        savedPromptSettings.general_question,
      );
      const request = await buildPortfolioAnalysisRequest(
        holdings,
        snapshotHash ?? selectedReport.currentSnapshotHash ?? '',
        followUpCacheKey,
        'general_question',
        followUpModel,
        effectiveFollowUpQuestion,
        savedPromptSettings.general_question,
        conversationContext,
      );
      const response = (await callPortfolioFunction('analyze', request)) as PortfolioAnalysisResponse;

      const cachedResult: CachedPortfolioAnalysis = {
        cacheKey: response.cacheKey,
        snapshotHash: response.snapshotHash,
        category: response.category,
        provider: response.provider,
        model: response.model,
        enrichmentStatus: response.enrichmentStatus,
        analysisQuestion: response.analysisQuestion,
        analysisBackground: response.analysisBackground,
        delivery: response.delivery ?? 'manual',
        generatedAt: response.generatedAt,
        assetCount: holdings.length,
        answer: response.answer,
      };

      setLocalAnalysis(cachedResult);
      setFollowUpQuestionByCategory((current) => ({
        ...current,
        asset_report: '',
      }));
      await persistAnalysis(cachedResult);
      if (selectedQuarterlyReportThread) {
        await appendAnalysisThreadTurn(selectedQuarterlyReportThread.id, {
          question: response.analysisQuestion,
          answer: response.answer,
          model: response.model,
          provider: response.provider,
          snapshotHash: response.snapshotHash,
          generatedAt: response.generatedAt,
        });
      } else {
        const threadId = await createAnalysisThreadWithTurn({
          title: `${selectedReport.quarter} 追問`,
          question: response.analysisQuestion,
          answer: response.answer,
          model: response.model,
          provider: response.provider,
          snapshotHash: response.snapshotHash,
          generatedAt: response.generatedAt,
          sourceReportId: selectedReport.id,
        });
        void threadId;
      }
      setAnalysisSuccess('已向季度報告追問。');
    } catch (error) {
      setAnalysisError(error instanceof Error ? error.message : '追問分析失敗，請稍後再試。');
    } finally {
      setIsAnalyzing(false);
    }
  }

  async function handleSavePromptSettings() {
    setPromptSettingsSuccess(null);
    setAnalysisError(null);
    setIsSavingPromptSettings(true);

    try {
      await persistSettings({
        asset_analysis: savedPromptSettings.asset_analysis,
        general_question: promptDrafts.general_question,
        asset_report: savedPromptSettings.asset_report,
      });
      setPromptSettingsSuccess('設定已儲存。');
    } catch (error) {
      setAnalysisError(error instanceof Error ? error.message : '儲存設定失敗，請稍後再試。');
    } finally {
      setIsSavingPromptSettings(false);
    }
  }

  async function handleGenerateMonthlyAnalysisReport() {
    setAnalysisError(null);
    setAnalysisSuccess(null);
    setReportActionError(null);
    setReportActionMessage(null);
    setGeneratingPeriodicReport('monthly');

    try {
      const response = (await callPortfolioFunction('manual-monthly-analysis')) as {
        message?: string;
      };
      setReportActionMessage(response.message ?? '已開始生成每月資產分析。');
    } catch (error) {
      setReportActionError(error instanceof Error ? error.message : '生成每月資產分析失敗，請稍後再試。');
    } finally {
      setGeneratingPeriodicReport(null);
    }
  }

  async function handleGenerateQuarterlyReport() {
    setAnalysisError(null);
    setAnalysisSuccess(null);
    setReportActionError(null);
    setReportActionMessage(null);
    setGeneratingPeriodicReport('quarterly');

    try {
      const response = (await callPortfolioFunction('manual-quarterly-report')) as {
        message?: string;
      };
      setReportActionMessage(response.message ?? '已開始生成季度報告。');
    } catch (error) {
      setReportActionError(error instanceof Error ? error.message : '生成季度報告失敗，請稍後再試。');
    } finally {
      setGeneratingPeriodicReport(null);
    }
  }

  async function generateAndUploadPdf(report: QuarterlyReport) {
    if (!storage) {
      throw new Error('Firebase Storage 尚未設定完成，請先補上 storageBucket。');
    }

    const pdf = await createQuarterlyReportPdf(report);
    const arrayBuffer = pdf.output('arraybuffer');
    const storageRef = ref(
      storage,
      `reports/quarterly/${sanitizeQuarterStorageKey(report.quarter)}.pdf`,
    );

    await uploadBytes(storageRef, new Uint8Array(arrayBuffer), {
      contentType: 'application/pdf',
      customMetadata: {
        quarter: report.quarter,
        generatedAt: report.generatedAt,
      },
    });

    const downloadUrl = await getDownloadURL(storageRef);
    await updateQuarterlyReportPdfUrl(report.id, downloadUrl);
    return downloadUrl;
  }

  async function handleGeneratePdf(report: QuarterlyReport) {
    setGeneratingReportId(report.id);
    setReportActionMessage(null);
    setReportActionError(null);

    try {
      await generateAndUploadPdf(report);
      setReportActionMessage(`${report.quarter} PDF 已生成。`);
    } catch (nextError) {
      setReportActionError(getQuarterlyReportsErrorMessage(nextError));
    } finally {
      setGeneratingReportId(null);
    }
  }

  const latestConversationTurn = activeConversationTurns[activeConversationTurns.length - 1] ?? null;
  const latestMonthlyAnalysis = currentMonthAnalysis ?? monthlyAnalysisSessions[0] ?? null;
  const currentResponse =
    isInteractiveCategory
      ? latestConversationTurn
      : isPortfolioAnalysisCategory && latestMonthlyAnalysis
        ? {
            question: latestMonthlyAnalysis.title || '每月資產分析',
            answer: latestMonthlyAnalysis.result,
            generatedAt: latestMonthlyAnalysis.updatedAt,
            model: latestMonthlyAnalysis.model,
          }
        : isQuarterlyCategory && latestReport
          ? {
              question: latestReport.quarter,
              answer: latestReport.report,
              generatedAt: latestReport.generatedAt,
              model: latestReport.model,
            }
          : null;

  function handleCopyCurrentResponse() {
    if (!currentResponse?.answer) {
      return;
    }

    void navigator.clipboard.writeText(currentResponse.answer);
    setAnalysisSuccess('已複製目前回覆。');
  }

  return (
    <div className="page-stack analysis-page">
      <section className="card analysis-action-panel">
        <div className="analysis-page-header">
          <div className="analysis-page-heading">
            <h2>問問題或生成報告</h2>
            <p className="table-hint">{selectedCategoryOption.helper}</p>
          </div>
        </div>

        <div className="analysis-tab-grid" role="tablist" aria-label="分析分類">
          {analysisCategoryOptions.map((option) => {
            const isActive = selectedCategory === option.value;

            return (
              <button
                key={option.value}
                type="button"
                className={isActive ? 'analysis-tab-card active' : 'analysis-tab-card'}
                onClick={() => setSelectedCategory(option.value)}
              >
                <strong>{option.shortLabel}</strong>
              </button>
            );
          })}
        </div>

        <div className="analysis-category-row">
          <label className="form-field analysis-inline-model">
            <span>模型</span>
            <select
              value={isQuarterlyCategory || isPortfolioAnalysisCategory ? 'claude-opus-4-7' : selectedModel}
              onChange={(event) => setSelectedModel(event.target.value as PortfolioAnalysisModel)}
              disabled={isAnalyzing || !isInteractiveCategory}
            >
              {analysisModelOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label} · {option.hint}
                </option>
              ))}
            </select>
          </label>
        </div>

        {isInteractiveCategory ? (
          <div className="analysis-chat-composer">
            <label className="form-field" style={{ gridColumn: '1 / -1' }}>
              <span>問題</span>
              <textarea
                value={analysisQuestion}
                onChange={(event) => {
                  const nextValue = event.target.value;
                  setAnalysisQuestionByCategory((current) => ({
                    ...current,
                    general_question: nextValue,
                  }));
                  setFollowUpQuestionByCategory((current) => ({
                    ...current,
                    general_question: nextValue,
                  }));
                }}
                placeholder="輸入問題後送出"
                rows={3}
                disabled={isAnalyzing}
              />
            </label>

            <div className="analysis-chat-input-row">
              <button
                className="button button-secondary"
                type="button"
                onClick={() => {
                  setSelectedSessionId(null);
                  setAnalysisQuestionByCategory((current) => ({ ...current, general_question: '' }));
                  setFollowUpQuestionByCategory((current) => ({ ...current, general_question: '' }));
                }}
              >
                新對話
              </button>
              <button
                className="button button-primary"
                type="button"
                onClick={() => {
                  if (activeConversationTurns.length > 0) {
                    void handleFollowUp();
                    return;
                  }

                  void handleAnalyzePortfolio();
                }}
                disabled={!analysisQuestion.trim() || !canAnalyze || isAnalyzing}
              >
                {isAnalyzing ? '送出中...' : '送出問題'}
              </button>
            </div>
          </div>
        ) : null}

        {isPortfolioAnalysisCategory ? (
          <div className="analysis-scheduled-actions">
            <p className="status-message">
              {canGenerateMonthlyAnalysisNow(currentTime)
                ? currentMonthAnalysis
                  ? '本月每月資產分析已經生成。'
                  : '已進入本月可生成時段。'
                : '未到每月 1 號香港時間上午 8:00。'}
            </p>
            <button
              className="button button-primary"
              type="button"
              onClick={() => void handleGenerateMonthlyAnalysisReport()}
              disabled={!canGenerateCurrentMonthAnalysis || generatingPeriodicReport === 'monthly'}
            >
              {generatingPeriodicReport === 'monthly' ? '生成中...' : '生成月報'}
            </button>
          </div>
        ) : null}

        {isQuarterlyCategory ? (
          <div className="analysis-scheduled-actions">
            <p className="status-message">
              {canGenerateQuarterlyReportNow(currentTime)
                ? currentQuarterReport
                  ? '本季季度報告已經生成。'
                  : '已進入本季可生成時段。'
                : '未到季度報告可生成時段。'}
            </p>
            <button
              className="button button-primary"
              type="button"
              onClick={() => void handleGenerateQuarterlyReport()}
              disabled={!canGenerateCurrentQuarterReport || generatingPeriodicReport === 'quarterly'}
            >
              {generatingPeriodicReport === 'quarterly' ? '生成中...' : '生成季報'}
            </button>
          </div>
        ) : null}
      </section>

      {isPromptSettingsOpen ? (
        <div
          className="modal-backdrop analysis-settings-modal"
          role="dialog"
          aria-modal="true"
          aria-label="分析設定"
          onClick={() => setIsPromptSettingsOpen(false)}
        >
          <section className="modal-card modal-card-wide analysis-settings-card" onClick={(event) => event.stopPropagation()}>
            <div className="section-heading">
              <div>
                <p className="eyebrow">Settings</p>
                <h2>分析設定</h2>
              </div>
              <button
                className="button button-secondary"
                type="button"
                onClick={() => setIsPromptSettingsOpen(false)}
              >
                關閉
              </button>
            </div>

            <div className="analysis-category-intro">
              <h2>一般問題</h2>
              <p className="status-message">
                只可在網頁中設定一般問題的背景資料。
              </p>
              <p className="table-hint">
                每月資產分析與季度報告會沿用內部設定，無法在此頁面修改。
              </p>
            </div>

            <div className="asset-form-grid">
              <label className="form-field" style={{ gridColumn: '1 / -1' }}>
                <span>背景內容</span>
                <textarea
                  value={promptDrafts.general_question}
                  onChange={(event) =>
                    setPromptDrafts((current) => ({
                      ...current,
                      general_question: event.target.value,
                    }))
                  }
                  placeholder="輸入希望固定帶入的分析背景。"
                  rows={5}
                  disabled={isSavingPromptSettings}
                />
              </label>
            </div>

            {selectedCategory === 'asset_analysis' ? (
              <div className="analysis-advanced-panel">
                <div className="section-heading">
                  <div>
                    <p className="eyebrow">Advanced</p>
                    <h2>手動生成</h2>
                  </div>
                </div>

                <div className="asset-form-grid">
                  <label className="form-field" style={{ gridColumn: '1 / -1' }}>
                    <span>分析重點</span>
                    <textarea
                      value={analysisQuestionByCategory.asset_analysis}
                      onChange={(event) =>
                        setAnalysisQuestionByCategory((current) => ({
                          ...current,
                          asset_analysis: event.target.value,
                        }))
                      }
                      placeholder={analysisCategoryOptions[1].questionPlaceholder}
                      rows={4}
                      disabled={isAnalyzing}
                    />
                  </label>
                </div>

                <div className="button-row">
                  <button
                    className="button button-secondary"
                    type="button"
                    onClick={() => void handleAnalyzePortfolio()}
                    disabled={!canAnalyze}
                  >
                    {isAnalyzing ? '生成中...' : '立即生成'}
                  </button>
                </div>
              </div>
            ) : null}

            <div className="button-row">
              <button
                className="button button-primary"
                type="button"
                onClick={handleSavePromptSettings}
                disabled={isSavingPromptSettings}
              >
                {isSavingPromptSettings ? '儲存中...' : '儲存設定'}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      <StatusMessages
        errors={[
          assetsError,
          snapshotHashError,
          cacheError,
          analysisSessionsError,
          analysisThreadsError,
          analysisSettingsError,
          analysisError,
          reportsError,
          reportActionError,
        ]}
        successes={[analysisSuccess, promptSettingsSuccess, reportActionMessage]}
      />
      {enrichmentWarning ? (
        <p className="status-message status-message-warning">{enrichmentWarning}</p>
      ) : null}
      {hasCachedAnalysis && !analysisSuccess && !isQuarterlyCategory ? (
        <p className="status-message">最近分析：{formatAnalysisTime(cachedAnalysis?.generatedAt ?? '')}</p>
      ) : null}
      {assetsStatus === 'loading' && !isQuarterlyCategory ? <p className="status-message">同步中</p> : null}
      {isEmpty && !isQuarterlyCategory ? <p className="status-message">尚未有可分析資產</p> : null}

      <section className="card analysis-current-response">
        <div className="section-heading">
          <div>
            <h2>目前回覆</h2>
            {currentResponse ? (
              <p className="table-hint">
                {getAnalysisModelLabel(currentResponse.model)} · {formatAnalysisTime(currentResponse.generatedAt)}
              </p>
            ) : (
              <p className="table-hint">送出問題或生成報告後會顯示在這裡。</p>
            )}
          </div>
          {currentResponse ? (
            <div className="analysis-report-preview-footer">
              <button
                className="button button-secondary"
                type="button"
                onClick={handleCopyCurrentResponse}
              >
                複製
              </button>
              {isQuarterlyCategory && latestReport?.pdfUrl ? (
                <a
                  className="button button-secondary"
                  href={latestReport.pdfUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  下載 PDF
                </a>
              ) : null}
            </div>
          ) : null}
        </div>

        {currentResponse ? (
          <div className="analysis-report-preview">
            <p className="analysis-summary-text">{truncateText(currentResponse.answer, 700)}</p>
          </div>
        ) : (
          <EmptyState
            title="尚未有回覆"
            reason="此頁只保留分析輸入、目前回覆與歷史記錄；資產分佈已移回總覽及報告詳情。"
          />
        )}
      </section>

      {isInteractiveCategory ? (
        <section className="card analysis-thread-card">
          <div className="section-heading">
            <div>
              <h2>歷史記錄</h2>
              <p className="table-hint">對話記錄</p>
            </div>
            <div className="analysis-thread-header-actions">
              <span className="chip chip-soft">{conversationArchiveSessions.length} 條對話</span>
            </div>
          </div>

          <div className="analysis-thread-layout">
            <aside className="analysis-thread-sidebar">
              {conversationArchiveSessions.length > 0 ? (
                <div className="analysis-archive-list">
                  {conversationArchiveSessions.slice(0, visibleCount).map((item) => {
                    const isActive = selectedSessionId === item.id;

                    return (
                      <button
                        key={item.id}
                        type="button"
                        className={isActive ? 'analysis-archive-row active' : 'analysis-archive-row'}
                        onClick={() => setSelectedSessionId(item.id)}
                      >
                        <div className="analysis-archive-main">
                          <strong>{item.title}</strong>
                          <p>
                            {formatAnalysisTime(item.updatedAt)} · {item.turnCount} 輪
                          </p>
                        </div>
                      </button>
                    );
                  })}
                  {visibleCount < conversationArchiveSessions.length ? (
                    <div className="button-row">
                      <button
                        className="button button-secondary"
                        type="button"
                        onClick={() =>
                          setVisibleCount((current) =>
                            Math.min(current + 10, conversationArchiveSessions.length),
                          )
                        }
                      >
                        載入更多
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : (
                <p className="status-message">尚未有對話。</p>
              )}
            </aside>

            <div className="analysis-thread-main">
              <div className="analysis-chat-thread">
                {activeConversationTurns.length > 0 ? (
                  activeConversationTurns.map((turn, index) => (
                    <div key={`${turn.generatedAt}-${index}`} className="analysis-thread-turn">
                      <div className="analysis-chat-bubble analysis-chat-bubble-user">
                        <div className="analysis-chat-bubble-meta">
                          <span>我</span>
                          <span>{formatAnalysisTime(turn.generatedAt)}</span>
                        </div>
                        <p>{turn.question}</p>
                      </div>
                      <div className="analysis-chat-bubble analysis-chat-bubble-assistant">
                        <div className="analysis-chat-bubble-meta">
                          <span>{getAnalysisModelLabel(turn.model)}</span>
                          <span>{formatAnalysisTime(turn.generatedAt)}</span>
                        </div>
                        <p style={{ whiteSpace: 'pre-wrap' }}>{turn.answer}</p>
                      </div>
                    </div>
                  ))
                ) : null}
              </div>

            </div>
          </div>
        </section>
      ) : null}

      {isPortfolioAnalysisCategory ? (
        <>
          <section className="card quarterly-list-card">
            <div className="section-heading">
              <div>
                <h2>歷史記錄</h2>
                <p className="table-hint">每月資產分析</p>
              </div>
              <span className="chip chip-soft">
                {monthlyAnalysisSessions.length > 0 ? `${monthlyAnalysisSessions.length} 份分析` : '尚未生成'}
              </span>
            </div>

            {monthlyAnalysisSessions.length === 0 ? (
              <EmptyState
                title="尚未生成每月分析"
                reason={
                  canGenerateCurrentMonthAnalysis
                    ? '可以立即生成第一份每月資產分析。'
                    : '未到每月生成時段，暫時未有可用的月報。'
                }
                primaryAction={
                  canGenerateCurrentMonthAnalysis ? (
                    <button
                      className="button button-primary"
                      type="button"
                      onClick={() => void handleGenerateMonthlyAnalysisReport()}
                      disabled={generatingPeriodicReport === 'monthly'}
                    >
                      {generatingPeriodicReport === 'monthly' ? '生成中...' : '生成本月分析'}
                    </button>
                  ) : (
                    <button
                      className="button button-secondary"
                      type="button"
                      onClick={() => setIsPromptSettingsOpen(true)}
                    >
                      檢視分析設定
                    </button>
                  )
                }
                secondaryAction={
                  <button
                    className="button button-secondary"
                    type="button"
                    onClick={() => setSelectedCategory('general_question')}
                  >
                    切換至一般問題
                  </button>
                }
              />
            ) : (
              <div className="quarterly-report-list">
                {monthlyAnalysisSessions.map((session) => {
                  const isSelected = session.id === selectedMonthlyAnalysisId;
                  const isExpanded = expandedMonthlyAnalysisId === session.id;
                  return (
                    <article
                      key={session.id}
                      className={isSelected ? 'quarterly-report-row active' : 'quarterly-report-row'}
                    >
                      <button
                        type="button"
                        className="quarterly-report-row-main"
                        onClick={() => {
                          setSelectedMonthlyAnalysisId(session.id);
                          setExpandedMonthlyAnalysisId(session.id);
                        }}
                      >
                        <div>
                          <strong>{session.title}</strong>
                          <p>{formatGeneratedAt(session.updatedAt)}</p>
                        </div>
                        <span className="table-hint">{getAnalysisModelLabel(session.model)}</span>
                      </button>
                      {isExpanded ? (
                        <div className="analysis-report-body">
                          <ReportAllocationSummaryCard
                            summary={session.allocationSummary}
                            displayCurrency={displayCurrency}
                          />
                          <div className="quarterly-report-body">
                            {splitReportIntoSections(session.result).map((section, sectionIndex) => (
                              <section
                                key={`${session.id}-${sectionIndex}`}
                                className="quarterly-report-section"
                              >
                                {section.title ? <h3>{section.title}</h3> : null}
                                {splitParagraphs(section.body).map((paragraph, paragraphIndex) => (
                                  <p key={`${session.id}-${sectionIndex}-${paragraphIndex}`}>{paragraph}</p>
                                ))}
                              </section>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </>
      ) : null}

      {isQuarterlyCategory ? (
        <>
          <section className="card quarterly-list-card">
            <div className="section-heading">
              <div>
                <h2>歷史記錄</h2>
                <p className="table-hint">季度投資報告</p>
              </div>
              <span className="chip chip-soft">
                {reportsStatus === 'loading' ? '同步中' : `${reports.length} 份報告`}
              </span>
            </div>

            {reportsStatus === 'ready' && reports.length === 0 ? (
              <EmptyState
                title="尚未生成季度報告"
                reason="生成第一份季度報告後，這裡會列出歷史版本同 PDF 下載入口。"
                primaryAction={
                  canGenerateCurrentQuarterReport ? (
                    <button
                      className="button button-primary"
                      type="button"
                      onClick={() => void handleGenerateQuarterlyReport()}
                      disabled={generatingPeriodicReport === 'quarterly'}
                    >
                      {generatingPeriodicReport === 'quarterly' ? '生成中...' : '生成今季報告'}
                    </button>
                  ) : (
                    <button
                      className="button button-secondary"
                      type="button"
                      onClick={() => setIsPromptSettingsOpen(true)}
                    >
                      檢視分析設定
                    </button>
                  )
                }
                secondaryAction={
                  <button
                    className="button button-secondary"
                    type="button"
                    onClick={() => setSelectedCategory('asset_analysis')}
                  >
                    切換至每月分析
                  </button>
                }
              />
            ) : null}

            <div className="quarterly-report-list">
              {reports.map((report) => {
                const isSelected = report.id === selectedReportId;
                const isGenerating = generatingReportId === report.id;

                return (
                  <article
                    key={report.id}
                    className={isSelected ? 'quarterly-report-row active' : 'quarterly-report-row'}
                  >
                    <button
                      type="button"
                      className="quarterly-report-row-main"
                      onClick={() => setSelectedReportId(report.id)}
                    >
                      <div>
                        <strong>{report.quarter}</strong>
                        <p>{formatGeneratedAt(report.generatedAt)}</p>
                      </div>
                      <span className="table-hint">
                        {report.provider ? `${report.provider} · ${report.model}` : report.model}
                      </span>
                    </button>

                    <div className="quarterly-report-actions">
                      {report.pdfUrl ? (
                        <a
                          className="button button-secondary"
                          href={report.pdfUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          下載 PDF
                        </a>
                      ) : (
                        <button
                          type="button"
                          className="button button-secondary"
                          onClick={() => void handleGeneratePdf(report)}
                          disabled={isGenerating}
                        >
                          {isGenerating ? '生成中...' : '生成 PDF'}
                        </button>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          </section>

          {selectedReport ? (
            <section className="card quarterly-viewer-card">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">報告全文</p>
                  <h2>{selectedReport.quarter}</h2>
                  <p className="table-hint">{formatGeneratedAt(selectedReport.generatedAt)}</p>
                </div>
              </div>

              <ReportAllocationSummaryCard
                summary={selectedReport.allocationSummary}
                displayCurrency={displayCurrency}
              />

              <div className="quarterly-report-body">
                {selectedSections.map((section, index) => (
                  <section key={`${selectedReport.id}-${index}`} className="quarterly-report-section">
                    {section.title ? <h3>{section.title}</h3> : null}
                    {splitParagraphs(section.body).map((paragraph, paragraphIndex) => (
                      <p key={`${selectedReport.id}-${index}-${paragraphIndex}`}>{paragraph}</p>
                    ))}
                  </section>
                ))}
              </div>
            </section>
          ) : null}

          {selectedReport ? (
            <section className="card analysis-thread-card">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">追問</p>
                  <h2>追問此報告</h2>
                </div>
                <span className="chip chip-soft">
                  {selectedQuarterlyReportThread
                    ? `${selectedQuarterlyThreadTurnsStatus === 'loading' ? '讀取中' : `${quarterlyActiveConversationTurns.length} 輪`}`
                    : '新 thread'}
                </span>
              </div>

              {quarterlyActiveConversationTurns.length > 0 ? (
                <div className="analysis-chat-thread">
                  {quarterlyActiveConversationTurns.map((turn, index) => (
                    <div key={`${turn.generatedAt}-${index}`} className="analysis-thread-turn">
                      <div className="analysis-chat-bubble analysis-chat-bubble-user">
                        <div className="analysis-chat-bubble-meta">
                          <span>我</span>
                          <span>{formatAnalysisTime(turn.generatedAt)}</span>
                        </div>
                        <p>{turn.question}</p>
                      </div>
                      <div className="analysis-chat-bubble analysis-chat-bubble-assistant">
                        <div className="analysis-chat-bubble-meta">
                          <span>{getAnalysisModelLabel(turn.model)}</span>
                          <span>{formatAnalysisTime(turn.generatedAt)}</span>
                        </div>
                        <p style={{ whiteSpace: 'pre-wrap' }}>{turn.answer}</p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="status-message">尚未有追問紀錄，可直接在下方輸入。</p>
              )}

              <div className="analysis-chat-composer">
                <label className="form-field" style={{ gridColumn: '1 / -1' }}>
                  <span>追問</span>
                  <textarea
                    value={followUpQuestionByCategory.asset_report}
                    onChange={(event) =>
                      setFollowUpQuestionByCategory((current) => ({
                        ...current,
                        asset_report: event.target.value,
                      }))
                    }
                    placeholder="例如：本季為何現金比例上升？哪一項持倉最值得減持？"
                    rows={4}
                    disabled={isAnalyzing}
                  />
                </label>

                <div className="analysis-chat-input-row">
                  <button
                    className="button button-primary"
                    type="button"
                    onClick={() => void handleQuarterlyReportFollowUp()}
                    disabled={!selectedReport || !followUpQuestionByCategory.asset_report.trim() || isAnalyzing}
                  >
                    {isAnalyzing ? '送出中...' : '送出'}
                  </button>
                </div>
              </div>
            </section>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
