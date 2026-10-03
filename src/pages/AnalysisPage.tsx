import { useCallback, useEffect, useMemo, useState } from 'react';

import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';

import { MonthlyReportPanel } from '../components/analysis/MonthlyReportPanel';
import { QuarterlyReportPanel } from '../components/analysis/QuarterlyReportPanel';
import { getHoldingValueInCurrency, mockPortfolio } from '../data/mockPortfolio';
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
  deleteQuarterlyReport,
  getQuarterlyReportsErrorMessage,
  subscribeToQuarterlyReports,
  updateQuarterlyReportPdfUrl,
  type QuarterlyReport,
} from '../lib/firebase/quarterlyReports';
import { callPortfolioFunction, PortfolioFunctionHttpError, isRetryablePortfolioFunctionError } from '../lib/api/vercelFunctions';
import type { MonthlyAnalysisJob } from '../types/monthlyAnalysisJob';
import { findCompletedMonthlyJobSession, getMonthlyReportPeriod } from '../lib/portfolio/monthlyAnalysisJob';
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
import { sortMonthlyAnalysisSessions } from '../lib/portfolio/overviewSelectors';
import { StatusMessages } from '../components/ui/StatusMessages';
import type { AnalysisSession, Holding } from '../types/portfolio';
import type {
  PortfolioAnalysisModel,
  PortfolioAnalysisResponse,
} from '../types/portfolioAnalysis';

type SnapshotHashStatus = 'idle' | 'loading' | 'ready' | 'error';
type ReportTab = 'asset_analysis' | 'asset_report';

const reportTabOptions: Array<{
  value: ReportTab;
  label: string;
}> = [
  {
    value: 'asset_analysis',
    label: '每月資產分析',
  },
  {
    value: 'asset_report',
    label: '季度投資報告',
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

function getPreviousCompletedQuarterLabel(date = new Date()) {
  const { year } = getHongKongDateParts(date);
  const currentQuarterNumber = getCurrentQuarterNumber(date);
  const previousQuarterNumber = currentQuarterNumber === 1 ? 4 : currentQuarterNumber - 1;
  const previousQuarterYear = currentQuarterNumber === 1 ? year - 1 : year;
  return `${previousQuarterYear}年Q${previousQuarterNumber}`;
}

function canGenerateMonthlyAnalysisNow(date = new Date()) {
  const { day, hour } = getHongKongDateParts(date);
  return day > 1 || (day === 1 && hour >= 8);
}

function canGenerateQuarterlyReportNow(date = new Date()) {
  const { month, day, hour } = getHongKongDateParts(date);
  const quarterStartMonth = Math.floor((month - 1) / 3) * 3 + 1;
  const isQuarterOpeningMonth = month === quarterStartMonth;
  return isQuarterOpeningMonth && (day > 1 || (day === 1 && hour >= 9));
}

function isMonthlyAnalysisRecord(title: string) {
  const normalized = title.trim();

  if (!normalized) {
    return false;
  }

  return /^\d{4}年.+(每月)?資產分析$/.test(normalized);
}

function getAnalysisModelLabel(model: string) {
  return model || '未指定模型';
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
  } = useAnalysisSettings();
  const [snapshotHash, setSnapshotHash] = useState<string | null>(null);
  const [snapshotHashStatus, setSnapshotHashStatus] = useState<SnapshotHashStatus>('idle');
  const [snapshotHashError, setSnapshotHashError] = useState<string | null>(null);
  const [selectedTab, setSelectedTab] = useState<ReportTab>('asset_analysis');
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [analysisSuccess, setAnalysisSuccess] = useState<string | null>(null);
  const [enrichmentWarning, setEnrichmentWarning] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [selectedMonthlyAnalysisId, setSelectedMonthlyAnalysisId] = useState<string | null>(null);
  const [followUpQuestion, setFollowUpQuestion] = useState('');
  const [reports, setReports] = useState<QuarterlyReport[]>([]);
  const [reportsStatus, setReportsStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [reportsError, setReportsError] = useState<string | null>(null);
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const [generatingReportId, setGeneratingReportId] = useState<string | null>(null);
  const [generatingPeriodicReport, setGeneratingPeriodicReport] = useState<'monthly' | 'quarterly' | null>(null);
  const [deletingMonthlyAnalysisId, setDeletingMonthlyAnalysisId] = useState<string | null>(null);
  const [deletingQuarterlyReportId, setDeletingQuarterlyReportId] = useState<string | null>(null);
  const [reportActionMessage, setReportActionMessage] = useState<string | null>(null);
  const [reportActionError, setReportActionError] = useState<string | null>(null);
  const [monthlyJobId, setMonthlyJobId] = useState<string | null>(null);
  const [currentTimeMs, setCurrentTimeMs] = useState(() => Date.now());
  const [displayCurrency] = useDisplayCurrency();

  const holdings: Holding[] = recalculateHoldingAllocations(
    firestoreHoldings,
    (holding) => getHoldingValueInCurrency(holding, mockPortfolio.baseCurrency),
  );
  const snapshotSignature = holdings.length > 0 ? createPortfolioSnapshotSignature(holdings) : '';
  const currentTime = useMemo(() => new Date(currentTimeMs), [currentTimeMs]);
  const isMonthlyTab = selectedTab === 'asset_analysis';
  const isQuarterlyTab = selectedTab === 'asset_report';
  const currentMonthPeriod = useMemo(
    () => getMonthlyReportPeriod(currentTime),
    [currentTime],
  );
  const currentQuarterLabel = useMemo(() => getPreviousCompletedQuarterLabel(currentTime), [currentTime]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setCurrentTimeMs(Date.now());
    }, 60 * 1000);

    return () => window.clearInterval(timer);
  }, []);

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

  const {
    entries: analysisSessions,
    error: analysisSessionsError,
    removeAnalysisSession,
  } = useAnalysisSessions();
  const {
    entries: analysisThreads,
    error: analysisThreadsError,
  } = useAnalysisThreads();
  const monthlyAnalysisSessions = useMemo(
    () =>
      sortMonthlyAnalysisSessions(
        analysisSessions.filter(
          (session) =>
            session.category === 'asset_analysis' && isMonthlyAnalysisRecord(session.title ?? ''),
        ),
      ),
    [analysisSessions],
  );
  const currentMonthAnalysis = useMemo(
    () => {
      return monthlyAnalysisSessions.find(
        (session) => session.id === currentMonthPeriod.docId || session.title === currentMonthPeriod.title,
      ) ?? null;
    },
    [currentMonthPeriod, monthlyAnalysisSessions],
  );
  const hasCurrentMonthAnalysis = currentMonthAnalysis != null;
  const canGenerateCurrentMonthAnalysis = useMemo(
    () => canGenerateMonthlyAnalysisNow(currentTime),
    [currentTime],
  );

  useEffect(() => {
    if (monthlyAnalysisSessions.length === 0) {
      setSelectedMonthlyAnalysisId(null);
      return;
    }

    setSelectedMonthlyAnalysisId((current) =>
      current && monthlyAnalysisSessions.some((session) => session.id === current)
        ? current
        : monthlyAnalysisSessions[0].id,
    );
  }, [monthlyAnalysisSessions]);

  const completeMonthlyGeneration = useCallback((sessionDocId: string, isTimeoutFallback = false, message?: string) => {
    setSelectedMonthlyAnalysisId(sessionDocId);
    setReportActionError(null);
    setReportActionMessage(message ?? (isTimeoutFallback
      ? '模型回應逾時，已儲存簡化月報；可稍後重新生成完整報告。'
      : '月報已完成並儲存。'));
    setMonthlyJobId(null);
    setGeneratingPeriodicReport(null);
  }, []);

  // Firestore can confirm completion even if the status request disconnects.
  useEffect(() => {
    if (!monthlyJobId) return;
    const saved = findCompletedMonthlyJobSession(monthlyAnalysisSessions, monthlyJobId);
    if (saved) completeMonthlyGeneration(saved.id, saved.isTimeoutFallback);
  }, [monthlyAnalysisSessions, monthlyJobId, completeMonthlyGeneration]);

  // Resume a running job after a refresh instead of starting a second model call.
  useEffect(() => {
    let active = true;
    void callPortfolioFunction('monthly-analysis-status').then((payload) => {
      const job = (payload as { job: MonthlyAnalysisJob | null }).job;
      if (!active || job?.status !== 'running') return;
      setMonthlyJobId(job.id);
      setGeneratingPeriodicReport('monthly');
      setReportActionMessage('月報正在背景生成，完成後會自動顯示。');
    }).catch(() => { /* The generate action reports access/network errors. */ });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!monthlyJobId) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const payload = await callPortfolioFunction('monthly-analysis-status', { jobId: monthlyJobId }) as { job: MonthlyAnalysisJob };
        if (!active) return;
        const job = payload.job;
        if (job.status === 'succeeded' && job.sessionDocId) {
          completeMonthlyGeneration(job.sessionDocId, job.isTimeoutFallback, job.message);
          return;
        }
        if (job.status === 'failed') {
          setReportActionMessage(null);
          setReportActionError(job.message ?? '月報生成失敗，請稍後再試。');
          setMonthlyJobId(null);
          setGeneratingPeriodicReport(null);
          return;
        }
      } catch (error) {
        if (!active) return;
        if (error instanceof PortfolioFunctionHttpError && error.status === 404) {
          const payload = await callPortfolioFunction('monthly-analysis-status').catch(() => null) as { job: MonthlyAnalysisJob | null } | null;
          if (!active) return;
          if (payload?.job?.status === 'running') {
            setMonthlyJobId(payload.job.id);
            return;
          }
        }
        if (!isRetryablePortfolioFunctionError(error)) {
          setReportActionMessage(null);
          setReportActionError(error instanceof Error ? error.message : '查詢月報狀態失敗。');
          setMonthlyJobId(null);
          setGeneratingPeriodicReport(null);
          return;
        }
        setReportActionMessage('連線暫時中斷，月報仍在背景處理，正在重新確認。');
      }
      if (active) timer = setTimeout(poll, 3000);
    };
    void poll();
    return () => { active = false; clearTimeout(timer); };
  }, [monthlyJobId, completeMonthlyGeneration]);

  const selectedReport = useMemo(
    () => reports.find((report) => report.id === selectedReportId) ?? null,
    [reports, selectedReportId],
  );
  const currentQuarterReport = useMemo(
    () => reports.find((report) => report.quarter === currentQuarterLabel) ?? null,
    [currentQuarterLabel, reports],
  );
  const canGenerateCurrentQuarterReport = useMemo(
    () => canGenerateQuarterlyReportNow(currentTime) && (currentQuarterReport == null || currentQuarterReport.isTimeoutFallback === true),
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
  const selectedQuarterlyReportThreadId = selectedQuarterlyReportThread?.id ?? null;
  const {
    entries: selectedQuarterlyThreadTurns,
    status: selectedQuarterlyThreadTurnsStatus,
  } = useAnalysisThreadTurns(selectedQuarterlyReportThreadId);
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
      primaryStatus: {
        label:
          isAnalyzing || generatingPeriodicReport
            ? '生成中'
            : analysisError || reportActionError || snapshotHashStatus === 'error'
              ? '生成失敗'
              : canGenerateCurrentMonthAnalysis || canGenerateCurrentQuarterReport
                ? '可生成'
                : '已就緒',
        tone:
          analysisError || reportActionError || snapshotHashStatus === 'error'
            ? 'danger'
            : isAnalyzing || generatingPeriodicReport || canGenerateCurrentMonthAnalysis || canGenerateCurrentQuarterReport
              ? 'warning'
              : 'success',
      },
    }),
    [
      analysisError,
      canGenerateCurrentMonthAnalysis,
      canGenerateCurrentQuarterReport,
      generatingPeriodicReport,
      isAnalyzing,
      reportActionError,
      snapshotHashStatus,
    ],
  );
  useTopBar(topBarConfig);

  async function handleQuarterlyReportFollowUp() {
    if (!selectedReport) {
      return;
    }

    const effectiveFollowUpQuestion = followUpQuestion.trim();
    if (!effectiveFollowUpQuestion) {
      return;
    }

    setAnalysisError(null);
    setAnalysisSuccess(null);
    setEnrichmentWarning(null);
    setIsAnalyzing(true);

    try {
      const conversationContext = buildQuarterlyReportContext(selectedReport);
      const followUpModel: PortfolioAnalysisModel = 'claude-opus-5';
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

      if (response.enrichmentStatus && response.enrichmentStatus !== 'ok') {
        setEnrichmentWarning('部分歷史數據載入失敗，AI 內容可能不完整');
      }

      setFollowUpQuestion('');
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
        await createAnalysisThreadWithTurn({
          title: `${selectedReport.quarter} 追問`,
          question: response.analysisQuestion,
          answer: response.answer,
          model: response.model,
          provider: response.provider,
          snapshotHash: response.snapshotHash,
          generatedAt: response.generatedAt,
          sourceReportId: selectedReport.id,
        });
      }
      setAnalysisSuccess('已向季度報告追問。');
    } catch (error) {
      setAnalysisError(error instanceof Error ? error.message : '追問分析失敗，請稍後再試。');
    } finally {
      setIsAnalyzing(false);
    }
  }

  async function handleGenerateMonthlyAnalysisReport() {
    setAnalysisError(null);
    setAnalysisSuccess(null);
    setReportActionError(null);
    setReportActionMessage('月報正在背景生成，通常需要 1–3 分鐘，完成後會自動顯示。');
    setGeneratingPeriodicReport('monthly');
    const jobId = crypto.randomUUID();

    try {
      // Reuse this ID if the acceptance response is lost. The server deduplicates
      // both retries of this POST and different clicks for the same month.
      let response: { job: MonthlyAnalysisJob } | undefined;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          response = await callPortfolioFunction('manual-monthly-analysis', { jobId }) as { job: MonthlyAnalysisJob };
          break;
        } catch (error) {
          if (!isRetryablePortfolioFunctionError(error) || attempt === 1) throw error;
        }
      }
      setMonthlyJobId(response!.job.id);
    } catch (error) {
      if (isRetryablePortfolioFunctionError(error)) {
        setMonthlyJobId(jobId);
        setReportActionMessage('連線暫時中斷，正在確認月報工作有否開始。');
        return;
      }
      setReportActionMessage(null);
      setReportActionError(error instanceof Error ? error.message : '生成每月資產分析失敗，請稍後再試。');
      setGeneratingPeriodicReport(null);
    }
  }

  async function handleGenerateQuarterlyReport(overwrite = false) {
    setAnalysisError(null);
    setAnalysisSuccess(null);
    setReportActionError(null);
    setReportActionMessage(null);
    setGeneratingPeriodicReport('quarterly');

    try {
      const response = (await callPortfolioFunction(
        'manual-quarterly-report',
        overwrite ? { overwrite: true } : {},
      )) as {
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

  async function handleDeleteQuarterlyReport(report: QuarterlyReport) {
    if (!window.confirm(`是否確認刪除「${report.quarter}」季度報告？此操作無法復原。`)) {
      return;
    }

    const nextReports = reports.filter((entry) => entry.id !== report.id);

    setReportActionMessage(null);
    setReportActionError(null);
    setDeletingQuarterlyReportId(report.id);
    setReports(nextReports);
    setSelectedReportId((current) =>
      current === report.id ? nextReports[0]?.id ?? null : current,
    );

    try {
      await deleteQuarterlyReport(report.id);
      setReportActionMessage(`已刪除「${report.quarter}」。`);
    } catch (nextError) {
      setReports((current) =>
        current.some((entry) => entry.id === report.id) ? current : [report, ...current],
      );
      setSelectedReportId((current) => current ?? report.id);
      setReportActionError(getQuarterlyReportsErrorMessage(nextError));
    } finally {
      setDeletingQuarterlyReportId(null);
    }
  }

  const latestMonthlyAnalysis = currentMonthAnalysis ?? monthlyAnalysisSessions[0] ?? null;
  const selectedMonthlyAnalysisForResponse =
    monthlyAnalysisSessions.find((session) => session.id === selectedMonthlyAnalysisId) ??
    latestMonthlyAnalysis;
  const currentResponse = isMonthlyTab
    ? selectedMonthlyAnalysisForResponse?.result ?? null
    : selectedReport?.report ?? null;

  function handleCopyCurrentResponse() {
    if (!currentResponse) {
      return;
    }

    void navigator.clipboard.writeText(currentResponse);
    setAnalysisSuccess('已複製目前內容。');
  }

  const monthlyStatusText = canGenerateMonthlyAnalysisNow(currentTime)
    ? hasCurrentMonthAnalysis
      ? '本月月報已生成，可重新生成。'
      : '本月可生成。'
    : '每月 1 號上午 8 時後可生成。';
  const quarterlyStatusText = canGenerateQuarterlyReportNow(currentTime)
    ? currentQuarterReport
      ? currentQuarterReport.isTimeoutFallback
        ? '本季報告為簡化版，可重新生成完整報告。'
        : '本季季報已生成。'
      : '本季可生成。'
    : '每季首月 1 號上午 9 時後可生成。';

  return (
    <div className="page-stack analysis-page">
      <section className="card analysis-action-panel">
        <div className="analysis-tab-grid" role="tablist" aria-label="報告類型">
          {reportTabOptions.map((option) => {
            const isActive = selectedTab === option.value;

            return (
              <button
                key={option.value}
                type="button"
                role="tab"
                aria-selected={isActive}
                className={isActive ? 'analysis-tab-card active' : 'analysis-tab-card'}
                onClick={() => setSelectedTab(option.value)}
              >
                <strong>{option.label}</strong>
              </button>
            );
          })}
        </div>

        <div className="analysis-generate-strip">
          <p className="status-message">
            {isMonthlyTab ? monthlyStatusText : quarterlyStatusText}
          </p>
          {isMonthlyTab ? (
            <button
              className="button button-primary"
              type="button"
              onClick={() => void handleGenerateMonthlyAnalysisReport()}
              disabled={!canGenerateCurrentMonthAnalysis || generatingPeriodicReport === 'monthly'}
            >
              {generatingPeriodicReport === 'monthly'
                ? '生成中...'
                : hasCurrentMonthAnalysis
                  ? '重新生成月報'
                  : '生成月報'}
            </button>
          ) : (
            <button
              className="button button-primary"
              type="button"
              onClick={() => void handleGenerateQuarterlyReport(currentQuarterReport?.isTimeoutFallback === true)}
              disabled={!canGenerateCurrentQuarterReport || generatingPeriodicReport === 'quarterly'}
            >
              {generatingPeriodicReport === 'quarterly'
                ? '生成中...'
                : currentQuarterReport?.isTimeoutFallback
                  ? '重新生成完整報告'
                  : '生成季報'}
            </button>
          )}
        </div>
      </section>

      <StatusMessages
        errors={[
          assetsError,
          snapshotHashError,
          analysisSessionsError,
          analysisThreadsError,
          analysisSettingsError,
          analysisError,
          reportsError,
          reportActionError,
        ]}
        successes={[analysisSuccess, reportActionMessage]}
      />
      {enrichmentWarning ? (
        <p className="status-message status-message-warning">{enrichmentWarning}</p>
      ) : null}
      {assetsStatus === 'loading' && isMonthlyTab ? (
        <p className="status-message">同步中</p>
      ) : null}
      {isEmpty && isMonthlyTab ? <p className="status-message">尚未有可分析資產</p> : null}

      <div id="stored-reports">
        {isMonthlyTab ? (
          <MonthlyReportPanel
          monthlyAnalysisSessions={monthlyAnalysisSessions}
          selectedMonthlyAnalysisId={selectedMonthlyAnalysisId}
          displayCurrency={displayCurrency}
          assetCount={holdings.length}
          canGenerateCurrentMonthAnalysis={canGenerateCurrentMonthAnalysis}
          deletingMonthlyAnalysisId={deletingMonthlyAnalysisId}
          onDeleteMonthlyAnalysisReport={(session) => void handleDeleteMonthlyAnalysisReport(session)}
          onSelectedMonthlyAnalysisIdChange={setSelectedMonthlyAnalysisId}
          onCopyReport={handleCopyCurrentResponse}
          formatGeneratedAt={formatGeneratedAt}
          getAnalysisModelLabel={getAnalysisModelLabel}
          />
        ) : (
          <QuarterlyReportPanel
          reports={reports}
          reportsStatus={reportsStatus}
          selectedReport={selectedReport}
          selectedReportId={selectedReportId}
          selectedSections={selectedSections}
          displayCurrency={displayCurrency}
          generatingReportId={generatingReportId}
          deletingReportId={deletingQuarterlyReportId}
          selectedQuarterlyReportThreadExists={Boolean(selectedQuarterlyReportThread)}
          selectedQuarterlyThreadTurnsStatus={selectedQuarterlyThreadTurnsStatus}
          quarterlyActiveConversationTurns={quarterlyActiveConversationTurns}
          followUpQuestion={followUpQuestion}
          isAnalyzing={isAnalyzing}
          canGenerateCurrentQuarterReport={canGenerateCurrentQuarterReport}
          onGeneratePdf={(report) => void handleGeneratePdf(report)}
          onDeleteReport={(report) => void handleDeleteQuarterlyReport(report)}
          onRegenerateFullReport={() => void handleGenerateQuarterlyReport(true)}
          onSelectedReportIdChange={setSelectedReportId}
          onCopyReport={handleCopyCurrentResponse}
          onFollowUpQuestionChange={setFollowUpQuestion}
          onQuarterlyReportFollowUp={() => void handleQuarterlyReportFollowUp()}
          formatGeneratedAt={formatGeneratedAt}
          formatAnalysisTime={formatAnalysisTime}
          getAnalysisModelLabel={getAnalysisModelLabel}
          />
        )}
      </div>
    </div>
  );
}
