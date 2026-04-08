import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import { getHoldingValueInCurrency, mockPortfolio } from '../data/mockPortfolio';
import { useAnalysisCache } from '../hooks/useAnalysisCache';
import { useAnalysisSessions } from '../hooks/useAnalysisSessions';
import { useAnalysisSettings } from '../hooks/useAnalysisSettings';
import { usePortfolioAssets } from '../hooks/usePortfolioAssets';
import { callPortfolioFunction } from '../lib/api/vercelFunctions';
import { recalculateHoldingAllocations } from '../lib/firebase/assets';
import {
  buildPortfolioAnalysisRequest,
  createPortfolioAnalysisCacheKey,
  createPortfolioSnapshotHash,
  createPortfolioSnapshotSignature,
} from '../lib/portfolio/analysisSnapshot';
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

const analysisCategoryOptions: Array<{
  value: AnalysisCategory;
  label: string;
  shortLabel: string;
  helper: string;
  questionPlaceholder: string;
}> = [
  {
    value: 'asset_analysis',
    label: '分析資產',
    shortLabel: '分析',
    helper: '針對持倉、風險與配置去分析。',
    questionPlaceholder: '例如：根據我目前資產，分析一下而家最值得留意嘅重點。',
  },
  {
    value: 'general_question',
    label: '一般問題',
    shortLabel: '一般問題',
    helper: '針對你而家想問嘅問題直接作答。',
    questionPlaceholder: '例如：我而家現金比例是否太高？應唔應該再分散幣別？',
  },
  {
    value: 'asset_report',
    label: '資產報告',
    shortLabel: '報告',
    helper: '整理成可回顧嘅報告內容。',
    questionPlaceholder: '例如：請根據我目前資產整理一份清晰嘅資產報告。',
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
    value: 'claude-opus-4-6',
    label: 'Claude Opus',
    hint: '4.6',
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

function createAnalysisTitle(question: string) {
  const trimmed = question.trim();

  if (!trimmed) {
    return '投資組合分析';
  }

  return trimmed.length > 26 ? `${trimmed.slice(0, 26)}...` : trimmed;
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
  const [selectedCategory, setSelectedCategory] = useState<AnalysisCategory>('asset_analysis');
  const [selectedModel, setSelectedModel] = useState<PortfolioAnalysisModel>('gemini-3.1-pro-preview');
  const [localAnalysis, setLocalAnalysis] = useState<CachedPortfolioAnalysis | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [analysisSuccess, setAnalysisSuccess] = useState<string | null>(null);
  const [promptSettingsSuccess, setPromptSettingsSuccess] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isSavingPromptSettings, setIsSavingPromptSettings] = useState(false);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
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
  const isScheduledCategory = selectedCategory === 'asset_analysis' || selectedCategory === 'asset_report';
  const selectedCategoryOption = useMemo(
    () =>
      analysisCategoryOptions.find((option) => option.value === selectedCategory) ??
      analysisCategoryOptions[0],
    [selectedCategory],
  );
  const generalQuestionOption = analysisCategoryOptions.find((option) => option.value === 'general_question');
  const assetAnalysisOption = analysisCategoryOptions.find((option) => option.value === 'asset_analysis');
  const assetReportOption = analysisCategoryOptions.find((option) => option.value === 'asset_report');

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

  const displayedAnalysis = localAnalysis ?? cachedAnalysis;
  const categorySessions = analysisSessions.filter((session) => session.category === selectedCategory);
  const hasAnalysis = Boolean(displayedAnalysis);
  const canAnalyze =
    assetsStatus === 'ready' &&
    holdings.length > 0 &&
    snapshotHashStatus === 'ready' &&
    analysisCacheKeyStatus === 'ready' &&
    !isAnalyzing;

  useEffect(() => {
    if (selectedCategory === 'general_question' || selectedSessionId || categorySessions.length === 0) {
      return;
    }

    const latestSession = categorySessions[0];
    setSelectedSessionId(latestSession.id);
    setLocalAnalysis({
      cacheKey: latestSession.id,
      snapshotHash: latestSession.snapshotHash ?? '',
      category: latestSession.category,
      provider: latestSession.provider ?? 'google',
      model: latestSession.model,
      analysisQuestion: latestSession.question,
      analysisBackground: savedPromptSettings[latestSession.category],
      delivery: latestSession.delivery ?? 'manual',
      generatedAt: latestSession.updatedAt,
      assetCount: holdings.length,
      answer: latestSession.result,
    });
  }, [categorySessions, holdings.length, savedPromptSettings, selectedCategory, selectedSessionId]);

  async function handleAnalyzePortfolio() {
    if (!snapshotHash || !analysisCacheKey || holdings.length === 0) {
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
      setAnalysisSuccess('分析已完成，結果已保存。');
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
      .map(
        (turn, index) =>
          `第 ${index + 1} 輪\n使用者：${turn.question}\nAI：${turn.answer}`,
      )
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
      setAnalysisSuccess('已加入追問並完成分析。');
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
      setPromptSettingsSuccess('Prompt 背景已儲存，之後每次分析都會自動帶入。');
    } catch (error) {
      setAnalysisError(error instanceof Error ? error.message : '儲存 Prompt 背景失敗，請稍後再試。');
    } finally {
      setIsSavingPromptSettings(false);
    }
  }

  return (
    <div className="page-stack">
      <section className="hero-panel">
        <div className="analysis-action-panel">
          <div className="analysis-category-row">
            <div className="analysis-category-group analysis-category-group-left" role="tablist" aria-label="分析類別">
              {generalQuestionOption ? (
                <button
                  className={selectedCategory === generalQuestionOption.value ? 'filter-chip active' : 'filter-chip'}
                  type="button"
                  onClick={() => setSelectedCategory(generalQuestionOption.value)}
                >
                  {generalQuestionOption.shortLabel}
                </button>
              ) : null}
              <label className="form-field analysis-inline-model">
                <span>主要用嘅 AI</span>
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
            </div>
            <div className="analysis-category-group analysis-category-group-right">
              {assetAnalysisOption ? (
                <button
                  className={selectedCategory === assetAnalysisOption.value ? 'filter-chip active' : 'filter-chip'}
                  type="button"
                  onClick={() => setSelectedCategory(assetAnalysisOption.value)}
                >
                  {assetAnalysisOption.shortLabel}
                </button>
              ) : null}
              {assetReportOption ? (
                <button
                  className={selectedCategory === assetReportOption.value ? 'filter-chip active' : 'filter-chip'}
                  type="button"
                  onClick={() => setSelectedCategory(assetReportOption.value)}
                >
                  {assetReportOption.shortLabel}
                </button>
              ) : null}
              <button
                className="button button-secondary analysis-prompt-button"
                type="button"
                onClick={() => setIsPromptSettingsOpen((current) => !current)}
              >
                {isPromptSettingsOpen ? '收起 Prompt 設定' : 'Prompt 設定'}
              </button>
            </div>
          </div>

          {isInteractiveCategory ? (
            <>
              <div className="asset-form-grid">
                <label className="form-field" style={{ gridColumn: '1 / -1' }}>
                  <span>對話內容</span>
                  <textarea
                    value={analysisQuestion}
                    onChange={(event) =>
                      setAnalysisQuestionByCategory((current) => ({
                        ...current,
                        [selectedCategory]: event.target.value,
                      }))
                    }
                    placeholder={selectedCategoryOption.questionPlaceholder}
                    rows={4}
                    disabled={isAnalyzing}
                  />
                </label>
              </div>

              <div className="button-row">
                <button
                  className="button button-primary"
                  type="button"
                  onClick={handleAnalyzePortfolio}
                  disabled={!canAnalyze}
                >
                  {isAnalyzing ? '分析中...' : hasAnalysis ? '重新分析我的組合' : '分析我的組合'}
                </button>
                <Link className="button button-secondary" to="/assets">
                  檢查資產資料
                </Link>
              </div>
            </>
          ) : (
            <div className="analysis-scheduled-actions">
              <p className="status-message">
                {selectedCategory === 'asset_analysis'
                  ? '每月 1 日香港時間上午 9:00 自動生成一次資產分析。'
                  : '每季首日香港時間上午 9:00 自動生成一次資產報告。'}
              </p>
              <button
                className="button button-secondary"
                type="button"
                onClick={handleAnalyzePortfolio}
                disabled={!canAnalyze}
              >
                {isAnalyzing ? '分析中...' : '立即生成'}
              </button>
            </div>
          )}
        </div>
      </section>

      {isPromptSettingsOpen ? (
        <section className="card">
          <div className="trends-range-row" role="tablist" aria-label="Prompt 類別">
            {analysisCategoryOptions.map((option) => (
              <button
                key={`prompt-${option.value}`}
                className={selectedCategory === option.value ? 'filter-chip active' : 'filter-chip'}
                type="button"
                onClick={() => setSelectedCategory(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>

          <div className="analysis-category-intro">
            <h2>{selectedCategoryOption.label}</h2>
            <p className="status-message">填入該分類固定背景，之後每次對話都會自動帶入分析。</p>
          </div>

          <div className="asset-form-grid">
            <label className="form-field" style={{ gridColumn: '1 / -1' }}>
              <span>背景內容</span>
              <textarea
                value={promptDrafts[selectedCategory]}
                onChange={(event) =>
                  setPromptDrafts((current) => ({
                    ...current,
                    [selectedCategory]: event.target.value,
                  }))
                }
                placeholder="例如：偏好保守分析、重視風險提示、希望直接指出配置問題。"
                rows={5}
                disabled={isSavingPromptSettings}
              />
            </label>
          </div>

          <div className="button-row">
            <button
              className="button button-primary"
              type="button"
              onClick={handleSavePromptSettings}
              disabled={isSavingPromptSettings}
            >
              {isSavingPromptSettings ? '儲存中...' : '儲存 Prompt'}
            </button>
          </div>
        </section>
      ) : null}

      {assetsError ? <p className="status-message status-message-error">{assetsError}</p> : null}
      {snapshotHashError ? <p className="status-message status-message-error">{snapshotHashError}</p> : null}
      {cacheError ? <p className="status-message status-message-error">{cacheError}</p> : null}
      {analysisSessionsError ? <p className="status-message status-message-error">{analysisSessionsError}</p> : null}
      {analysisSettingsError ? <p className="status-message status-message-error">{analysisSettingsError}</p> : null}
      {analysisError ? <p className="status-message status-message-error">{analysisError}</p> : null}
      {analysisSuccess ? <p className="status-message status-message-success">{analysisSuccess}</p> : null}
      {promptSettingsSuccess ? (
        <p className="status-message status-message-success">{promptSettingsSuccess}</p>
      ) : null}
      {hasCachedAnalysis && !analysisSuccess ? (
        <p className="status-message">最近分析：{formatAnalysisTime(cachedAnalysis?.generatedAt ?? '')}</p>
      ) : null}
      {assetsStatus === 'loading' ? <p className="status-message">同步中。</p> : null}
      {isEmpty ? <p className="status-message">未有可分析資產。</p> : null}

      {hasAnalysis ? (
        <section className="card">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Answer</p>
              <h2>分析回答</h2>
            </div>
            <span className="chip chip-strong">{displayedAnalysis?.model}</span>
          </div>

          <p className="analysis-summary-text" style={{ whiteSpace: 'pre-wrap' }}>
            {displayedAnalysis?.answer}
          </p>

          <div className="analysis-meta-grid">
            <div className="analysis-meta-item">
              <span>分析時間</span>
              <strong>{formatAnalysisTime(displayedAnalysis?.generatedAt ?? '')}</strong>
            </div>
            <div className="analysis-meta-item">
              <span>提問內容</span>
              <strong>{displayedAnalysis?.analysisQuestion || '未提供'}</strong>
            </div>
            <div className="analysis-meta-item">
              <span>快照資產數</span>
              <strong>{displayedAnalysis?.assetCount ?? holdings.length} 項</strong>
            </div>
          </div>

          {isInteractiveCategory && activeConversation.length > 0 ? (
            <div className="analysis-follow-up-card">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Follow Up</p>
                  <h2>延續對話</h2>
                </div>
              </div>

              <div className="analysis-thread-list">
                {activeConversation.map((turn, index) => (
                  <div key={`${turn.generatedAt}-${index}`} className="analysis-thread-turn">
                    <div className="analysis-thread-bubble user">
                      <span>你</span>
                      <p>{turn.question}</p>
                    </div>
                    <div className="analysis-thread-bubble assistant">
                      <span>{turn.model}</span>
                      <p style={{ whiteSpace: 'pre-wrap' }}>{turn.answer}</p>
                    </div>
                  </div>
                ))}
              </div>

              <div className="asset-form-grid">
                <label className="form-field" style={{ gridColumn: '1 / -1' }}>
                  <span>追問內容</span>
                  <textarea
                    value={followUpQuestion}
                    onChange={(event) =>
                      setFollowUpQuestionByCategory((current) => ({
                        ...current,
                        [selectedCategory]: event.target.value,
                      }))
                    }
                    placeholder="例如：如果我想降低波動，應該先調整邊一部分？"
                    rows={3}
                    disabled={isAnalyzing}
                  />
                </label>
              </div>

              <div className="button-row">
                <button
                  className="button button-primary"
                  type="button"
                  onClick={handleFollowUp}
                  disabled={!followUpQuestion.trim() || isAnalyzing}
                >
                  {isAnalyzing ? '分析中...' : '繼續提問'}
                </button>
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">History</p>
            <h2>{selectedCategory === 'general_question' ? `${selectedCategoryOption.label}對話紀錄` : `${selectedCategoryOption.label}紀錄`}</h2>
          </div>
        </div>

        <div className="settings-list">
          {categorySessions.length > 0 ? (
            <>
              {categorySessions.slice(0, visibleCount).map((session) => (
                <button
                  key={session.id}
                  type="button"
                  className={selectedSessionId === session.id ? 'setting-row active' : 'setting-row'}
                  onClick={() => {
                    setSelectedSessionId(session.id);
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
                    setConversationThreads((current) => ({
                      ...current,
                      [session.category]: [
                        {
                          question: session.question,
                          answer: session.result,
                          generatedAt: session.updatedAt,
                          model: session.model,
                        },
                      ],
                    }));
                  }}
                >
                  <div>
                    <strong>{session.title}</strong>
                    <p>{session.question}</p>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <strong>
                      {session.model}
                      {session.delivery === 'scheduled' ? ' · 自動' : ''}
                    </strong>
                    <p>{formatAnalysisTime(session.updatedAt)}</p>
                  </div>
                </button>
              ))}
              {visibleCount < categorySessions.length ? (
                <div className="button-row">
                  <button
                    className="button button-secondary"
                    type="button"
                    onClick={() =>
                      setVisibleCount((current) => Math.min(current + 10, categorySessions.length))
                    }
                  >
                    載入更多
                  </button>
                </div>
              ) : null}
            </>
          ) : (
            <p className="status-message">未有此分類的分析紀錄。</p>
          )}
        </div>
      </section>
    </div>
  );
}
