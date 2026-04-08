import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import {
  getHoldingValueInCurrency,
  mockPortfolio,
} from '../data/mockPortfolio';
import { useAnalysisCache } from '../hooks/useAnalysisCache';
import { useAnalysisSessions } from '../hooks/useAnalysisSessions';
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

const ANALYSIS_PROMPT_STORAGE_KEY = 'portfolio-v2-analysis-prompts';

const analysisCategoryOptions: Array<{
  value: AnalysisCategory;
  label: string;
  eyebrow: string;
  title: string;
  helper: string;
  defaultPrompt: string;
}> = [
  {
    value: 'asset_analysis',
    label: '分析資產',
    eyebrow: 'Asset Analysis',
    title: '分析目前持倉與配置',
    helper: '聚焦風險、配置、集中度與值得留意嘅資產。',
    defaultPrompt: '根據我目前資產，分析一下而家最值得留意嘅重點。',
  },
  {
    value: 'general_question',
    label: '一般問題',
    eyebrow: 'General Question',
    title: '針對問題直接提問',
    helper: '你可以自由問關於組合、帳戶、現金配置或判斷邏輯嘅問題。',
    defaultPrompt: '根據我目前組合，直接回答我接住落嚟提出嘅問題。',
  },
  {
    value: 'asset_report',
    label: '資產報告',
    eyebrow: 'Asset Report',
    title: '生成可回顧嘅資產報告',
    helper: '適合輸出整理式報告，方便日後翻查與追蹤。',
    defaultPrompt: '請根據我目前資產整理一份清晰嘅資產報告，列出重點持倉、風險與跟進項目。',
  },
];

type AnalysisPromptMap = Record<AnalysisCategory, string>;

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

function getDefaultAnalysisPrompts(): AnalysisPromptMap {
  return analysisCategoryOptions.reduce<AnalysisPromptMap>((result, option) => {
    result[option.value] = option.defaultPrompt;
    return result;
  }, {
    asset_analysis: analysisCategoryOptions[0].defaultPrompt,
    general_question: analysisCategoryOptions[1].defaultPrompt,
    asset_report: analysisCategoryOptions[2].defaultPrompt,
  });
}

function loadStoredAnalysisPrompts() {
  const defaults = getDefaultAnalysisPrompts();

  if (typeof window === 'undefined') {
    return defaults;
  }

  try {
    const raw = window.localStorage.getItem(ANALYSIS_PROMPT_STORAGE_KEY);

    if (!raw) {
      return defaults;
    }

    const parsed = JSON.parse(raw) as Partial<Record<AnalysisCategory, string>>;

    return {
      asset_analysis: parsed.asset_analysis?.trim() || defaults.asset_analysis,
      general_question: parsed.general_question?.trim() || defaults.general_question,
      asset_report: parsed.asset_report?.trim() || defaults.asset_report,
    };
  } catch {
    return defaults;
  }
}

export function AnalysisPage() {
  const {
    holdings: firestoreHoldings,
    status: assetsStatus,
    error: assetsError,
    isEmpty,
  } = usePortfolioAssets();
  const [snapshotHash, setSnapshotHash] = useState<string | null>(null);
  const [snapshotHashStatus, setSnapshotHashStatus] = useState<SnapshotHashStatus>('idle');
  const [analysisCacheKey, setAnalysisCacheKey] = useState<string | null>(null);
  const [analysisCacheKeyStatus, setAnalysisCacheKeyStatus] = useState<SnapshotHashStatus>('idle');
  const [snapshotHashError, setSnapshotHashError] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<AnalysisCategory>('asset_analysis');
  const [analysisPrompts, setAnalysisPrompts] = useState<AnalysisPromptMap>(() => loadStoredAnalysisPrompts());
  const [selectedModel, setSelectedModel] = useState<PortfolioAnalysisModel>('gemini-3.1-pro-preview');
  const [localAnalysis, setLocalAnalysis] = useState<CachedPortfolioAnalysis | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [analysisSuccess, setAnalysisSuccess] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [isPromptSettingsOpen, setIsPromptSettingsOpen] = useState(false);

  const holdings: Holding[] = recalculateHoldingAllocations(
    firestoreHoldings,
    (holding) => getHoldingValueInCurrency(holding, mockPortfolio.baseCurrency),
  );
  const snapshotSignature =
    holdings.length > 0 ? createPortfolioSnapshotSignature(holdings) : '';
  const analysisInstruction = analysisPrompts[selectedCategory];
  const selectedCategoryOption =
    analysisCategoryOptions.find((option) => option.value === selectedCategory) ?? analysisCategoryOptions[0];

  useEffect(() => {
    setLocalAnalysis(null);
    setAnalysisError(null);
    setAnalysisSuccess(null);
  }, [snapshotSignature, selectedModel, selectedCategory, analysisInstruction]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(ANALYSIS_PROMPT_STORAGE_KEY, JSON.stringify(analysisPrompts));
  }, [analysisPrompts]);

  useEffect(() => {
    setSelectedSessionId(null);
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
      analysisInstruction,
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
  }, [snapshotHash, selectedModel, selectedCategory, analysisInstruction]);

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

  async function handleAnalyzePortfolio() {
    if (!snapshotHash || !analysisCacheKey || holdings.length === 0) {
      setAnalysisError('目前沒有完整的資產快照可供分析。');
      return;
    }

    setAnalysisError(null);
    setAnalysisSuccess(null);
    setIsAnalyzing(true);

    try {
      const request = buildPortfolioAnalysisRequest(
        holdings,
        snapshotHash,
        analysisCacheKey,
        selectedCategory,
        selectedModel,
        analysisInstruction,
      );
      const response = (await callPortfolioFunction(
        'analyze',
        request,
      )) as PortfolioAnalysisResponse;

      const cachedResult: CachedPortfolioAnalysis = {
        cacheKey: response.cacheKey,
        snapshotHash: response.snapshotHash,
        category: response.category,
        provider: response.provider,
        model: response.model,
        analysisInstruction: response.analysisInstruction,
        generatedAt: response.generatedAt,
        assetCount: holdings.length,
        answer: response.answer,
      };

      setLocalAnalysis(cachedResult);
      await persistAnalysis(cachedResult);
      const savedSession: Omit<AnalysisSession, 'id' | 'updatedAt' | 'createdAt'> = {
        category: response.category,
        title: createAnalysisTitle(response.analysisInstruction),
        question: response.analysisInstruction,
        result: response.answer,
        model: response.model,
        provider: response.provider,
        snapshotHash: response.snapshotHash,
      };
      await addAnalysisSession(savedSession);
      setAnalysisSuccess('分析已完成，結果已保存。');
    } catch (error) {
      setAnalysisError(
        error instanceof Error ? error.message : '投資組合分析失敗，請稍後再試。',
      );
    } finally {
      setIsAnalyzing(false);
    }
  }

  return (
    <div className="page-stack">
      <section className="hero-panel">
        <div className="analysis-action-panel">
          <div className="analysis-action-copy">
          </div>

          <div className="trends-range-row" role="tablist" aria-label="分析類別">
            {analysisCategoryOptions.map((option) => (
              <button
                key={option.value}
                className={selectedCategory === option.value ? 'filter-chip active' : 'filter-chip'}
                type="button"
                onClick={() => setSelectedCategory(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>

          <div className="asset-form-grid">
            <label className="form-field">
              <span>分析模型</span>
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

            <label className="form-field" style={{ gridColumn: '1 / -1' }}>
              <span>Prompt 設定</span>
              <textarea
                value={analysisInstruction}
                onChange={(event) =>
                  setAnalysisPrompts((current) => ({
                    ...current,
                    [selectedCategory]: event.target.value,
                  }))
                }
                placeholder={selectedCategoryOption.defaultPrompt}
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
              {isAnalyzing
                ? '分析中...'
                : hasAnalysis
                  ? '重新分析我的組合'
                  : '分析我的組合'}
            </button>
            <Link className="button button-secondary" to="/assets">
              檢查資產資料
            </Link>
            <button
              className="button button-secondary"
              type="button"
              onClick={() => setIsPromptSettingsOpen((current) => !current)}
            >
              {isPromptSettingsOpen ? '收起 Prompt 設定' : '設定 Prompt'}
            </button>
          </div>
        </div>
      </section>

      {isPromptSettingsOpen ? (
        <section className="card">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Prompt Settings</p>
              <h2>設定 Prompt</h2>
            </div>
          </div>

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
          </div>

          <div className="asset-form-grid">
            <label className="form-field" style={{ gridColumn: '1 / -1' }}>
              <span>Prompt 內容</span>
              <textarea
                value={analysisInstruction}
                onChange={(event) =>
                  setAnalysisPrompts((current) => ({
                    ...current,
                    [selectedCategory]: event.target.value,
                  }))
                }
                placeholder={selectedCategoryOption.defaultPrompt}
                rows={5}
                disabled={isAnalyzing}
              />
            </label>
          </div>
        </section>
      ) : null}

      {assetsError ? <p className="status-message status-message-error">{assetsError}</p> : null}
      {snapshotHashError ? (
        <p className="status-message status-message-error">{snapshotHashError}</p>
      ) : null}
      {cacheError ? <p className="status-message status-message-error">{cacheError}</p> : null}
      {analysisSessionsError ? (
        <p className="status-message status-message-error">{analysisSessionsError}</p>
      ) : null}
      {analysisError ? (
        <p className="status-message status-message-error">{analysisError}</p>
      ) : null}
      {analysisSuccess ? (
        <p className="status-message status-message-success">{analysisSuccess}</p>
      ) : null}
      {hasCachedAnalysis && !analysisSuccess ? (
        <p className="status-message">
          最近分析：{formatAnalysisTime(cachedAnalysis?.generatedAt ?? '')}
        </p>
      ) : null}
      {assetsStatus === 'loading' ? (
        <p className="status-message">同步中。</p>
      ) : null}
      {isEmpty ? (
        <p className="status-message">未有可分析資產。</p>
      ) : null}

      {hasAnalysis ? (
        <>
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
                  <span>分析類別</span>
                  <strong>{analysisCategoryOptions.find((option) => option.value === displayedAnalysis?.category)?.label ?? '分析資產'}</strong>
                </div>
                <div className="analysis-meta-item">
                <span>提問內容</span>
                <strong>{displayedAnalysis?.analysisInstruction || '未提供'}</strong>
              </div>
              <div className="analysis-meta-item">
                <span>快照資產數</span>
                <strong>{displayedAnalysis?.assetCount ?? holdings.length} 項</strong>
              </div>
              <div className="analysis-meta-item">
                <span>快照識別碼</span>
                <strong className="mono-value">{snapshotHash?.slice(0, 12) ?? ''}</strong>
              </div>
            </div>
          </section>
        </>
      ) : null}

      <section className="card">
        <div className="section-heading">
            <div>
              <p className="eyebrow">History</p>
            <h2>{selectedCategoryOption.label}對話紀錄</h2>
          </div>
        </div>

        <div className="settings-list">
          {categorySessions.length > 0 ? (
            categorySessions.slice(0, 20).map((session) => (
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
                    analysisInstruction: session.question,
                    generatedAt: session.updatedAt,
                    assetCount: holdings.length,
                    answer: session.result,
                  });
                }}
              >
                <div>
                  <strong>{session.title}</strong>
                  <p>{session.question}</p>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <strong>{session.model}</strong>
                  <p>{formatAnalysisTime(session.updatedAt)}</p>
                </div>
              </button>
            ))
          ) : (
            <p className="status-message">未有此分類的對話紀錄。</p>
          )}
        </div>
      </section>
    </div>
  );
}
