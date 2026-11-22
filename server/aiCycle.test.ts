import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';

import { AiCycleError, runAiCycle, type AiCycleDependencies } from './aiCycle.js';
import { AI_CYCLE_BASELINE_SIGNAL } from './aiCycleBaseline.js';
import {
  buildAiCycleAnalysisPrompt,
  buildAiCycleGuidance,
  classifyAiHolding,
  computeAiExposure,
  describeFormalIndexStatus,
  normalizeAiSymbol,
  parseAiCycleSignal,
  parseAiCycleWeeklyRuns,
  sanitizeOverrides,
  signalAgeDays,
} from './aiCycleCore.js';
import type { AiCycleSignal } from '../src/types/aiCycle.ts';

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function signalWith(level: number | null, extra: (signal: AiCycleSignal) => void = () => undefined) {
  const signal = clone(AI_CYCLE_BASELINE_SIGNAL);
  signal.stance.level = level;
  signal.freshness.stale = false;
  signal.stance.confidence = 'MEDIUM';
  extra(signal);
  return signal;
}

const holding = (symbol: string, marketValue: number, more: Partial<{ currency: string; assetType: string; name: string }> = {}) => ({
  id: symbol, symbol, name: more.name ?? symbol, assetType: more.assetType ?? 'stock', accountSource: 'Futu',
  currency: more.currency ?? 'USD', marketValue,
});

test('symbols from different brokers normalise to one key per listing', () => {
  assert.equal(normalizeAiSymbol(' nvda '), 'NVDA');
  assert.equal(normalizeAiSymbol('US.NVDA'), 'NVDA');
  assert.equal(normalizeAiSymbol('NASDAQ:NVDA'), 'NVDA');
  assert.equal(normalizeAiSymbol('NVDA.US'), 'NVDA');
  assert.equal(normalizeAiSymbol('HK.00700'), '0700.HK');
  assert.equal(normalizeAiSymbol('700', 'HKD'), '0700.HK');
  assert.equal(normalizeAiSymbol('09988'), '9988.HK');
  assert.equal(normalizeAiSymbol('9988.HK'), '9988.HK');
  // 純數字代號日股同樣使用：靠幣別分辨，不可誤當港股。
  assert.equal(normalizeAiSymbol('7203', 'JPY'), '7203.T');
  assert.equal(normalizeAiSymbol('7203.T'), '7203.T');
  assert.equal(normalizeAiSymbol(''), '');
});

test('classification uses the default table, lets overrides win and never guesses', () => {
  assert.deepEqual(classifyAiHolding('US.NVDA'), { layer: 'semiconductor', classifiedBy: 'default' });
  assert.deepEqual(classifyAiHolding('00700', {}, 'HKD'), { layer: 'application', classifiedBy: 'default' });
  assert.deepEqual(classifyAiHolding('KO'), { layer: 'none', classifiedBy: 'unclassified' });
  assert.deepEqual(classifyAiHolding('NVDA', { NVDA: 'none' }), { layer: 'none', classifiedBy: 'override' });
  assert.deepEqual(classifyAiHolding('KO', { KO: 'other' }), { layer: 'other', classifiedBy: 'override' });
  assert.deepEqual(classifyAiHolding('0700', {}, 'JPY'), { layer: 'none', classifiedBy: 'unclassified' });
  assert.deepEqual(sanitizeOverrides({ ' nvda ': 'cloud', KO: 'made-up', '0700.HK': 'none', '': 'cloud' }), { NVDA: 'cloud', '0700.HK': 'none' });
  assert.deepEqual(sanitizeOverrides(null), {});
});

test('exposure converts to one currency and reconciles to the portfolio total', () => {
  const rates = { HKD: 1, USD: 8, JPY: 0.05 };
  const exposure = computeAiExposure([
    holding('NVDA', 1000), holding('MSFT', 500), holding('0700', 4000, { currency: 'HKD' }),
    holding('KO', 250), holding('7203', 100000, { currency: 'JPY' }), holding('USD', 1000, { assetType: 'cash' }),
    holding('BTC', 500, { assetType: 'crypto' }),
  ], {}, rates);
  assert.equal(exposure.totalValueHKD, 8000 + 4000 + 4000 + 2000 + 5000 + 8000 + 4000);
  assert.equal(exposure.aiValueHKD, 16000);
  assert.equal(exposure.aiShare, 16000 / 35000);
  assert.deepEqual(exposure.holdings.map((row) => row.symbol), ['NVDA', 'MSFT', '0700.HK']);
  assert.equal(exposure.layers.reduce((sum, layer) => sum + layer.valueHKD, 0), exposure.aiValueHKD);
  assert.equal(Math.round(exposure.layers.reduce((sum, layer) => sum + layer.shareOfAi, 0) * 1e9), 1e9);
  assert.equal(exposure.monitoredCount, 2);
  assert.equal(exposure.unmonitoredCount, 1);
  // 現金與加密貨幣不會被列為候選，只有未分類的股票及基金。
  assert.deepEqual(exposure.candidates.map((row) => row.symbol), ['7203.T', 'KO']);
  assert.equal(exposure.fxSource, 'persisted');
  assert.equal(computeAiExposure([holding('NVDA', 10)]).fxSource, 'default');
  const empty = computeAiExposure([]);
  assert.equal(empty.aiShare, 0);
  assert.equal(empty.totalValueHKD, 0);
});

test('guidance combines the sector stance with the actual exposure', () => {
  const light = computeAiExposure([holding('MSFT', 50), holding('AMZN', 40), holding('KO', 910)]);
  const heavy = computeAiExposure([holding('MSFT', 250), holding('AMZN', 200), holding('KO', 550)]);
  const first = (level: number | null, exposure = light) => buildAiCycleGuidance(signalWith(level), exposure)[0];
  assert.equal(first(1).tone, 'positive');
  assert.match(first(1).text, /9\.0%/);
  assert.equal(first(1, heavy).title, '訊號偏向加碼，但佔比已高度集中');
  assert.equal(first(0).title, '訊號中性');
  assert.equal(first(0, heavy).title, '訊號中性，但佔比已高度集中');
  assert.equal(first(-1).title, '訊號偏向減碼');
  assert.equal(first(-1, heavy).title, '訊號偏向減碼，而佔比偏高');
  assert.equal(first(-2).tone, 'caution');
  assert.equal(first(-2, heavy).tone, 'danger');
  assert.equal(first(null).title, '暫無加減碼傾向');
  assert.equal(buildAiCycleGuidance(signalWith(1), computeAiExposure([holding('KO', 100)]))[0].title, '未有人工智能相關持倉');
});

test('guidance flags concentration, unmonitored holdings and weak data', () => {
  const exposure = computeAiExposure([holding('NVDA', 300), holding('TSM', 100), holding('KO', 600)]);
  const titles = (signal: AiCycleSignal) => buildAiCycleGuidance(signal, exposure).map((item) => item.title);
  const fresh = titles(signalWith(0));
  assert.ok(fresh.includes('單一持倉比重偏高'));
  assert.ok(fresh.includes('集中在價值鏈的單一環節'));
  assert.ok(fresh.includes('部分持倉不在監察範圍'));
  assert.ok(!fresh.includes('基本面數據已過期'));
  assert.ok(titles(signalWith(0, (signal) => { signal.freshness.stale = true; })).includes('基本面數據已過期'));
  assert.ok(titles(signalWith(0, (signal) => { signal.stance.confidence = 'LOW'; })).includes('本次信心屬低'));
});

test('the bundled baseline is a valid, clearly dated signal', () => {
  const signal = parseAiCycleSignal(clone(AI_CYCLE_BASELINE_SIGNAL));
  assert.equal(signal.schema_version, 1);
  assert.match(signal.as_of_date, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(signal.ami.formal_score, null);
  assert.equal(signalAgeDays(signal, new Date(`${signal.as_of_date}T12:00:00Z`)), 0);
  assert.equal(signalAgeDays(signal, new Date(Date.parse(`${signal.as_of_date}T00:00:00Z`) + 15 * 86_400_000)), 15);
});

test('a malformed signal is rejected as a whole', () => {
  const cases: Array<[string, (signal: any) => void]> = [
    ['版本', (signal) => { signal.schema_version = 2; }],
    ['讀數日期', (signal) => { signal.as_of_date = '14/11/2026'; }],
    ['分數無效', (signal) => { signal.abri.score = 140; }],
    ['已覆蓋權重', (signal) => { signal.ami.weight_covered = 1.4; }],
    ['加減碼級別', (signal) => { signal.stance.level = 3; }],
    ['缺少暫定分數', (signal) => { signal.ami.score = null; }],
    ['信心級別', (signal) => { signal.stance.confidence = 'CERTAIN'; }],
    ['每週脈搏', (signal) => { signal.pulse.status = 'FINE'; }],
    ['新鮮度', (signal) => { delete signal.freshness; }],
  ];
  for (const [expected, mutate] of cases) {
    const signal = clone(AI_CYCLE_BASELINE_SIGNAL);
    mutate(signal);
    assert.throws(() => parseAiCycleSignal(signal), new RegExp(expected), expected);
  }
  assert.throws(() => parseAiCycleSignal('not json'), /資料物件/);
});

test('the analysis prompt carries the reading, its limits and the holdings', () => {
  const signal = signalWith(0, (value) => { value.freshness.stale = true; });
  const exposure = computeAiExposure([holding('NVDA', 300), holding('KO', 700)]);
  const prompt = buildAiCycleAnalysisPrompt(signal, exposure, buildAiCycleGuidance(signal, exposure), '應否加碼？');
  assert.match(prompt, /"人工智能佔總資產": 0\.3/);
  assert.match(prompt, /"已過期": true/);
  assert.match(prompt, /正式分數均尚未發布/);
  assert.match(prompt, /我另外想知道：應否加碼？/);
  assert.match(prompt, /NVDA/);
  assert.doesNotMatch(prompt, /KO/);
});

function harness(overrides: Partial<AiCycleDependencies> = {}) {
  const documents = new Map<string, Record<string, unknown>>();
  const requests: Array<{ url: string; headers: Record<string, string> }> = [];
  let now = new Date('2026-11-21T02:00:00Z');
  const live = clone(AI_CYCLE_BASELINE_SIGNAL);
  live.as_of_date = '2026-11-21';
  live.generated_at = '2026-11-21T01:20:00+00:00';
  const files: Record<string, unknown> = {
    'signal.json': live,
    'signal_history.json': { runs: [{ as_of_date: '2026-11-14', stance_code: 'HOLD' }, { as_of_date: '2026-11-21', stance_code: 'HOLD' }] },
  };
  const deps: AiCycleDependencies = {
    store: {
      read: async (id) => documents.get(id),
      write: async (id, data) => { documents.set(id, { ...documents.get(id), ...data }); },
    },
    readHoldings: async () => [holding('NVDA', 300), holding('KO', 700)],
    readFxRates: async () => ({ HKD: 1, USD: 7.8, JPY: 0.05 }),
    fetchImpl: (async (url: string, init: { headers: Record<string, string> }) => {
      requests.push({ url, headers: init.headers });
      const file = Object.keys(files).find((name) => url.includes(`/contents/${name}?`));
      if (!file) return new Response('missing', { status: 404 });
      return new Response(JSON.stringify(files[file]), { status: 200 });
    }) as unknown as typeof fetch,
    analyze: async (_system, prompt) => ({ text: `【一句總結】\n已收到 ${prompt.length} 字`, model: 'test-model' }),
    now: () => now,
    env: { AI_CYCLE_SIGNAL_TOKEN: 'test-token' },
    ...overrides,
  };
  return { deps, documents, requests, files, live, setNow: (value: string) => { now = new Date(value); } };
}

test('first read pulls the weekly signal, stores it and reads it back without refetching', async () => {
  const h = harness();
  const first = await runAiCycle({ action: 'read' }, h.deps);
  assert.equal(first.meta.source, 'live');
  assert.equal(first.signal.as_of_date, '2026-11-21');
  assert.equal(first.weeklyRuns.length, 2);
  assert.equal(first.exposure.aiShare, 0.3);
  assert.equal(h.requests.length, 2);
  assert.match(h.requests[0].url, /^https:\/\/api\.github\.com\/repos\/issacyeungbb-a11y\/ai-cycle-monitor\/contents\/signal\.json\?ref=signal-data$/);
  assert.equal(h.requests[0].headers.Authorization, 'Bearer test-token');
  const second = await runAiCycle({}, h.deps);
  assert.equal(second.meta.source, 'stored');
  assert.equal(second.signal.as_of_date, '2026-11-21');
  assert.equal(h.requests.length, 2, 'a recent successful fetch is not repeated');
  h.setNow('2026-11-21T09:00:00Z');
  await runAiCycle({ action: 'read' }, h.deps);
  assert.equal(h.requests.length, 4, 'refetch after the refresh interval');
});

test('a failed fetch falls back to the dated baseline and reports why', async () => {
  const h = harness({ env: {} });
  h.deps.fetchImpl = (async () => new Response('Not Found', { status: 404 })) as unknown as typeof fetch;
  const result = await runAiCycle({ action: 'read' }, h.deps);
  assert.equal(result.meta.source, 'baseline');
  assert.equal(result.meta.tokenConfigured, false);
  assert.equal(result.signal.as_of_date, AI_CYCLE_BASELINE_SIGNAL.as_of_date);
  assert.match(result.meta.lastFetchError ?? '', /HTTP 404.*AI_CYCLE_SIGNAL_TOKEN/);
  assert.equal(result.meta.fetchedAt, null);
  assert.equal(h.documents.get('latest')?.signalJson, undefined);
});

test('a failed or stale refresh keeps the stored signal instead of replacing it', async () => {
  const h = harness();
  await runAiCycle({ action: 'read' }, h.deps);
  const older = clone(h.live);
  older.as_of_date = '2026-11-07';
  older.generated_at = '2026-11-07T01:20:00+00:00';
  h.files['signal.json'] = older;
  const stale = await runAiCycle({ action: 'refresh' }, h.deps);
  assert.equal(stale.signal.as_of_date, '2026-11-21');
  assert.match(stale.meta.lastFetchError ?? '', /更舊/);
  assert.equal(stale.meta.source, 'stored');
  h.files['signal.json'] = { ...clone(h.live), stance: { code: 'ADD' } };
  const broken = await runAiCycle({ action: 'refresh' }, h.deps);
  assert.equal(broken.signal.as_of_date, '2026-11-21');
  assert.ok(broken.meta.lastFetchError);
  h.setNow('2026-12-05T02:00:00Z');
  h.deps.fetchImpl = (async () => { throw new Error('network down'); }) as unknown as typeof fetch;
  const overdue = await runAiCycle({ action: 'read' }, h.deps);
  assert.equal(overdue.signal.as_of_date, '2026-11-21');
  assert.equal(overdue.meta.overdue, true);
  assert.equal(overdue.meta.signalAgeDays, 14);
  assert.match(overdue.meta.lastFetchError ?? '', /network down/);
});

test('classification overrides are validated, saved and applied', async () => {
  const h = harness();
  await runAiCycle({ action: 'read' }, h.deps);
  const added = await runAiCycle({ action: 'classify', symbol: 'ko', layer: 'other' }, h.deps);
  assert.deepEqual(added.overrides, { KO: 'other' });
  assert.equal(added.exposure.aiShare, 1);
  const removed = await runAiCycle({ action: 'classify', symbol: 'NVDA', layer: 'none' }, h.deps);
  assert.deepEqual(removed.exposure.holdings.map((row) => row.symbol), ['KO']);
  const reset = await runAiCycle({ action: 'classify', symbol: 'NVDA', layer: 'default' }, h.deps);
  assert.deepEqual(reset.overrides, { KO: 'other' });
  await assert.rejects(runAiCycle({ action: 'classify', symbol: 'KO', layer: 'bogus' }, h.deps), (error) => error instanceof AiCycleError && error.status === 400);
  await assert.rejects(runAiCycle({ action: 'classify', symbol: '', layer: 'none' }, h.deps), /代號/);
  await assert.rejects(runAiCycle({ action: 'delete-everything' }, h.deps), (error) => error instanceof AiCycleError && error.status === 400);
});

test('analysis is generated from the current reading and stored with its date', async () => {
  const h = harness();
  await runAiCycle({ action: 'read' }, h.deps);
  const result = await runAiCycle({ action: 'analyze', question: '  應否加碼？ ' }, h.deps);
  assert.equal(result.analysis?.model, 'test-model');
  assert.equal(result.analysis?.signalAsOf, '2026-11-21');
  assert.equal(result.analysis?.question, '應否加碼？');
  assert.match(result.analysis?.text ?? '', /【一句總結】/);
  assert.equal((await runAiCycle({}, h.deps)).analysis?.generatedAt, result.analysis?.generatedAt);
  h.deps.analyze = async () => ({ text: '   ', model: 'test-model' });
  await assert.rejects(runAiCycle({ action: 'analyze' }, h.deps), /未有回傳/);
});

test('the page is reachable only through the protected shared function and stays separate from scheduled jobs', async () => {
  const read = (path: string) => readFile(new URL(path, import.meta.url), 'utf8');
  const [api, config, router, shell, page, cron, scheduled, vercel] = await Promise.all([
    read('../api/health.ts'), read('../src/lib/api/vercelFunctions.ts'), read('../src/router/index.tsx'),
    read('../src/layout/AppShell.tsx'), read('../src/pages/AiCyclePage.tsx'), read('./cronDailyUpdate.ts'),
    read('./scheduledAnalysis.ts'), read('../vercel.json'),
  ]);
  assert.match(api, /mode === 'ai-cycle'[\s\S]*?requirePortfolioAccess\(request, '\/api\/health'\)[\s\S]*?runAiCycle\(/);
  assert.match(config, /'ai-cycle': \{ path: '\/api\/health\?mode=ai-cycle', method: 'POST' \}/);
  assert.match(router, /path: 'ai-cycle'/);
  assert.match(shell, /to: '\/ai-cycle'/);
  assert.match(page, /callPortfolioFunction\('ai-cycle'/);
  assert.doesNotMatch(cron, /aiCycle/);
  assert.doesNotMatch(scheduled, /aiCycle/);
  assert.equal(Object.keys(JSON.parse(vercel).functions).some((name) => /ai-cycle/i.test(name)), false);
});

// ---------------------------------------------------------------------------
// 2026-11-22 全面檢視後補充：每項都對應一個已用實際輸出證實的問題。
// ---------------------------------------------------------------------------

test('only stocks and ETFs are classified: crypto, bonds and cash never count as AI even when the ticker collides', () => {
  // NOW、ARM 同時是加密貨幣代號；MU 亦可能是債券代號。它們不是上市公司，不可套用股票分類表。
  const exposure = computeAiExposure([
    holding('NOW', 100, { assetType: 'crypto' }), holding('ARM', 100, { assetType: 'crypto' }),
    holding('MU', 100, { assetType: 'bond' }), holding('AMD', 100, { assetType: 'cash' }),
    holding('NOW', 100, { assetType: 'stock' }), holding('KO', 500),
  ], {}, { HKD: 1, USD: 1, JPY: 1 });
  assert.equal(exposure.totalValueHKD, 1000);
  assert.equal(exposure.aiValueHKD, 100);
  assert.deepEqual(exposure.holdings.map((row) => `${row.symbol}:${row.assetType}`), ['NOW:stock']);
  assert.equal(exposure.monitoredCount, 1);
  assert.deepEqual(classifyAiHolding('NOW', {}, 'USD', 'crypto'), { layer: 'none', classifiedBy: 'unclassified' });
  // 自訂分類同樣不適用於非股票類資產，避免同代號的股票設定波及加密貨幣。
  assert.deepEqual(classifyAiHolding('NOW', { NOW: 'cloud' }, 'USD', 'crypto'), { layer: 'none', classifiedBy: 'unclassified' });
  assert.deepEqual(classifyAiHolding('NOW', { NOW: 'cloud' }, 'USD', 'stock'), { layer: 'cloud', classifiedBy: 'override' });
});

test('one stock held in several accounts is a single holding and concentration uses the combined size', () => {
  const exposure = computeAiExposure([
    holding('NVDA', 60, { name: 'NVIDIA' }), { ...holding('NVDA', 60, { name: 'NVIDIA' }), id: 'NVDA-2', accountSource: 'IBKR' },
    holding('MSFT', 20), holding('KO', 860),
  ], {}, { HKD: 1, USD: 1, JPY: 1 });
  assert.deepEqual(exposure.holdings.map((row) => row.symbol), ['NVDA', 'MSFT']);
  assert.equal(exposure.holdings[0].valueHKD, 120);
  assert.equal(exposure.holdings[0].shareOfTotal, 0.12);
  assert.deepEqual(exposure.holdings[0].accountSources, ['Futu', 'IBKR']);
  assert.equal(exposure.layers.find((layer) => layer.code === 'semiconductor')?.count, 1);
  assert.equal(exposure.monitoredCount, 2);
  const titles = buildAiCycleGuidance(signalWith(0), exposure).map((item) => item.title);
  assert.ok(titles.includes('單一持倉比重偏高'), '分散在兩個賬戶的合計 12% 應觸發單一持倉提示');
  // 只有一隻股票時，不應再提示「集中在價值鏈的單一環節」。
  const single = computeAiExposure([holding('NVDA', 30), { ...holding('NVDA', 30), id: 'NVDA-2', accountSource: 'IBKR' }, holding('KO', 940)], {}, { HKD: 1, USD: 1, JPY: 1 });
  assert.ok(!buildAiCycleGuidance(signalWith(0), single).map((item) => item.title).includes('集中在價值鏈的單一環節'));
});

test('weekly runs are ordered by date, de-duplicated and capped', () => {
  const runs = parseAiCycleWeeklyRuns({ runs: [
    { as_of_date: '2026-11-21', stance_code: 'HOLD' }, { as_of_date: '2026-11-07', stance_code: 'HOLD' },
    { as_of_date: '2026-11-21', stance_code: 'ADD' }, { as_of_date: 'bad', stance_code: 'ADD' }, null,
  ] });
  assert.deepEqual(runs.map((run) => `${run.as_of_date}:${run.stance_code}`), ['2026-11-07:HOLD', '2026-11-21:ADD']);
  const dates = Array.from({ length: 150 }, (_, index) => new Date(Date.UTC(2024, 0, 1) + index * 7 * 86_400_000).toISOString().slice(0, 10));
  const many = parseAiCycleWeeklyRuns({ runs: [...dates].reverse().map((date) => ({ as_of_date: date, stance_code: 'HOLD' })) });
  assert.equal(many.length, 104);
  assert.equal(many[0].as_of_date, dates[46], '保留最新的 104 週，並由舊到新排列');
  assert.equal(many[many.length - 1].as_of_date, dates[149]);
});

test('display-only fields cannot crash the page: missing collections are filled and malformed rows dropped', () => {
  const signal = clone(AI_CYCLE_BASELINE_SIGNAL) as any;
  delete signal.pulse.failures;
  delete signal.coverage_universe;
  signal.pulse.macro.push(null, { code: 'X', label_zh: '壞數據', value: 'n/a', date: '2026-11-12', change_4w: null });
  signal.pulse.flags.push({ code: 'NO_LABEL' });
  const [older, middle, newer] = [signal.history[1], signal.history[3], signal.history[5]];
  signal.history = [newer, null, { as_of_date: 'bad', period: 'x' }, older, middle];
  signal.ami.pillars_not_used.push(null);
  const parsed = parseAiCycleSignal(signal);
  assert.deepEqual(parsed.pulse.failures, []);
  assert.deepEqual(parsed.coverage_universe, { company_count: 0, note_zh: '' });
  assert.equal(parsed.pulse.macro.length, AI_CYCLE_BASELINE_SIGNAL.pulse.macro.length);
  assert.equal(parsed.pulse.flags.length, AI_CYCLE_BASELINE_SIGNAL.pulse.flags.length);
  assert.deepEqual(parsed.history.map((row) => row.as_of_date), [older, middle, newer].map((row: any) => row.as_of_date));
  assert.equal(parsed.ami.pillars_not_used.length, AI_CYCLE_BASELINE_SIGNAL.ami.pillars_not_used.length);
  // 正規化後的訊號可以完整產生分析提示詞，不會因缺欄位而拋錯。
  const exposure = computeAiExposure([holding('NVDA', 10)]);
  assert.doesNotThrow(() => buildAiCycleAnalysisPrompt(parsed, exposure, buildAiCycleGuidance(parsed, exposure)));
  // 原本已經必須具備的欄位仍然會被整體拒絕。
  const broken = clone(AI_CYCLE_BASELINE_SIGNAL) as any;
  delete broken.pulse.macro;
  assert.throws(() => parseAiCycleSignal(broken), /每週脈搏/);
});

test('the formal-index note follows the data instead of assuming scores are unpublished', () => {
  const unpublished = describeFormalIndexStatus(clone(AI_CYCLE_BASELINE_SIGNAL));
  assert.match(unpublished, /尚未發布/);
  assert.match(unpublished, /48\.3%.*44\.1%/);
  const both = clone(AI_CYCLE_BASELINE_SIGNAL);
  both.ami.formal_score = 66.2; both.abri.formal_score = 51.4;
  both.ami.formal_data_coverage = 0.71; both.abri.formal_data_coverage = 0.64;
  const published = describeFormalIndexStatus(both);
  assert.match(published, /正式分數已發布.*變現指數 66\.2.*泡沫風險指數 51\.4/);
  assert.doesNotMatch(published, /尚未發布|為空值/);
  const partial = clone(AI_CYCLE_BASELINE_SIGNAL);
  partial.ami.formal_score = 66.2;
  assert.match(describeFormalIndexStatus(partial), /只有部分.*變現指數 66\.2/);
  // 分析提示詞必須跟隨實際狀態，不可再向模型聲稱正式分數為空值。
  const exposure = computeAiExposure([holding('NVDA', 10)]);
  const prompt = buildAiCycleAnalysisPrompt(both, exposure, buildAiCycleGuidance(both, exposure));
  assert.match(prompt, /正式分數已發布/);
  assert.doesNotMatch(prompt, /為空值/);
});

test('the response carries the formal-index note and the page no longer hard-codes it', async () => {
  const h = harness();
  const result = await runAiCycle({ action: 'read' }, h.deps);
  assert.match(result.formalNote, /正式分數/);
  const page = await readFile(new URL('../src/pages/AiCyclePage.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(page, /正式分數均為空值/);
  assert.match(page, /formalNote/);
});

test('the size limit counts bytes, so Chinese text cannot slip past a character count', async () => {
  const padded = clone(AI_CYCLE_BASELINE_SIGNAL) as any;
  padded.as_of_date = '2026-11-21';
  padded.generated_at = '2026-11-21T01:20:00+00:00';
  padded.padding = '中'.repeat(320_000); // 320,000 個字元，但 UTF-8 約 960,000 位元組
  const h = harness();
  h.files['signal.json'] = padded;
  const result = await runAiCycle({ action: 'read' }, h.deps);
  assert.equal(result.meta.source, 'baseline');
  assert.match(result.meta.lastFetchError ?? '', /過大/);
  assert.equal(h.documents.get('latest')?.signalJson, undefined);
});

test('the classification table can be reset from the page, and shows where each class comes from', async () => {
  const page = await readFile(new URL('../src/pages/AiCyclePage.tsx', import.meta.url), 'utf8');
  assert.match(page, /classify\(holding, 'default'\)/);
  assert.match(page, /classifiedBy/);
  assert.match(page, /accountSources/);
});
