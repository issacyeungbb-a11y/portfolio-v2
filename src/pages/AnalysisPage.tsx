import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { SummaryCard } from '../components/portfolio/SummaryCard';
import {
  formatCurrencyRounded,
  getHoldingValueInCurrency,
  getPortfolioTotalValue,
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
import type { AnalysisSession, Holding } from '../types/portfolio';
import type {
  CachedPortfolioAnalysis,
  PortfolioAnalysisModel,
  PortfolioAnalysisResponse,
} from '../types/portfolioAnalysis';

type SnapshotHashStatus = 'idle' | 'loading' | 'ready' | 'error';

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

function getAnalysisStatusLabel(
  isAnalyzing: boolean,
  hasAnalysis: boolean,
  assetsStatus: 'idle' | 'loading' | 'ready' | 'error',
) {
  if (isAnalyzing) {
    return '分析中';
  }

  if (hasAnalysis) {
    return '已快取';
  }

  if (assetsStatus === 'loading') {
    return '同步中';
  }

  return '未分析';
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
  const [snapshotHash, setSnapshotHash] = useState<string | null>(null);
  const [snapshotHashStatus, setSnapshotHashStatus] = useState<SnapshotHashStatus>('idle');
  const [analysisCacheKey, setAnalysisCacheKey] = useState<string | null>(null);
  const [analysisCacheKeyStatus, setAnalysisCacheKeyStatus] = useState<SnapshotHashStatus>('idle');
  const [snapshotHashError, setSnapshotHashError] = useState<string | null>(null);
  const [analysisInstruction, setAnalysisInstruction] = useState(
    '根據我目前資產，分析一下而家最值得留意嘅重點。',
  );
  const [selectedModel, setSelectedModel] = useState<PortfolioAnalysisModel>('gemini-3.1-pro-preview');
  const [localAnalysis, setLocalAnalysis] = useState<CachedPortfolioAnalysis | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [analysisSuccess, setAnalysisSuccess] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);

  const holdings: Holding[] = recalculateHoldingAllocations(
    firestoreHoldings,
    (holding) => getHoldingValueInCurrency(holding, mockPortfolio.baseCurrency),
  );
  const snapshotSignature =
    holdings.length > 0 ? createPortfolioSnapshotSignature(holdings) : '';
  const totalValueHKD = getPortfolioTotalValue(holdings, 'HKD');

  useEffect(() => {
    setLocalAnalysis(null);
    setAnalysisError(null);
    setAnalysisSuccess(null);
  }, [snapshotSignature, selectedModel, analysisInstruction]);

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
  }, [snapshotHash, selectedModel, analysisInstruction]);

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
  const hasAnalysis = Boolean(displayedAnalysis);
  const analysisStatusLabel = getAnalysisStatusLabel(
    isAnalyzing,
    hasAnalysis,
    assetsStatus,
  );
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
        <div>
          <p className="eyebrow">AI Analysis</p>
          <h2>投資組合分析</h2>
        </div>

        <div className="analysis-action-panel">
          <div className="analysis-action-copy">
            <span className="chip chip-soft">目前資產 {holdings.length} 項</span>
            <span className={displayedAnalysis?.model ? 'chip chip-strong' : 'chip chip-soft'}>
              模型 {displayedAnalysis?.model ?? selectedModel}
            </span>
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
              <span>分析指示</span>
              <textarea
                value={analysisInstruction}
                onChange={(event) => setAnalysisInstruction(event.target.value)}
                placeholder="例如：重點分析本金損益、持倉是否過度集中、下一步可減倉或加倉方向。"
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
          </div>
        </div>
      </section>

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

      <section className="summary-grid">
        <SummaryCard
          label="分析狀態"
          value={analysisStatusLabel}
          hint={
            snapshotHashStatus === 'ready' && analysisCacheKeyStatus === 'ready'
              ? '資產快照已準備好，可直接呼叫 /api/analyze'
              : snapshotHashStatus === 'loading' || analysisCacheKeyStatus === 'loading'
                ? '正在建立目前資產快照'
                : '等待資產資料完成同步'
          }
        />
        <SummaryCard
          label="目前資產"
          value={`${holdings.length} 項`}
          hint={`總值 ${formatCurrencyRounded(totalValueHKD, 'HKD')}`}
        />
        <SummaryCard
          label="最近分析"
          value={hasAnalysis ? formatAnalysisTime(displayedAnalysis?.generatedAt ?? '') : '尚未分析'}
          hint={
            hasAnalysis
              ? `模型 ${displayedAnalysis?.model ?? ''}`
              : '每次完成分析後都會自動保存到分析紀錄'
          }
        />
      </section>

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
      ) : (
        <section className="card analysis-empty-state">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Ready</p>
              <h2>等你開始第一次分析</h2>
            </div>
          </div>
          <p className="status-message">準備好後直接開始分析。</p>
        </section>
      )}

      <section className="card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">History</p>
            <h2>分析紀錄</h2>
          </div>
        </div>

        <div className="settings-list">
          {analysisSessions.length > 0 ? (
            analysisSessions.slice(0, 20).map((session) => (
              <button
                key={session.id}
                type="button"
                className={selectedSessionId === session.id ? 'setting-row active' : 'setting-row'}
                onClick={() => {
                  setSelectedSessionId(session.id);
                  setLocalAnalysis({
                    cacheKey: session.id,
                    snapshotHash: session.snapshotHash ?? '',
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
            <p className="status-message">未有分析紀錄。</p>
          )}
        </div>
      </section>
    </div>
  );
}
