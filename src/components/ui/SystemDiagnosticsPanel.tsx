import { useState } from 'react';
import { useFirestoreUsageEstimate } from '../../hooks/useFirestoreUsageEstimate';
import { useSystemDiagnose } from '../../hooks/useSystemDiagnose';
import type { DiagnoseStepResult, SystemRunEntry, SystemRunsSummary, DailyJobSummary } from '../../hooks/useSystemDiagnose';

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

function SystemRunRow({ run }: { run: SystemRunEntry }) {
  const triggerLabel =
    run.trigger === 'rescue' ? '補救' : run.trigger === 'manual' ? '手動' : '排程';

  return (
    <div className={`diagnose-run-row ${run.ok ? 'diagnose-run-ok' : 'diagnose-run-fail'}`}>
      <span className="diagnose-run-status">{run.ok ? '✓' : '✗'}</span>
      <span className="diagnose-run-trigger">{triggerLabel}</span>
      <span className="diagnose-run-time">{formatHKTime(run.startedAt)}</span>
      <span className="diagnose-run-coverage">{run.coveragePct}%</span>
      <span className="diagnose-run-pending">待審核 {run.pendingCount}</span>
      {run.fxUsingFallback && <span className="diagnose-run-flag">備援匯率</span>}
      {!run.ok && run.errorMessage && (
        <span className="diagnose-run-error">{run.errorMessage}</span>
      )}
    </div>
  );
}

function SystemRunsSection({ data }: { data: unknown }) {
  if (!data || typeof data !== 'object') return null;

  const summary = data as SystemRunsSummary;
  const runs = Array.isArray(summary.runs) ? (summary.runs as SystemRunEntry[]) : [];

  if (runs.length === 0) {
    return <div className="diagnose-runs-empty">尚無執行記錄。</div>;
  }

  return (
    <div className="diagnose-runs">
      <div className="diagnose-runs-header">
        <span className="diagnose-runs-title">最近執行記錄</span>
        {summary.lastScheduledAt && (
          <span className="diagnose-runs-meta">
            上次排程：{formatHKTime(summary.lastScheduledAt)}
          </span>
        )}
        {summary.lastRescueAt && (
          <span className="diagnose-runs-meta">
            上次補救：{formatHKTime(summary.lastRescueAt)}
          </span>
        )}
        {summary.lastFailedAt && (
          <span className="diagnose-runs-meta diagnose-runs-meta-fail">
            上次失敗：{formatHKTime(summary.lastFailedAt)}
          </span>
        )}
      </div>
      {runs.map((run, i) => (
        <SystemRunRow key={i} run={run} />
      ))}
    </div>
  );
}

function DailyJobSection({ data }: { data: unknown }) {
  if (!data || typeof data !== 'object') return null;

  const job = data as DailyJobSummary;
  if (job.status === null) {
    return <div className="diagnose-daily-job-empty">今日（{job.dateKey}）尚無每日任務記錄。</div>;
  }

  const statusLabel: Record<string, string> = {
    running: '執行中',
    update_done: '更新完成，快照待執行',
    completed: '已完成',
    failed: '失敗',
    pending: '等待中',
  };

  const snapshotLabel: Record<string, string> = {
    not_started: '未開始',
    running: '執行中',
    completed: '已完成',
    failed: '失敗',
    skipped: '已跳過',
  };

  const skipReasonLabel: Record<string, string> = {
    snapshot_already_done: '已完成的任務重跑',
    snapshot_already_exists: '當日快照已存在',
    readiness_not_met: '條件未達標',
    fallback_not_allowed: '不符合降級快照條件',
  };

  const triggerLabel: Record<string, string> = {
    scheduled: '排程',
    rescue: '補救',
    manual: '手動',
  };

  const isCompleted = job.status === 'completed';
  const isFailed = job.status === 'failed';

  return (
    <div className={`diagnose-daily-job ${isCompleted ? 'diagnose-daily-job-ok' : isFailed ? 'diagnose-daily-job-fail' : 'diagnose-daily-job-running'}`}>
      <div className="diagnose-daily-job-header">
        <span className="diagnose-daily-job-title">今日任務（{job.dateKey}）</span>
        {job.trigger && (
          <span className="diagnose-daily-job-trigger">{triggerLabel[job.trigger] ?? job.trigger}</span>
        )}
        <span className="diagnose-daily-job-status">{statusLabel[job.status ?? ''] ?? job.status}</span>
      </div>
      <div className="diagnose-daily-job-body">
        <span>資產：{job.processedCount}/{job.totalAssets}</span>
        <span>已更新：{job.appliedCount}</span>
        <span>待審核：{job.pendingReviewCount}</span>
        <span>覆蓋率：{job.coveragePct}%</span>
        {job.failedCount > 0 && <span className="diagnose-daily-job-failed">批次失敗：{job.failedCount}</span>}
        <span>快照：{snapshotLabel[job.snapshotStatus ?? ''] ?? job.snapshotStatus ?? '—'}</span>
        {job.fxUsingFallback && <span className="diagnose-run-flag">備援匯率</span>}
        {job.coinGeckoSyncStatus && job.coinGeckoSyncStatus !== 'ok' && job.coinGeckoSyncStatus !== 'skipped' && (
          <span className="diagnose-run-flag">CoinGecko: {job.coinGeckoSyncStatus}</span>
        )}
      </div>
      {job.snapshotStatus === 'skipped' && job.snapshotSkipReason && (
        <div className="diagnose-daily-job-error">
          快照跳過原因：{skipReasonLabel[job.snapshotSkipReason] ?? job.snapshotSkipReason}
        </div>
      )}
      {job.snapshotReadinessSummary && (
        <div className="diagnose-daily-job-body diagnose-daily-job-body-compact">
          <span>Readiness：{job.snapshotReadinessSummary.coveragePct}%</span>
          <span>Hard pending：{job.snapshotReadinessSummary.hardPendingReviewCount}/{job.snapshotReadinessSummary.hardPendingTolerance}</span>
          <span>Missing：{job.snapshotReadinessSummary.missingAssetCount}</span>
          <span>Fallback：{job.snapshotReadinessSummary.canUseFallback ? '可用' : '不可用'}</span>
        </div>
      )}
      {isFailed && job.lastError && (
        <div className="diagnose-daily-job-error">{job.lastError}</div>
      )}
    </div>
  );
}

function formatQuotaPct(value: number) {
  return `${Math.round(value)}%`;
}

function FirestoreUsageEstimatorSection({ enabled }: { enabled: boolean }) {
  const { result, status, error, refresh } = useFirestoreUsageEstimate(enabled);

  return (
    <div className="diagnose-runs">
      <div className="diagnose-runs-header">
        <span className="diagnose-runs-title">Firestore 用量估算</span>
        <span className="diagnose-runs-meta">按目前預設查詢上限計算</span>
        <button
          className="button button-ghost button-sm"
          type="button"
          onClick={() => void refresh()}
          disabled={status === 'loading' || !enabled}
        >
          {status === 'loading' ? '更新中...' : '更新估算'}
        </button>
      </div>

      {!enabled ? (
        <div className="diagnose-runs-empty">展開面板後會自動計算。</div>
      ) : error ? (
        <div className="diagnose-error">{error}</div>
      ) : result ? (
        <>
          <div className="summary-grid summary-grid-primary">
            <article className="summary-card">
              <p className="summary-label">文件總數</p>
              <strong className="summary-value">{result.totalDocuments}</strong>
              <p className="summary-hint">五個集合合計</p>
            </article>
            <article className="summary-card">
              <p className="summary-label">預估 reads</p>
              <strong className="summary-value">{result.estimatedReads}</strong>
              <p className="summary-hint">單次完整打開</p>
            </article>
            <article className="summary-card">
              <p className="summary-label">reads 配額</p>
              <strong className="summary-value">{formatQuotaPct(result.readQuotaPct)}</strong>
              <p className="summary-hint">以 50,000 / 日計</p>
            </article>
          </div>

          <div className="summary-grid summary-grid-secondary">
            <article className="summary-card">
              <p className="summary-label">預估 writes</p>
              <strong className="summary-value">{result.estimatedWrites}</strong>
              <p className="summary-hint">單次完整打開通常為 0</p>
            </article>
            <article className="summary-card">
              <p className="summary-label">writes 配額</p>
              <strong className="summary-value">{formatQuotaPct(result.writeQuotaPct)}</strong>
              <p className="summary-hint">以 20,000 / 日計</p>
            </article>
          </div>

          <div className="settings-list">
            {result.rows.map((row) => (
              <div key={row.label} className="setting-row setting-row-wide">
                <div>
                  <strong>{row.label}</strong>
                  <p>{row.note}</p>
                </div>
                <span className="chip chip-soft">
                  {row.documentCount} docs · {row.estimatedReadCount} reads
                </span>
              </div>
            ))}
          </div>

          <p className="status-message">
            priceUpdateReviews 已改為只讀取 pending 文件；其餘集合按現有預設上限估算。
          </p>
        </>
      ) : (
        <div className="diagnose-runs-empty">按「更新估算」開始讀取文件數。</div>
      )}
    </div>
  );
}

/**
 * P1-2 / P4: 系統診斷面板。
 * 需要手動觸發，避免每次載入都消耗 API 配額。
 * 顯示 Yahoo Finance、CoinGecko、Firestore、pending reviews、systemRuns 等狀態。
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
            <StepRow name="系統執行記錄" step={result.steps.systemRuns} />
            <StepRow name="今日任務狀態" step={result.steps.dailyJob} />
          </div>

          {/* dailyJob 詳細狀態 */}
          {result.steps.dailyJob.data != null && (
            <DailyJobSection data={result.steps.dailyJob.data} />
          )}

          {/* systemRuns 詳細記錄 */}
          {result.steps.systemRuns.data != null && (
            <SystemRunsSection data={result.steps.systemRuns.data} />
          )}

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

      <FirestoreUsageEstimatorSection enabled={expanded} />

      {!result && !loading && !error && (
        <div className="diagnose-empty">點擊「執行診斷」開始檢查系統狀態。</div>
      )}
    </div>
  );
}
