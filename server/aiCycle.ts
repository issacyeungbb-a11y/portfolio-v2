// 人工智能週期頁面的伺服器流程：讀取每週訊號檔、儲存、配對持倉、呼叫模型分析。
// 此功能獨立運作：不參與每日排程、快照、月報或季報。

import { AI_CYCLE_BASELINE_SIGNAL } from './aiCycleBaseline.js';
import {
  AI_CYCLE_ANALYSIS_SYSTEM_PROMPT,
  AI_LAYER_OPTIONS,
  SIGNAL_OVERDUE_DAYS,
  buildAiCycleAnalysisPrompt,
  buildAiCycleGuidance,
  computeAiExposure,
  isNewerSignal,
  normalizeAiSymbol,
  parseAiCycleSignal,
  parseAiCycleWeeklyRuns,
  sanitizeOverrides,
  signalAgeDays,
  type AiCycleHoldingInput,
} from './aiCycleCore.js';
import type {
  AiCycleAnalysis,
  AiCycleMeta,
  AiCycleResponse,
  AiCycleSignal,
  AiCycleWeeklyRun,
  AiLayerCode,
} from '../src/types/aiCycle';

const DEFAULT_REPOSITORY = 'issacyeungbb-a11y/ai-cycle-monitor';
const DEFAULT_REF = 'signal-data';
const FETCH_TIMEOUT_MS = 8_000;
const MAX_SIGNAL_BYTES = 1_000_000;
// 訊號每週才更新一次；每六小時最多嘗試讀取一次，失敗亦不會連續重試。
const REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000;
const ANALYSIS_TIMEOUT_MS = 100_000;
const ANALYSIS_MAX_TOKENS = 2_500;
const LAYER_CODES = new Set<string>(AI_LAYER_OPTIONS.map((option) => option.code));

export class AiCycleError extends Error {
  status: number;

  constructor(message: string, status = 500) {
    super(message);
    this.name = 'AiCycleError';
    this.status = status;
  }
}

type StoredDocument = Record<string, unknown> | undefined;

export interface AiCycleStore {
  read(id: 'latest' | 'settings' | 'analysis'): Promise<StoredDocument>;
  write(id: 'latest' | 'settings' | 'analysis', data: Record<string, unknown>): Promise<void>;
}

export interface AiCycleDependencies {
  store: AiCycleStore;
  readHoldings: () => Promise<AiCycleHoldingInput[]>;
  readFxRates: () => Promise<Record<string, number> | null>;
  fetchImpl: typeof fetch;
  analyze: (systemPrompt: string, userPrompt: string) => Promise<{ text: string; model: string }>;
  now: () => Date;
  env: Record<string, string | undefined>;
}

function signalFileUrl(env: AiCycleDependencies['env'], file: string) {
  const repository = env.AI_CYCLE_SIGNAL_REPO?.trim() || DEFAULT_REPOSITORY;
  const ref = env.AI_CYCLE_SIGNAL_REF?.trim() || DEFAULT_REF;
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository) || !/^[\w./-]+$/.test(ref)) {
    throw new AiCycleError('訊號檔來源設定無效，請檢查 AI_CYCLE_SIGNAL_REPO 及 AI_CYCLE_SIGNAL_REF。', 500);
  }
  return `https://api.github.com/repos/${repository}/contents/${file}?ref=${encodeURIComponent(ref)}`;
}

async function fetchSignalFile(deps: AiCycleDependencies, file: string) {
  const token = deps.env.AI_CYCLE_SIGNAL_TOKEN?.trim();
  const response = await deps.fetchImpl(signalFileUrl(deps.env, file), {
    headers: {
      Accept: 'application/vnd.github.raw+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'portfolio-ai-cycle-reader',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    const hint = response.status === 404 || response.status === 401 || response.status === 403
      ? token
        ? '請確認權杖有權讀取監察倉庫的內容，而且每週工作已經建立 signal-data 分支。'
        : '監察倉庫屬私有，須先設定 AI_CYCLE_SIGNAL_TOKEN（只限讀取該倉庫內容的權杖）。'
      : '請稍後再試。';
    throw new AiCycleError(`讀取 ${file} 失敗（HTTP ${response.status}）。${hint}`, 502);
  }
  const text = await response.text();
  if (text.length > MAX_SIGNAL_BYTES) throw new AiCycleError(`${file} 過大，已拒絕讀取。`, 502);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new AiCycleError(`${file} 不是有效的 JSON。`, 502);
  }
}

interface LatestState {
  signal: AiCycleSignal | null;
  weeklyRuns: AiCycleWeeklyRun[];
  fetchedAt: string | null;
  lastFetchAttemptAt: string | null;
  lastFetchError: string | null;
}

function readLatestState(document: StoredDocument): LatestState {
  let signal: AiCycleSignal | null = null;
  let weeklyRuns: AiCycleWeeklyRun[] = [];
  try {
    if (typeof document?.signalJson === 'string') signal = parseAiCycleSignal(JSON.parse(document.signalJson));
  } catch {
    signal = null; // 已儲存的內容損壞時當作沒有，改用內置基準或重新讀取。
  }
  try {
    if (typeof document?.weeklyRunsJson === 'string') weeklyRuns = parseAiCycleWeeklyRuns(JSON.parse(document.weeklyRunsJson));
  } catch {
    weeklyRuns = [];
  }
  return {
    signal, weeklyRuns,
    fetchedAt: typeof document?.fetchedAt === 'string' ? document.fetchedAt : null,
    lastFetchAttemptAt: typeof document?.lastFetchAttemptAt === 'string' ? document.lastFetchAttemptAt : null,
    lastFetchError: typeof document?.lastFetchError === 'string' ? document.lastFetchError : null,
  };
}

/** 讀取每週訊號檔並儲存。失敗時保留已儲存的訊號，只記錄錯誤。 */
async function refreshSignal(deps: AiCycleDependencies, state: LatestState): Promise<LatestState> {
  const attemptedAt = deps.now().toISOString();
  try {
    const signal = parseAiCycleSignal(await fetchSignalFile(deps, 'signal.json'));
    if (!isNewerSignal(signal, state.signal)) {
      throw new AiCycleError('讀到的訊號檔比已儲存的更舊，已拒絕採用。', 502);
    }
    let weeklyRuns = state.weeklyRuns;
    try {
      weeklyRuns = parseAiCycleWeeklyRuns(await fetchSignalFile(deps, 'signal_history.json'));
    } catch {
      // 每週紀錄只供趨勢顯示，讀不到不影響主訊號。
    }
    const next: LatestState = { signal, weeklyRuns, fetchedAt: attemptedAt, lastFetchAttemptAt: attemptedAt, lastFetchError: null };
    await deps.store.write('latest', {
      signalJson: JSON.stringify(signal), weeklyRunsJson: JSON.stringify({ runs: weeklyRuns }),
      signalAsOf: signal.as_of_date, fetchedAt: attemptedAt, lastFetchAttemptAt: attemptedAt, lastFetchError: null,
    });
    return next;
  } catch (error) {
    const message = error instanceof Error ? error.message : '讀取訊號檔失敗。';
    await deps.store.write('latest', { lastFetchAttemptAt: attemptedAt, lastFetchError: message }).catch(() => undefined);
    return { ...state, lastFetchAttemptAt: attemptedAt, lastFetchError: message };
  }
}

function readAnalysis(document: StoredDocument): AiCycleAnalysis | null {
  if (!document || typeof document.text !== 'string' || !document.text.trim()) return null;
  return {
    text: document.text,
    model: typeof document.model === 'string' ? document.model : '',
    generatedAt: typeof document.generatedAt === 'string' ? document.generatedAt : '',
    signalAsOf: typeof document.signalAsOf === 'string' ? document.signalAsOf : '',
    question: typeof document.question === 'string' ? document.question : '',
  };
}

async function buildResponse(deps: AiCycleDependencies, state: LatestState, refreshed: boolean): Promise<AiCycleResponse> {
  const [settings, analysisDocument, holdings, fxRates] = await Promise.all([
    deps.store.read('settings'), deps.store.read('analysis'), deps.readHoldings(), deps.readFxRates(),
  ]);
  const overrides = sanitizeOverrides(settings?.overrides);
  const signal = state.signal ?? AI_CYCLE_BASELINE_SIGNAL;
  const exposure = computeAiExposure(holdings, overrides, fxRates ?? undefined);
  const age = signalAgeDays(signal, deps.now());
  const meta: AiCycleMeta = {
    source: !state.signal ? 'baseline' : refreshed && !state.lastFetchError ? 'live' : 'stored',
    fetchedAt: state.signal ? state.fetchedAt : null,
    signalAgeDays: age,
    overdue: age > SIGNAL_OVERDUE_DAYS,
    tokenConfigured: Boolean(deps.env.AI_CYCLE_SIGNAL_TOKEN?.trim()),
    lastFetchError: state.lastFetchError,
  };
  return {
    ok: true, signal, weeklyRuns: state.weeklyRuns, meta, exposure,
    guidance: buildAiCycleGuidance(signal, exposure), overrides,
    layerOptions: AI_LAYER_OPTIONS, analysis: readAnalysis(analysisDocument),
  };
}

function shouldRefresh(state: LatestState, now: Date) {
  if (!state.lastFetchAttemptAt) return true;
  const last = Date.parse(state.lastFetchAttemptAt);
  return Number.isNaN(last) || now.getTime() - last >= REFRESH_INTERVAL_MS;
}

export async function runAiCycle(body: unknown, deps: AiCycleDependencies): Promise<AiCycleResponse> {
  const payload = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const action = typeof payload.action === 'string' ? payload.action : 'read';
  let state = readLatestState(await deps.store.read('latest'));
  let refreshed = false;

  if (action === 'read' || action === 'refresh') {
    if (action === 'refresh' || shouldRefresh(state, deps.now())) {
      state = await refreshSignal(deps, state);
      refreshed = true;
    }
    return buildResponse(deps, state, refreshed);
  }

  if (action === 'classify') {
    const symbol = normalizeAiSymbol(typeof payload.symbol === 'string' ? payload.symbol : '');
    const layer = typeof payload.layer === 'string' ? payload.layer : '';
    if (!symbol || symbol.length > 24) throw new AiCycleError('缺少有效的持倉代號。', 400);
    if (layer !== 'default' && !LAYER_CODES.has(layer)) throw new AiCycleError('分類無效。', 400);
    const overrides = sanitizeOverrides((await deps.store.read('settings'))?.overrides);
    if (layer === 'default') delete overrides[symbol];
    else overrides[symbol] = layer as AiLayerCode;
    await deps.store.write('settings', { overrides, updatedAt: deps.now().toISOString() });
    return buildResponse(deps, state, false);
  }

  if (action === 'analyze') {
    const question = typeof payload.question === 'string' ? payload.question.trim().slice(0, 500) : '';
    const current = await buildResponse(deps, state, false);
    const result = await deps.analyze(
      AI_CYCLE_ANALYSIS_SYSTEM_PROMPT,
      buildAiCycleAnalysisPrompt(current.signal, current.exposure, current.guidance, question),
    );
    if (!result.text.trim()) throw new AiCycleError('模型未有回傳分析內容。', 502);
    const analysis: AiCycleAnalysis = {
      text: result.text.trim(), model: result.model, generatedAt: deps.now().toISOString(),
      signalAsOf: current.signal.as_of_date, question,
    };
    await deps.store.write('analysis', { ...analysis });
    return { ...current, analysis };
  }

  throw new AiCycleError('不支援的操作。', 400);
}

export function aiCycleErrorResponse(error: unknown) {
  const status = error instanceof AiCycleError
    ? error.status
    : typeof (error as { status?: unknown })?.status === 'number'
      ? (error as { status: number }).status
      : 500;
  return {
    status: status >= 400 && status < 600 ? status : 500,
    body: { ok: false, route: '/api/health', mode: 'ai-cycle', message: error instanceof Error ? error.message : '人工智能週期資料處理失敗。' },
  };
}

/** 正式環境的依賴：資料庫、匯率及模型。按需載入，避免拖慢其他端點。 */
export async function createAiCycleDependencies(readHoldings: AiCycleDependencies['readHoldings']): Promise<AiCycleDependencies> {
  const { getSharedPortfolioDocRef } = await import('./firebaseAdmin.js');
  const collection = getSharedPortfolioDocRef().collection('aiCycle');
  return {
    store: {
      read: async (id) => (await collection.doc(id).get()).data(),
      write: async (id, data) => { await collection.doc(id).set(data, { merge: true }); },
    },
    readHoldings,
    readFxRates: async () => {
      const { readPersistedFxRates } = await import('./portfolioSnapshotAdmin.js');
      const rates = await readPersistedFxRates(7 * 24 * 60 * 60 * 1000);
      return rates ? { ...rates } : null;
    },
    fetchImpl: fetch,
    analyze: async (systemPrompt, userPrompt) => {
      const [{ analyzeWithClaude }, { CLAUDE_ANALYZE_MODEL }] = await Promise.all([
        import('./analyzePortfolio.js'), import('./analysisModels.js'),
      ]);
      const model = CLAUDE_ANALYZE_MODEL as 'claude-opus-5-5';
      return { text: await analyzeWithClaude(systemPrompt, userPrompt, model, ANALYSIS_MAX_TOKENS, ANALYSIS_TIMEOUT_MS), model };
    },
    now: () => new Date(),
    env: process.env,
  };
}
