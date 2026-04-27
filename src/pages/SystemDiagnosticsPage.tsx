import { useState } from 'react';
import { Link } from 'react-router-dom';

import {
  configuredPortfolioAccessCode,
  hasConfiguredPortfolioAccessCode,
} from '../lib/access/accessCode';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type CheckKey = 'basic' | 'diagnose' | 'diagnoseAi';

interface CheckResult {
  httpStatus: number;
  ok: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any;
  isHtml: boolean;
  networkError?: string;
  durationMs: number;
}

type CheckState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'done'; result: CheckResult };

// ---------------------------------------------------------------------------
// Check runner
// ---------------------------------------------------------------------------

async function runCheck(
  path: string,
  accessCode: string,
  requiresAuth: boolean,
): Promise<CheckResult> {
  const startedAt = Date.now();
  const headers: Record<string, string> = {};
  if (requiresAuth && accessCode) {
    headers['x-portfolio-access-code'] = accessCode;
  }

  try {
    const response = await fetch(path, { headers });
    const text = await response.text();
    const durationMs = Date.now() - startedAt;
    const trimmed = text.trim();

    if (
      trimmed.startsWith('<!') ||
      trimmed.toLowerCase().startsWith('<html')
    ) {
      return { httpStatus: response.status, ok: false, data: null, isHtml: true, durationMs };
    }

    try {
      const data = JSON.parse(text);
      return { httpStatus: response.status, ok: response.ok, data, isHtml: false, durationMs };
    } catch {
      return {
        httpStatus: response.status,
        ok: false,
        data: trimmed.slice(0, 400),
        isHtml: false,
        durationMs,
      };
    }
  } catch (error) {
    return {
      httpStatus: 0,
      ok: false,
      data: null,
      isHtml: false,
      networkError: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - startedAt,
    };
  }
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatusBadge({ ok, httpStatus }: { ok: boolean; httpStatus: number }) {
  const color = ok
    ? 'var(--positive)'
    : httpStatus === 401 || httpStatus === 403
      ? 'var(--accent-amber)'
      : 'var(--danger)';
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '1px 8px',
        borderRadius: 'var(--radius-pill)',
        fontSize: '0.75rem',
        fontWeight: 600,
        background: ok ? 'var(--positive-soft)' : httpStatus === 401 || httpStatus === 403 ? 'var(--caution-soft)' : 'var(--danger-soft)',
        color,
        fontFamily: 'var(--font-mono)',
      }}
    >
      {httpStatus > 0 ? httpStatus : 'ERR'}
    </span>
  );
}

function BoolDot({ value }: { value: boolean }) {
  return (
    <span style={{ color: value ? 'var(--positive)' : 'var(--danger)', fontWeight: 600 }}>
      {value ? '✓' : '✗'}
    </span>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: '0.5rem', padding: '3px 0', alignItems: 'baseline', flexWrap: 'wrap' }}>
      <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem', minWidth: '9rem', flexShrink: 0 }}>
        {label}
      </span>
      <span style={{ fontSize: '0.85rem', fontFamily: 'var(--font-mono)', wordBreak: 'break-all' }}>
        {children}
      </span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: '0.75rem' }}>
      <div
        style={{
          fontSize: '0.72rem',
          fontWeight: 700,
          letterSpacing: '0.06em',
          color: 'var(--text-subtle)',
          textTransform: 'uppercase',
          marginBottom: '0.3rem',
        }}
      >
        {title}
      </div>
      <div
        style={{
          background: 'var(--surface-muted)',
          borderRadius: '0.5rem',
          padding: '0.6rem 0.75rem',
          border: '1px solid var(--border)',
        }}
      >
        {children}
      </div>
    </div>
  );
}

function AiProbes({ probes }: { probes: unknown[] }) {
  if (!Array.isArray(probes) || probes.length === 0) {
    return <span style={{ color: 'var(--text-subtle)', fontSize: '0.82rem' }}>—</span>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
      {probes.map((probe: unknown, i: number) => {
        const p = probe as Record<string, unknown>;
        const ok = Boolean(p.ok);
        return (
          <div
            key={i}
            style={{
              display: 'flex',
              gap: '0.5rem',
              alignItems: 'center',
              flexWrap: 'wrap',
              padding: '4px 0',
              borderBottom: i < probes.length - 1 ? '1px solid var(--border)' : 'none',
            }}
          >
            <BoolDot value={ok} />
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem', color: 'var(--text-main)', minWidth: '14rem' }}>
              {String(p.modelId ?? '—')}
            </span>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              {String(p.provider ?? '')}
            </span>
            {p.httpStatus !== undefined && (
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: ok ? 'var(--positive)' : 'var(--danger)' }}>
                HTTP {String(p.httpStatus)}
              </span>
            )}
            {Boolean(p.detail) && (
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', flex: 1 }}>
                {String(p.detail)}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ResultPanel({ result }: { result: CheckResult }) {
  const [showRaw, setShowRaw] = useState(false);

  if (result.networkError) {
    return (
      <div style={{ color: 'var(--danger)', fontSize: '0.85rem', padding: '0.5rem 0' }}>
        Network error: {result.networkError}
      </div>
    );
  }

  if (result.isHtml) {
    return (
      <div
        style={{
          background: 'var(--caution-soft)',
          border: '1px solid var(--accent-amber)',
          borderRadius: '0.5rem',
          padding: '0.75rem',
          color: 'var(--caution)',
          fontSize: '0.85rem',
        }}
      >
        ⚠️ 可能被 Vercel Deployment Protection 攔截（HTTP {result.httpStatus}）。請確認生產域名或 bypass token 設定。
      </div>
    );
  }

  const d = result.data as Record<string, unknown> | null;

  if (!d) {
    return (
      <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
        空回應（HTTP {result.httpStatus}）
      </div>
    );
  }

  // Simple health response (no mode=diagnose)
  if (!('steps' in d)) {
    return (
      <Section title="回應">
        <Row label="ok">
          <BoolDot value={Boolean(d.ok)} />
        </Row>
        {Boolean(d.message) && <Row label="message">{String(d.message)}</Row>}
        {Boolean(d.version) && <Row label="version">{String(d.version)}</Row>}
        <Row label="durationMs">{result.durationMs}ms</Row>
      </Section>
    );
  }

  // Full diagnose response
  const summary = d.summary as Record<string, unknown> | undefined;
  const cron = d.cronLagAlert as Record<string, unknown> | undefined;
  const steps = d.steps as Record<string, unknown> | undefined;
  const dailyJobStep = steps?.dailyJob as Record<string, unknown> | undefined;
  const dailyJobData = dailyJobStep?.data as Record<string, unknown> | undefined;
  const readiness = dailyJobData?.snapshotReadinessSummary as Record<string, unknown> | null | undefined;
  const ai = d.ai as Record<string, unknown> | undefined;
  const probes = ai?.probes as unknown[] | undefined;

  return (
    <div>
      {/* Header row */}
      <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', marginBottom: '0.5rem', flexWrap: 'wrap' }}>
        <StatusBadge ok={result.ok} httpStatus={result.httpStatus} />
        {summary && (
          <>
            <span style={{ fontSize: '0.82rem', color: 'var(--positive)' }}>✓ {String(summary.passedSteps)} passed</span>
            {Number(summary.failedSteps) > 0 && (
              <span style={{ fontSize: '0.82rem', color: 'var(--danger)' }}>✗ {String(summary.failedSteps)} failed</span>
            )}
          </>
        )}
        <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginLeft: 'auto' }}>
          {result.durationMs}ms
        </span>
      </div>

      {/* Cron lag */}
      {cron && (
        <Section title="Cron 延遲">
          <Row label="isLagging">
            <BoolDot value={!Boolean(cron.isLagging)} />
            {Boolean(cron.isLagging) && (
              <span style={{ color: 'var(--danger)', fontSize: '0.82rem', marginLeft: '0.5rem' }}>
                {String(cron.detail ?? '')}
              </span>
            )}
          </Row>
          <Row label="currentHktTime">{String(cron.currentHktTime ?? '—')}</Row>
          <Row label="jobStatus">{String(cron.jobStatus ?? '—')}</Row>
          <Row label="snapshotStatus">{String(cron.snapshotStatus ?? '—')}</Row>
        </Section>
      )}

      {/* Daily job */}
      {dailyJobData && (
        <Section title="Daily Job">
          <Row label="status">{String(dailyJobData.status ?? '—')}</Row>
          <Row label="snapshotStatus">{String(dailyJobData.snapshotStatus ?? '—')}</Row>
          <Row label="coveragePct">{dailyJobData.coveragePct != null ? `${dailyJobData.coveragePct}%` : '—'}</Row>
          <Row label="appliedCount">{String(dailyJobData.appliedCount ?? '—')}</Row>
          {Boolean(dailyJobData.lastError) && (
            <Row label="lastError">
              <span style={{ color: 'var(--danger)' }}>{String(dailyJobData.lastError)}</span>
            </Row>
          )}
        </Section>
      )}

      {/* Snapshot readiness */}
      {readiness && (
        <Section title="Snapshot Readiness">
          <Row label="isReady"><BoolDot value={Boolean(readiness.isReady)} /></Row>
          <Row label="canUseFallback"><BoolDot value={Boolean(readiness.canUseFallback)} /></Row>
          <Row label="coveragePct">{readiness.coveragePct != null ? `${readiness.coveragePct}%` : '—'}</Row>
          <Row label="staleAssetCount">{String(readiness.staleAssetCount ?? '—')}</Row>
          <Row label="valueWeightedHighRisk"><BoolDot value={Boolean(readiness.valueWeightedHighRisk)} /></Row>
          {readiness.staleValuePct != null && (
            <Row label="staleValuePct">{`${readiness.staleValuePct}%`}</Row>
          )}
          {Boolean(readiness.largestStaleAssetSymbol) && (
            <Row label="largestStale">
              {String(readiness.largestStaleAssetSymbol)}
              {readiness.largestStaleAssetPct != null && ` (${readiness.largestStaleAssetPct}%)`}
            </Row>
          )}
          {Boolean(readiness.valueWeightedGuardUnavailable) && (
            <Row label="guardUnavailable">
              <span style={{ color: 'var(--caution)' }}>⚠ FX rates unavailable</span>
            </Row>
          )}
        </Section>
      )}

      {/* Failed steps detail */}
      {steps && Number(summary?.failedSteps) > 0 && (
        <Section title="失敗步驟">
          {Object.entries(steps).map(([key, step]) => {
            const s = step as Record<string, unknown>;
            if (s.ok) return null;
            return (
              <Row key={key} label={key}>
                <span style={{ color: 'var(--danger)' }}>{String(s.detail ?? '—')}</span>
              </Row>
            );
          })}
        </Section>
      )}

      {/* AI probes */}
      {probes && (
        <Section title="AI Model Probes">
          <AiProbes probes={probes} />
        </Section>
      )}

      {/* Raw toggle */}
      <div style={{ marginTop: '0.75rem' }}>
        <button
          className="button button-subtle button-sm"
          onClick={() => setShowRaw((v) => !v)}
        >
          {showRaw ? '收起' : '顯示完整 JSON'}
        </button>
        {showRaw && (
          <pre
            style={{
              marginTop: '0.5rem',
              fontSize: '0.72rem',
              fontFamily: 'var(--font-mono)',
              background: 'var(--surface-dark)',
              color: '#e2ded9',
              borderRadius: '0.5rem',
              padding: '0.75rem',
              overflowX: 'auto',
              maxHeight: '24rem',
              overflowY: 'auto',
            }}
          >
            {JSON.stringify(result.data, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Check card
// ---------------------------------------------------------------------------

interface CheckCardProps {
  label: string;
  path: string;
  requiresAuth: boolean;
  accessCode: string;
  description: string;
}

function CheckCard({ label, path, requiresAuth, accessCode, description }: CheckCardProps) {
  const [state, setState] = useState<CheckState>({ status: 'idle' });

  async function handleRun() {
    setState({ status: 'loading' });
    const result = await runCheck(path, accessCode, requiresAuth);
    setState({ status: 'done', result });
  }

  return (
    <div
      style={{
        background: 'var(--surface-strong)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-card)',
        padding: '1rem 1.15rem',
        boxShadow: 'var(--shadow-card)',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.75rem', marginBottom: '0.5rem' }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--text-main)' }}>{label}</div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-subtle)', fontFamily: 'var(--font-mono)', marginTop: '2px' }}>{path}</div>
          <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '3px' }}>{description}</div>
        </div>
        <button
          className="button button-secondary button-sm"
          onClick={handleRun}
          disabled={state.status === 'loading'}
          style={{ flexShrink: 0 }}
        >
          {state.status === 'loading' ? '請求中…' : '執行'}
        </button>
      </div>

      {/* Result */}
      {state.status === 'done' && (
        <div style={{ marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid var(--border)' }}>
          <ResultPanel result={state.result} />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

const CHECKS: {
  key: CheckKey;
  label: string;
  path: string;
  requiresAuth: boolean;
  description: string;
}[] = [
  {
    key: 'basic',
    label: '基本健康檢查',
    path: '/api/health',
    requiresAuth: false,
    description: '確認 API 可達，無需驗證。',
  },
  {
    key: 'diagnose',
    label: '完整診斷',
    path: '/api/health?mode=diagnose',
    requiresAuth: true,
    description: '驗證 Firebase、FX、快照狀態、Cron 延遲。需要 access code。',
  },
  {
    key: 'diagnoseAi',
    label: 'AI 模型測試',
    path: '/api/health?mode=diagnose&includeAi=true',
    requiresAuth: true,
    description: '額外測試 5 個 AI 模型可用性（較慢，最多 15s）。',
  },
];

export function SystemDiagnosticsPage() {
  const accessCode = configuredPortfolioAccessCode;
  const hasCode = hasConfiguredPortfolioAccessCode;

  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'var(--page-background)',
        padding: 'clamp(1rem, 4vw, 2rem)',
        fontFamily: 'var(--font-sans)',
        color: 'var(--text-main)',
      }}
    >
      {/* Header */}
      <div style={{ maxWidth: '680px', margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.25rem' }}>
          <Link
            to="/"
            style={{
              fontSize: '0.78rem',
              color: 'var(--text-muted)',
              textDecoration: 'none',
              padding: '3px 8px',
              borderRadius: '4px',
              border: '1px solid var(--border)',
              background: 'var(--surface)',
            }}
          >
            ← 返回
          </Link>
          <h1
            style={{
              margin: 0,
              fontSize: '1.1rem',
              fontWeight: 700,
              color: 'var(--text-main)',
            }}
          >
            系統診斷
          </h1>
        </div>
        <p style={{ margin: '0 0 1.5rem', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
          /system/diagnostics — 僅供開發者使用，不連結至主導覽
        </p>

        {/* Auth warning */}
        {!hasCode && (
          <div
            style={{
              background: 'var(--caution-soft)',
              border: '1px solid var(--accent-amber)',
              borderRadius: '0.5rem',
              padding: '0.75rem',
              marginBottom: '1rem',
              fontSize: '0.85rem',
              color: 'var(--caution)',
            }}
          >
            ⚠ 未設定 VITE_PORTFOLIO_ACCESS_CODE。diagnose 請求將無 access code，可能返回 401。
          </div>
        )}

        {/* Checks */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
          {CHECKS.map((check) => (
            <CheckCard
              key={check.key}
              label={check.label}
              path={check.path}
              requiresAuth={check.requiresAuth}
              accessCode={accessCode}
              description={check.description}
            />
          ))}
        </div>

        {/* Footer note */}
        <p
          style={{
            marginTop: '1.5rem',
            fontSize: '0.72rem',
            color: 'var(--text-subtle)',
            textAlign: 'center',
          }}
        >
          此頁面不記錄任何資料，所有請求均由瀏覽器直接發送至 API。
        </p>
      </div>
    </div>
  );
}
