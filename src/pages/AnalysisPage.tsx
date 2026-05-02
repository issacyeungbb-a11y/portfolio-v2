import { useEffect, useMemo, useState } from 'react';

import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';

import { AnalysisConversationPanel } from '../components/analysis/AnalysisConversationPanel';
import { AnalysisSettingsModal } from '../components/analysis/AnalysisSettingsModal';
import { MonthlyReportPanel } from '../components/analysis/MonthlyReportPanel';
import { QuarterlyReportPanel } from '../components/analysis/QuarterlyReportPanel';
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
} from '../lib/firebase/analysisThreads';
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
import {
  createQuarterlyReportPdf,
  splitReportIntoSections,
} from '../lib/portfolio/quarterlyReportPdf';
import { StatusMessages } from '../components/ui/StatusMessages';
import type { AnalysisCategory, AnalysisSession, Holding } from '../types/portfolio';
import type {
  CachedPortfolioAnalysis,
  GeneralQuestionDataFreshness,
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

const analysisCategoryOptions: Array<{
  value: AnalysisCategory;
  label: string;
  helper: string;
  questionPlaceholder: string;
}> = [
  {
    value: 'general_question',
    label: '一般問題',
    helper: '即時對話',
    questionPlaceholder: '輸入問題後送出',
  },
  {
    value: 'asset_analysis',
    label: '每月資產分析',
    helper: '按月手動生成',
    questionPlaceholder: '例如：根據目前資產配置，請分析當前最值得留意的重點。',
  },
  {
    value: 'asset_report',
    label: '季度投資報告',
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
    value: 'claude-opus-4-7',
    label: 'Claude Opus',
    hint: '4.7 · 最佳分析',
  },
  {
    value: 'gemini-3.1-pro-preview',
    label: 'Google Gemini',
    hint: '3.1 Pro Preview',
  },
];

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
  const [selectedModel, setSelectedModel] = useState<PortfolioAnalysisModel>('claude-opus-4-7');
  const [localAnalysis, setLocalAnalysis] = useState<CachedPortfolioAnalysis | null>(null);
  const [lastGeneralQuestionMeta, setLastGeneralQuestionMeta] = useState<GeneralQuestionDataFreshness | null>(null);
  const [lastGeneralQuestionSources, setLastGeneralQuestionSources] = useState<string[]>([]);
  const [lastGeneralQuestionUncertainty, setLastGeneralQuestionUncertainty] = useState<string[]>([]);
  const [lastGeneralQuestionActions, setLastGeneralQuestionActions] = useState<string[]>([]);
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
  const [deletingMonthlyAnalysisId, setDeletingMonthlyAnalysisId] = useState<string | null>(null);
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
    removeAnalysisSession,
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
  const hasCurrentMonthAnalysis = currentMonthAnalysis != null;
  const canGenerateCurrentMonthAnalysis = useMemo(
    () => canGenerateMonthlyAnalysisNow(currentTime) && !hasCurrentMonthAnalysis,
    [currentTime, hasCurrentMonthAnalysis],
  );
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
          一般問題設定
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
      if (isInteractiveCategory && response.dataFreshness) {
        setLastGeneralQuestionMeta(response.dataFreshness);
        setLastGeneralQuestionSources(response.usedExternalSources ?? []);
        setLastGeneralQuestionUncertainty(response.uncertainty ?? []);
        setLastGeneralQuestionActions(response.suggestedActions ?? []);
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
      if (response.dataFreshness) {
        setLastGeneralQuestionMeta(response.dataFreshness);
        setLastGeneralQuestionSources(response.usedExternalSources ?? []);
        setLastGeneralQuestionUncertainty(response.uncertainty ?? []);
        setLastGeneralQuestionActions(response.suggestedActions ?? []);
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

  async function handleDeleteMonthlyAnalysisReport(session: AnalysisSession) {
    if (!window.confirm(`是否確認刪除「${session.title}」？此操作無法復原。`)) {
      return;
    }

    setAnalysisError(null);
    setAnalysisSuccess(null);
    setReportActionError(null);
    setReportActionMessage(null);
    setDeletingMonthlyAnalysisId(session.id);

    try {
      await removeAnalysisSession(session.id);
      setReportActionMessage(`已刪除「${session.title}」。`);
    } catch (error) {
      setReportActionError(error instanceof Error ? error.message : '刪除每月資產分析失敗，請稍後再試。');
    } finally {
      setDeletingMonthlyAnalysisId(null);
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
  const selectedMonthlyAnalysisForResponse =
    monthlyAnalysisSessions.find((session) => session.id === selectedMonthlyAnalysisId) ??
    latestMonthlyAnalysis;
  const currentResponse =
    isInteractiveCategory
      ? latestConversationTurn
      : isPortfolioAnalysisCategory && selectedMonthlyAnalysisForResponse
        ? {
            question: selectedMonthlyAnalysisForResponse.title || '每月資產分析',
            answer: selectedMonthlyAnalysisForResponse.result,
            generatedAt: selectedMonthlyAnalysisForResponse.updatedAt,
            model: selectedMonthlyAnalysisForResponse.model,
          }
        : isQuarterlyCategory && selectedReport
          ? {
              question: selectedReport.quarter,
              answer: selectedReport.report,
              generatedAt: selectedReport.generatedAt,
              model: selectedReport.model,
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
            <h2>分析工作台</h2>
            <p className="table-hint">{selectedCategoryOption.label} · {selectedCategoryOption.helper}</p>
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

        {isPortfolioAnalysisCategory ? (
          <div className="analysis-scheduled-actions">
            <p className="status-message">
              {canGenerateMonthlyAnalysisNow(currentTime)
                ? hasCurrentMonthAnalysis
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
        <AnalysisSettingsModal
          promptDrafts={promptDrafts}
          isSavingPromptSettings={isSavingPromptSettings}
          onClose={() => setIsPromptSettingsOpen(false)}
          onPromptDraftsChange={setPromptDrafts}
          onSave={handleSavePromptSettings}
        />
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

      {isInteractiveCategory ? (
        <AnalysisConversationPanel
          analysisQuestion={analysisQuestion}
          selectedSessionId={selectedSessionId}
          activeConversationTurns={activeConversationTurns}
          conversationArchiveSessions={conversationArchiveSessions}
          visibleCount={visibleCount}
          isAnalyzing={isAnalyzing}
          canAnalyze={canAnalyze}
          onAnalysisQuestionChange={setAnalysisQuestionByCategory}
          onFollowUpQuestionChange={setFollowUpQuestionByCategory}
          onSelectedSessionIdChange={setSelectedSessionId}
          onVisibleCountChange={setVisibleCount}
          onAnalyze={() => void handleAnalyzePortfolio()}
          onFollowUp={() => void handleFollowUp()}
          onCopyLatestResponse={handleCopyCurrentResponse}
          formatAnalysisTime={formatAnalysisTime}
          getAnalysisModelLabel={getAnalysisModelLabel}
          lastResponseMeta={lastGeneralQuestionMeta}
          lastResponseSources={lastGeneralQuestionSources}
          lastResponseUncertainty={lastGeneralQuestionUncertainty}
          lastResponseActions={lastGeneralQuestionActions}
        />
      ) : null}

      {isPortfolioAnalysisCategory ? (
        <MonthlyReportPanel
          monthlyAnalysisSessions={monthlyAnalysisSessions}
          selectedMonthlyAnalysisId={selectedMonthlyAnalysisId}
          expandedMonthlyAnalysisId={expandedMonthlyAnalysisId}
          displayCurrency={displayCurrency}
          assetCount={holdings.length}
          baseCurrency={mockPortfolio.baseCurrency}
          canGenerateCurrentMonthAnalysis={canGenerateCurrentMonthAnalysis}
          generatingPeriodicReport={generatingPeriodicReport}
          deletingMonthlyAnalysisId={deletingMonthlyAnalysisId}
          onGenerateMonthlyAnalysisReport={() => void handleGenerateMonthlyAnalysisReport()}
          onDeleteMonthlyAnalysisReport={(session) => void handleDeleteMonthlyAnalysisReport(session)}
          onSelectedMonthlyAnalysisIdChange={setSelectedMonthlyAnalysisId}
          onExpandedMonthlyAnalysisIdChange={setExpandedMonthlyAnalysisId}
          onOpenSettings={() => setIsPromptSettingsOpen(true)}
          onSwitchToGeneralQuestion={() => setSelectedCategory('general_question')}
          onCopyReport={handleCopyCurrentResponse}
          formatGeneratedAt={formatGeneratedAt}
          getAnalysisModelLabel={getAnalysisModelLabel}
        />
      ) : null}

      {isQuarterlyCategory ? (
        <QuarterlyReportPanel
          reports={reports}
          reportsStatus={reportsStatus}
          selectedReport={selectedReport}
          selectedReportId={selectedReportId}
          selectedSections={selectedSections}
          displayCurrency={displayCurrency}
          canGenerateCurrentQuarterReport={canGenerateCurrentQuarterReport}
          generatingPeriodicReport={generatingPeriodicReport}
          generatingReportId={generatingReportId}
          selectedQuarterlyReportThreadExists={Boolean(selectedQuarterlyReportThread)}
          selectedQuarterlyThreadTurnsStatus={selectedQuarterlyThreadTurnsStatus}
          quarterlyActiveConversationTurns={quarterlyActiveConversationTurns}
          followUpQuestion={followUpQuestionByCategory.asset_report}
          isAnalyzing={isAnalyzing}
          onGenerateQuarterlyReport={() => void handleGenerateQuarterlyReport()}
          onGeneratePdf={(report) => void handleGeneratePdf(report)}
          onSelectedReportIdChange={setSelectedReportId}
          onOpenSettings={() => setIsPromptSettingsOpen(true)}
          onSwitchToMonthly={() => setSelectedCategory('asset_analysis')}
          onCopyReport={handleCopyCurrentResponse}
          onFollowUpQuestionChange={setFollowUpQuestionByCategory}
          onQuarterlyReportFollowUp={() => void handleQuarterlyReportFollowUp()}
          formatGeneratedAt={formatGeneratedAt}
          formatAnalysisTime={formatAnalysisTime}
          getAnalysisModelLabel={getAnalysisModelLabel}
        />
      ) : null}
    </div>
  );
}
