import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import { jsPDF } from 'jspdf';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';

import { getHoldingValueInCurrency, mockPortfolio } from '../data/mockPortfolio';
import { useAnalysisCache } from '../hooks/useAnalysisCache';
import { useAnalysisSessions } from '../hooks/useAnalysisSessions';
import { useAnalysisSettings } from '../hooks/useAnalysisSettings';
import { usePortfolioAssets } from '../hooks/usePortfolioAssets';
import { storage } from '../lib/firebase/client';
import { recalculateHoldingAllocations } from '../lib/firebase/assets';
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

const REPORT_SECTION_TITLES = [
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
    shortLabel: '一般問題',
    helper: '同 AI 對話',
    questionPlaceholder: '例如：我而家現金比例是否偏高？要唔要再分散幣別？',
  },
  {
    value: 'asset_analysis',
    label: '資產分析',
    shortLabel: '資產分析',
    helper: '每月自動生成',
    questionPlaceholder: '例如：根據我目前資產，分析而家最值得留意嘅重點。',
  },
  {
    value: 'asset_report',
    label: '季度報告',
    shortLabel: '季度報告',
    helper: '每季自動生成',
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

function formatAnalysisMonthTitle(value: string) {
  if (!value) {
    return '最新分析';
  }

  try {
    const date = new Date(value);
    const year = new Intl.DateTimeFormat('zh-HK', {
      timeZone: 'Asia/Hong_Kong',
      year: 'numeric',
    }).format(date);
    const month = new Intl.DateTimeFormat('zh-HK', {
      timeZone: 'Asia/Hong_Kong',
      month: 'numeric',
    }).format(date);

    return `${year} 年 ${month} 月資產分析`;
  } catch {
    return '最新分析';
  }
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

function formatAnalysisArchiveTitle(session: AnalysisSession) {
  return createAnalysisTitle(session.question);
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
  const [selectedSettingsCategory, setSelectedSettingsCategory] = useState<AnalysisCategory>('general_question');
  const [isPromptSettingsOpen, setIsPromptSettingsOpen] = useState(false);
  const [visibleCount, setVisibleCount] = useState(10);
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
  const [conversationThreads, setConversationThreads] = useState<Record<AnalysisCategory, ConversationTurn[]>>({
    asset_analysis: [],
    general_question: [],
    asset_report: [],
  });
  const [promptDrafts, setPromptDrafts] = useState(savedPromptSettings);
  const [reports, setReports] = useState<QuarterlyReport[]>([]);
  const [reportsStatus, setReportsStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [reportsError, setReportsError] = useState<string | null>(null);
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const [generatingReportId, setGeneratingReportId] = useState<string | null>(null);
  const [reportActionMessage, setReportActionMessage] = useState<string | null>(null);
  const [reportActionError, setReportActionError] = useState<string | null>(null);

  const holdings: Holding[] = recalculateHoldingAllocations(
    firestoreHoldings,
    (holding) => getHoldingValueInCurrency(holding, mockPortfolio.baseCurrency),
  );
  const snapshotSignature = holdings.length > 0 ? createPortfolioSnapshotSignature(holdings) : '';
  const analysisQuestion = analysisQuestionByCategory[selectedCategory];
  const followUpQuestion = followUpQuestionByCategory[selectedCategory];
  const analysisBackground = savedPromptSettings[selectedCategory];
  const activeConversation = conversationThreads[selectedCategory];
  const isInteractiveCategory = selectedCategory === 'general_question';
  const isPortfolioAnalysisCategory = selectedCategory === 'asset_analysis';
  const isQuarterlyCategory = selectedCategory === 'asset_report';
  const selectedCategoryOption = useMemo(
    () =>
      analysisCategoryOptions.find((option) => option.value === selectedCategory) ??
      analysisCategoryOptions[0],
    [selectedCategory],
  );
  const selectedSettingsOption = useMemo(
    () =>
      analysisCategoryOptions.find((option) => option.value === selectedSettingsCategory) ??
      analysisCategoryOptions[0],
    [selectedSettingsCategory],
  );

  useEffect(() => {
    setLocalAnalysis(null);
    setAnalysisError(null);
    setAnalysisSuccess(null);
  }, [snapshotSignature, selectedModel, selectedCategory, analysisQuestion, analysisBackground]);

  useEffect(() => {
    setPromptDrafts(savedPromptSettings);
  }, [savedPromptSettings]);

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

  const conversationArchiveSessions =
    selectedCategory === 'general_question' ? analysisSessions : [];
  const categorySessions = analysisSessions.filter((session) => session.category === selectedCategory);
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
  const selectedSections = useMemo(
    () => splitReportIntoSections(selectedReport?.report ?? ''),
    [selectedReport],
  );
  const latestAnalysisSession = categorySessions[0] ?? null;
  const selectedAnalysisSession = useMemo(
    () => categorySessions.find((session) => session.id === selectedSessionId) ?? null,
    [categorySessions, selectedSessionId],
  );

  function loadAnalysisSession(
    session: AnalysisSession,
    targetCategory: AnalysisCategory = selectedCategory,
  ) {
    setSelectedSessionId(session.id);
    setAnalysisQuestionByCategory((current) => ({
      ...current,
      [targetCategory]: session.question,
    }));
    setFollowUpQuestionByCategory((current) => ({
      ...current,
      [targetCategory]: '',
    }));
    setConversationThreads((current) => ({
      ...current,
      [targetCategory]: [buildConversationTurnFromSession(session)],
    }));
    setLocalAnalysis({
      cacheKey: session.id,
      snapshotHash: session.snapshotHash ?? '',
      category: session.category,
      provider: session.provider ?? 'google',
      model: session.model,
      analysisQuestion: session.question,
      analysisBackground: savedPromptSettings[session.category],
      delivery: session.delivery ?? 'manual',
      generatedAt: session.updatedAt,
      assetCount: holdings.length,
      answer: session.result,
    });
  }

  useEffect(() => {
    if (
      isQuarterlyCategory ||
      selectedCategory === 'general_question' ||
      selectedSessionId ||
      categorySessions.length === 0
    ) {
      return;
    }

    const latestSession = categorySessions[0];
    loadAnalysisSession(latestSession);
  }, [
    categorySessions,
    holdings.length,
    isQuarterlyCategory,
    savedPromptSettings,
    selectedCategory,
    selectedSessionId,
  ]);

  async function handleAnalyzePortfolio() {
    if (!snapshotHash || !analysisCacheKey || holdings.length === 0 || isQuarterlyCategory) {
      setAnalysisError('目前沒有完整的資產快照可供分析。');
      return;
    }

    setAnalysisError(null);
    setAnalysisSuccess(null);
    setPromptSettingsSuccess(null);
    setIsAnalyzing(true);

    try {
      const request = buildPortfolioAnalysisRequest(
        holdings,
        snapshotHash,
        analysisCacheKey,
        selectedCategory,
        selectedModel,
        analysisQuestion,
        analysisBackground,
        '',
      );
      const response = (await callPortfolioFunction('analyze', request)) as PortfolioAnalysisResponse;

      const cachedResult: CachedPortfolioAnalysis = {
        cacheKey: response.cacheKey,
        snapshotHash: response.snapshotHash,
        category: response.category,
        provider: response.provider,
        model: response.model,
        analysisQuestion: response.analysisQuestion,
        analysisBackground: response.analysisBackground,
        delivery: response.delivery ?? 'manual',
        generatedAt: response.generatedAt,
        assetCount: holdings.length,
        answer: response.answer,
      };

      setLocalAnalysis(cachedResult);
      if (isInteractiveCategory) {
        setConversationThreads((current) => ({
          ...current,
          [selectedCategory]: [
            {
              question: response.analysisQuestion,
              answer: response.answer,
              generatedAt: response.generatedAt,
              model: response.model,
            },
          ],
        }));
      }
      setAnalysisQuestionByCategory((current) => ({
        ...current,
        [selectedCategory]: '',
      }));
      setFollowUpQuestionByCategory((current) => ({
        ...current,
        [selectedCategory]: '',
      }));
      await persistAnalysis(cachedResult);
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
      setAnalysisSuccess(isInteractiveCategory ? '回答已更新。' : '資產分析已完成。');
    } catch (error) {
      setAnalysisError(error instanceof Error ? error.message : '投資組合分析失敗，請稍後再試。');
    } finally {
      setIsAnalyzing(false);
    }
  }

  async function handleFollowUp() {
    if (
      !snapshotHash ||
      !analysisCacheKey ||
      !holdings.length ||
      !followUpQuestion.trim() ||
      !(selectedCategory === 'asset_analysis' || selectedCategory === 'general_question')
    ) {
      return;
    }

    const conversationContext = activeConversation
      .map((turn, index) => `第 ${index + 1} 輪\n使用者：${turn.question}\nAI：${turn.answer}`)
      .join('\n\n');

    setAnalysisError(null);
    setAnalysisSuccess(null);
    setPromptSettingsSuccess(null);
    setIsAnalyzing(true);

    try {
      const request = buildPortfolioAnalysisRequest(
        holdings,
        snapshotHash,
        analysisCacheKey,
        selectedCategory,
        selectedModel,
        followUpQuestion,
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
        analysisQuestion: response.analysisQuestion,
        analysisBackground: response.analysisBackground,
        delivery: response.delivery ?? 'manual',
        generatedAt: response.generatedAt,
        assetCount: holdings.length,
        answer: response.answer,
      };

      setLocalAnalysis(cachedResult);
      setConversationThreads((current) => ({
        ...current,
        [selectedCategory]: [
          ...current[selectedCategory],
          {
            question: response.analysisQuestion,
            answer: response.answer,
            generatedAt: response.generatedAt,
            model: response.model,
          },
        ],
      }));
      setAnalysisQuestionByCategory((current) => ({
        ...current,
        [selectedCategory]: '',
      }));
      setFollowUpQuestionByCategory((current) => ({
        ...current,
        [selectedCategory]: '',
      }));
      await persistAnalysis(cachedResult);
      await addAnalysisSession({
        category: response.category,
        title: createAnalysisTitle(response.analysisQuestion),
        question: response.analysisQuestion,
        result: response.answer,
        model: response.model,
        provider: response.provider,
        snapshotHash: response.snapshotHash,
        delivery: 'manual',
      });
      setAnalysisSuccess('已加入追問。');
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
        asset_analysis: promptDrafts.asset_analysis,
        general_question: promptDrafts.general_question,
        asset_report: promptDrafts.asset_report,
      });
      setPromptSettingsSuccess('設定已儲存。');
    } catch (error) {
      setAnalysisError(error instanceof Error ? error.message : '儲存設定失敗，請稍後再試。');
    } finally {
      setIsSavingPromptSettings(false);
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

  return (
    <div className="page-stack analysis-page">
      <section className="hero-panel analysis-hero-panel">
        <div className="analysis-page-header">
          <div className="analysis-page-heading">
            <p className="eyebrow">Analysis</p>
            <h2>分析與報告</h2>
            <p className="table-hint">分開睇對話、資產分析，同季度報告。</p>
          </div>

          <div className="analysis-page-actions">
            {!isQuarterlyCategory ? (
              <label className="form-field analysis-inline-model">
                <span>AI 模型</span>
                <select
                  value={selectedModel}
                  onChange={(event) => setSelectedModel(event.target.value as PortfolioAnalysisModel)}
                  disabled={isAnalyzing}
                >
                  {analysisModelOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label} · {option.hint}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <span className="chip chip-soft">季度自動生成</span>
            )}

            <button
              className="analysis-settings-link text-link"
              type="button"
              onClick={() => {
                setSelectedSettingsCategory(selectedCategory);
                setIsPromptSettingsOpen(true);
              }}
            >
              設定
            </button>
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
                <strong>{option.label}</strong>
                <span>{option.helper}</span>
              </button>
            );
          })}
        </div>
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

            <div className="trends-range-row" role="tablist" aria-label="設定類別">
              {analysisCategoryOptions.map((option) => (
                <button
                  key={`prompt-${option.value}`}
                  className={selectedSettingsCategory === option.value ? 'filter-chip active' : 'filter-chip'}
                  type="button"
                  onClick={() => setSelectedSettingsCategory(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>

            <div className="analysis-category-intro">
              <h2>{selectedSettingsOption.label}</h2>
              <p className="status-message">
                {selectedSettingsCategory === 'asset_report'
                  ? '設定季度報告生成時使用嘅固定背景。'
                  : '設定呢個分類每次分析都會帶入嘅固定背景。'}
              </p>
            </div>

            <div className="asset-form-grid">
              <label className="form-field" style={{ gridColumn: '1 / -1' }}>
                <span>背景內容</span>
                <textarea
                  value={promptDrafts[selectedSettingsCategory]}
                  onChange={(event) =>
                    setPromptDrafts((current) => ({
                      ...current,
                      [selectedSettingsCategory]: event.target.value,
                    }))
                  }
                  placeholder="輸入想固定帶入嘅分析背景。"
                  rows={5}
                  disabled={isSavingPromptSettings}
                />
              </label>
            </div>

            {selectedSettingsCategory === 'asset_analysis' && selectedCategory === 'asset_analysis' ? (
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
          analysisSettingsError,
          analysisError,
          reportsError,
          reportActionError,
        ]}
        successes={[analysisSuccess, promptSettingsSuccess, reportActionMessage]}
      />
      {hasCachedAnalysis && !analysisSuccess && !isQuarterlyCategory ? (
        <p className="status-message">最近分析：{formatAnalysisTime(cachedAnalysis?.generatedAt ?? '')}</p>
      ) : null}
      {assetsStatus === 'loading' && !isQuarterlyCategory ? <p className="status-message">同步中</p> : null}
      {isEmpty && !isQuarterlyCategory ? <p className="status-message">尚未有可分析資產</p> : null}

      {isInteractiveCategory ? (
      <section className="card analysis-chat-card">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Conversation</p>
              <h2>同 AI 對話</h2>
            </div>
            <span className="chip chip-soft">{conversationArchiveSessions.length} 條記錄</span>
          </div>

          <div className="analysis-chat-thread">
            {activeConversation.length > 0 ? (
              activeConversation.map((turn, index) => (
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
            ) : (
              <p className="status-message">未有對話，先問第一句。</p>
            )}
          </div>

          <div className="analysis-chat-composer">
            <label className="form-field" style={{ gridColumn: '1 / -1' }}>
              <span>訊息</span>
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
                placeholder={selectedCategoryOption.questionPlaceholder}
                rows={4}
                disabled={isAnalyzing}
              />
            </label>

            <div className="analysis-chat-input-row">
              <button
                className="button button-primary"
                type="button"
                onClick={() => {
                  if (activeConversation.length > 0) {
                    void handleFollowUp();
                    return;
                  }

                  void handleAnalyzePortfolio();
                }}
                disabled={!analysisQuestion.trim() || !canAnalyze || (activeConversation.length > 0 && !followUpQuestion.trim())}
              >
                {isAnalyzing ? '發送中...' : activeConversation.length > 0 ? '發送' : '開始對話'}
              </button>
              <Link className="button button-secondary" to="/assets">
                檢查資產資料
              </Link>
            </div>
          </div>

          <div className="analysis-records-panel">
            <div className="section-heading">
              <div>
                <p className="eyebrow">History</p>
                <h2>對話紀錄</h2>
              </div>
            </div>

            {conversationArchiveSessions.length > 0 ? (
              <div className="analysis-archive-list">
                {conversationArchiveSessions.slice(0, visibleCount).map((session) => {
                  const isActive = selectedSessionId === session.id;

                  return (
                    <button
                      key={session.id}
                      type="button"
                      className={isActive ? 'analysis-archive-row active' : 'analysis-archive-row'}
                      onClick={() => loadAnalysisSession(session, 'general_question')}
                    >
                      <div className="analysis-archive-main">
                        <strong>{formatAnalysisArchiveTitle(session)}</strong>
                        <p>{formatAnalysisTime(session.updatedAt)}</p>
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
              <p className="status-message">尚未有對話紀錄，之後會集中顯示喺呢度。</p>
            )}
          </div>
        </section>
      ) : null}

      {isPortfolioAnalysisCategory ? (
        <>
          <section className="card">
            <div className="section-heading">
              <div>
                <p className="eyebrow">最新分析</p>
                <h2>{formatAnalysisMonthTitle(latestAnalysisSession?.updatedAt ?? '')}</h2>
              </div>
              <span className="chip chip-soft">
                {latestAnalysisSession
                  ? `${getAnalysisModelLabel(latestAnalysisSession.model)} · ${
                      latestAnalysisSession.delivery === 'scheduled' ? '自動' : '手動'
                    }`
                  : '尚未有分析'}
              </span>
            </div>

            {latestAnalysisSession ? (
              <div className="analysis-report-preview">
                <p className="analysis-summary-text">{truncateText(latestAnalysisSession.result, 200)}</p>
                <div className="analysis-report-preview-footer">
                  <span className="table-hint">{formatGeneratedAt(latestAnalysisSession.updatedAt)}</span>
                  <button
                    className="button button-secondary"
                    type="button"
                    onClick={() => loadAnalysisSession(latestAnalysisSession)}
                  >
                    檢視全文
                  </button>
                </div>
              </div>
            ) : (
              <p className="status-message">尚未生成分析，請喺設定入面先手動生成。</p>
            )}
          </section>

          <section className="card">
            <div className="section-heading">
              <div>
                <p className="eyebrow">History</p>
                <h2>過往分析</h2>
              </div>
            </div>

            <p className="status-message">
              過往記錄已集中到「一般問題」。呢度暫時保持空白，等之後真係有分析摘要先再顯示。
            </p>
          </section>

          {selectedAnalysisSession ? (
            <section className="card analysis-report-preview">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">分析內容</p>
                  <h2>{createAnalysisTitle(selectedAnalysisSession.question)}</h2>
                  <p className="table-hint">{formatAnalysisTime(selectedAnalysisSession.updatedAt)}</p>
                </div>
                <span className="chip chip-strong">{getAnalysisModelLabel(selectedAnalysisSession.model)}</span>
              </div>

              <p className="analysis-summary-text" style={{ whiteSpace: 'pre-wrap' }}>
                {selectedAnalysisSession.result}
              </p>
            </section>
          ) : null}
        </>
      ) : null}

      {isQuarterlyCategory ? (
        <>
          <section className="card analysis-report-preview">
            <div className="section-heading">
              <div>
                <p className="eyebrow">最新報告</p>
                <h2>{latestReport?.quarter ?? '季度報告'}</h2>
              </div>
              {latestReport ? (
                latestReport.pdfUrl ? (
                  <a
                    className="button button-secondary"
                    href={latestReport.pdfUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    下載 PDF
                  </a>
                ) : (
                  <button
                    className="button button-secondary"
                    type="button"
                    onClick={() => void handleGeneratePdf(latestReport)}
                    disabled={generatingReportId === latestReport.id}
                  >
                    {generatingReportId === latestReport.id ? '生成中...' : '生成 PDF'}
                  </button>
                )
              ) : (
                <span className="chip chip-soft">
                  {reportsStatus === 'loading' ? '同步中' : `${reports.length} 份報告`}
                </span>
              )}
            </div>

            {latestReport ? (
              <div className="analysis-report-preview">
                <p className="analysis-summary-text">{truncateText(latestReport.report, 200)}</p>
                <div className="analysis-report-preview-footer">
                  <span className="table-hint">{formatGeneratedAt(latestReport.generatedAt)}</span>
                  <span className="chip chip-soft">
                    {latestReport.provider ? `${latestReport.provider} · ${latestReport.model}` : latestReport.model}
                  </span>
                </div>
              </div>
            ) : (
              <p className="status-message">尚未生成季度報告。</p>
            )}
          </section>

          <section className="card quarterly-list-card">
            <div className="section-heading">
              <div>
                <p className="eyebrow">History</p>
                <h2>過往報告</h2>
              </div>
              <span className="chip chip-soft">
                {reportsStatus === 'loading' ? '同步中' : `${reports.length} 份報告`}
              </span>
            </div>

            <p className="status-message">每季首日香港時間上午 9:00 自動生成一次季度報告。</p>

            {reportsStatus === 'ready' && reports.length === 0 ? (
              <p className="status-message">尚未生成季度報告。</p>
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
                  <p className="eyebrow">Report Body</p>
                  <h2>{selectedReport.quarter}</h2>
                  <p className="table-hint">{formatGeneratedAt(selectedReport.generatedAt)}</p>
                </div>
              </div>

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
        </>
      ) : null}
    </div>
  );
}
