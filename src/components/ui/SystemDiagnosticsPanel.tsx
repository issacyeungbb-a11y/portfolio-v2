import { useState } from 'react';
import { useSystemDiagnose } from '../../hooks/useSystemDiagnose';
import type { DiagnoseStepResult } from '../../hooks/useSystemDiagnose';

function StepRow({ name, step }: { name: string; step: DiagnoseStepResult }) {
  return (
    <div className={`diagnose-step ${step.ok ? 'diagnose-step-ok' : 'diagnose-step-fail'}`}>
      <span className="diagnose-step-icon">{step.ok ? '✓' : '✗'}</span>
      <span className="diagnose-step-name">{name}</span>
      <span className="diagnose-step-detail">{step.detail}</span>
      <span className="diagnose-step-ms">{step.durationMs}ms</span>
    </div>
  );
}

function formatHKTime(iso: string) {
  try {
    return new Intl.DateTimeFormat('zh-HK', {
      timeZone: 'Asia/Hong_Kong',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

/**
 * P1-2: 系統診斷面板。
 * 需要手動觸發，避免每次載入都消耗 API 配額。
 * 顯示 Yahoo Finance、CoinGecko、Firestore、pending reviews 等狀態。
 */
export function SystemDiagnosticsPanel() {
  const { result, loading, error, lastFetchedAt, run } = useSystemDiagnose();
  const [expanded, setExpanded] = useState(false);

  if (!expanded) {
    return (
      <div className="diagnose-collapsed">
        <button
          className="button button-ghost button-sm"
          type="button"
          onClick={() => setExpanded(true)}
        >
          系統診斷
        </button>
      </div>
    );
  }

  return (
    <div className="diagnose-panel">
      <div className="diagnose-header">
        <span className="diagnose-title">系統診斷</span>
        {lastFetchedAt && (
          <span className="diagnose-timestamp">上次檢查：{formatHKTime(lastFetchedAt)}</span>
        )}
        <div className="diagnose-actions">
          <button
            className="button button-secondary button-sm"
            type="button"
            onClick={run}
            disabled={loading}
          >
            {loading ? '診斷中...' : '執行診斷'}
          </button>
          <button
            className="button button-ghost button-sm"
            type="button"
            onClick={() => setExpanded(false)}
          >
            收起
          </button>
        </div>
      </div>

      {error && (
        <div className="diagnose-error">{error}</div>
      )}

      {result && (
        <div className="diagnose-body">
          <div className={`diagnose-summary ${result.ok ? 'diagnose-summary-ok' : 'diagnose-summary-fail'}`}>
            {result.ok
              ? `所有 ${result.summary.passedSteps} 項診斷通過（${result.durationMs}ms）`
              : `${result.summary.failedSteps} 項診斷失敗 / ${result.summary.passedSteps} 項通過（${result.durationMs}ms）`}
          </div>

          <div className="diagnose-steps">
            <StepRow name="環境變數" step={result.steps.environment} />
            <StepRow name="Firebase Admin" step={result.steps.firebaseAdmin} />
            <StepRow name="Firestore 讀取" step={result.steps.firestoreRead} />
            <StepRow name="資產資料" step={result.steps.assets} />
            <StepRow name="Yahoo Finance" step={result.steps.yahooFinance} />
            <StepRow name="CoinGecko" step={result.steps.coinGecko} />
            <StepRow name="待審核項目" step={result.steps.pendingReviews} />
          </div>

          {/* CoinGecko plan 摘要 */}
          {result.steps.coinGecko.data != null && typeof result.steps.coinGecko.data === 'object' && (
            <div className="diagnose-extra">
              <span>CoinGecko plan：{String((result.steps.coinGecko.data as Record<string, unknown>).plan ?? 'demo')}</span>
            </div>
          )}

          {/* 環境變數缺少清單 */}
          {result.steps.environment.data != null &&
            typeof result.steps.environment.data === 'object' &&
            Array.isArray((result.steps.environment.data as Record<string, unknown>).missing) &&
            ((result.steps.environment.data as Record<string, unknown>).missing as string[]).length > 0 && (
              <div className="diagnose-missing">
                <span>缺少：</span>
                {((result.steps.environment.data as Record<string, unknown>).missing as string[]).join('、')}
              </div>
            )}
        </div>
      )}

      {!result && !loading && !error && (
        <div className="diagnose-empty">點擊「執行診斷」開始檢查系統狀態。</div>
      )}
    </div>
  );
}

