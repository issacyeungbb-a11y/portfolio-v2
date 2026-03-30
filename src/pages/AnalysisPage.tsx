import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { SummaryCard } from '../components/portfolio/SummaryCard';
import {
  formatCurrency,
  getHoldingValueInCurrency,
  getPortfolioTotalValue,
  mockPortfolio,
} from '../data/mockPortfolio';
import { useAnalysisCache } from '../hooks/useAnalysisCache';
import { usePortfolioAssets } from '../hooks/usePortfolioAssets';
import { callPortfolioFunction } from '../lib/api/vercelFunctions';
import { recalculateHoldingAllocations } from '../lib/firebase/assets';
import {
  buildPortfolioAnalysisRequest,
  createPortfolioSnapshotHash,
  createPortfolioSnapshotSignature,
} from '../lib/portfolio/analysisSnapshot';
import type { Holding } from '../types/portfolio';
import type {
  CachedPortfolioAnalysis,
  PortfolioAnalysisResponse,
} from '../types/portfolioAnalysis';

type SnapshotHashStatus = 'idle' | 'loading' | 'ready' | 'error';

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

function AnalysisListCard({
  eyebrow,
  title,
  items,
}: {
  eyebrow: string;
  title: string;
  items: string[];
}) {
  return (
    <article className="card analysis-result-card">
      <div className="section-heading">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h2>{title}</h2>
        </div>
      </div>

      <ul className="analysis-bullet-list">
        {items.map((item, index) => (
          <li key={`${title}-${index}`}>{item}</li>
        ))}
      </ul>
    </article>
  );
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
  const [snapshotHashError, setSnapshotHashError] = useState<string | null>(null);
  const [localAnalysis, setLocalAnalysis] = useState<CachedPortfolioAnalysis | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [analysisSuccess, setAnalysisSuccess] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

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
  }, [snapshotSignature]);

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
    analysis: cachedAnalysis,
    error: cacheError,
    hasCachedAnalysis,
    persistAnalysis,
  } = useAnalysisCache(snapshotHash);

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
    !isAnalyzing;

  async function handleAnalyzePortfolio() {
    if (!snapshotHash || holdings.length === 0) {
      setAnalysisError('目前沒有完整的資產快照可供分析。');
      return;
    }

    setAnalysisError(null);
    setAnalysisSuccess(null);
    setIsAnalyzing(true);

    try {
      const request = buildPortfolioAnalysisRequest(holdings, snapshotHash);
      const response = (await callPortfolioFunction(
        'analyze',
        request,
      )) as PortfolioAnalysisResponse;

      const cachedResult: CachedPortfolioAnalysis = {
        snapshotHash: response.snapshotHash,
        model: response.model,
        generatedAt: response.generatedAt,
        assetCount: holdings.length,
        summary: response.summary,
        topRisks: response.topRisks,
        allocationInsights: response.allocationInsights,
        currencyExposure: response.currencyExposure,
        nextQuestions: response.nextQuestions,
      };

      setLocalAnalysis(cachedResult);
      await persistAnalysis(cachedResult);
      setAnalysisSuccess('分析已完成，結果亦已快取到 Firestore。');
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
          <p className="hero-copy">
            這一頁會直接帶入目前 Firestore 的資產、最新價格、分類和成本資料。當資產快照未變時，會優先顯示最近一次已快取分析。
          </p>
        </div>

        <div className="analysis-action-panel">
          <div className="analysis-action-copy">
            <span className="chip chip-soft">目前資產 {holdings.length} 項</span>
            <p>
              分析只根據目前持倉與最新價格，不會假設歷史報酬或額外市場新聞，所以結果會較穩定、亦較適合之後逐步擴充。
            </p>
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
      {analysisError ? (
        <p className="status-message status-message-error">{analysisError}</p>
      ) : null}
      {analysisSuccess ? (
        <p className="status-message status-message-success">{analysisSuccess}</p>
      ) : null}
      {hasCachedAnalysis && !analysisSuccess ? (
        <p className="status-message">
          資產快照未變，優先顯示最近一次分析：{formatAnalysisTime(cachedAnalysis?.generatedAt ?? '')}
        </p>
      ) : null}
      {assetsStatus === 'loading' ? (
        <p className="status-message">正在同步 Firestore 資產資料，完成後就可以開始分析。</p>
      ) : null}
      {isEmpty ? (
        <p className="status-message">
          目前仲未有可分析資產，請先去資產管理頁新增至少一筆持倉。
        </p>
      ) : null}

      <section className="summary-grid">
        <SummaryCard
          label="分析狀態"
          value={analysisStatusLabel}
          hint={
            snapshotHashStatus === 'ready'
              ? '資產快照已準備好，可直接呼叫 /api/analyze'
              : snapshotHashStatus === 'loading'
                ? '正在建立目前資產快照'
                : '等待資產資料完成同步'
          }
        />
        <SummaryCard
          label="目前資產"
          value={`${holdings.length} 項`}
          hint={`總值 ${formatCurrency(totalValueHKD, 'HKD')}`}
        />
        <SummaryCard
          label="最近分析"
          value={hasAnalysis ? formatAnalysisTime(displayedAnalysis?.generatedAt ?? '') : '尚未分析'}
          hint={
            hasAnalysis
              ? `模型 ${displayedAnalysis?.model ?? ''}`
              : '當資產未變時會優先顯示最近一次快取分析'
          }
        />
      </section>

      {hasAnalysis ? (
        <>
          <section className="card">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Summary</p>
                <h2>組合摘要</h2>
              </div>
              <span className="chip chip-strong">{displayedAnalysis?.model}</span>
            </div>

            <p className="analysis-summary-text">{displayedAnalysis?.summary}</p>

            <div className="analysis-meta-grid">
              <div className="analysis-meta-item">
                <span>分析時間</span>
                <strong>{formatAnalysisTime(displayedAnalysis?.generatedAt ?? '')}</strong>
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

          <section className="analysis-result-grid">
            <AnalysisListCard
              eyebrow="Risks"
              title="主要風險"
              items={displayedAnalysis?.topRisks ?? []}
            />
            <AnalysisListCard
              eyebrow="Allocation"
              title="配置觀察"
              items={displayedAnalysis?.allocationInsights ?? []}
            />
            <AnalysisListCard
              eyebrow="Currency"
              title="貨幣曝險"
              items={displayedAnalysis?.currencyExposure ?? []}
            />
            <AnalysisListCard
              eyebrow="Next Questions"
              title="下一步可問"
              items={displayedAnalysis?.nextQuestions ?? []}
            />
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

          <div className="roadmap-list">
            <div className="roadmap-item">
              <strong>會帶入哪些資料</strong>
              <p>目前持倉、最新價格、資產類別、帳戶來源、數量、平均成本。</p>
            </div>
            <div className="roadmap-item">
              <strong>結果會回傳什麼</strong>
              <p>組合摘要、主要風險、配置觀察、貨幣曝險，以及下一步值得追問的問題。</p>
            </div>
            <div className="roadmap-item">
              <strong>快取規則</strong>
              <p>如果資產未變，就直接顯示最近一次分析；資產一改，系統就會建立新的快照再分析。</p>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
