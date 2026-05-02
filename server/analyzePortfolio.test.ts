import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildEarningsEvidencePack,
  buildPrompt,
  clearExternalEvidenceCacheForTest,
  qualityCheckGeneralAnswer,
  runPortfolioAnalysisRequest,
  seedExternalEvidenceCacheForTest,
} from './analyzePortfolio.js';
import type { ExternalSearchResult } from './analyzePortfolio.js';
import { buildAnalysisRequestFromAssets } from './scheduledAnalysis.js';

function buildGoogGeneralRequest(question = '根據 Google 最新財報，係咩水平？背後有咩啟示？') {
  return buildAnalysisRequestFromAssets({
    assets: [
      {
        id: 'goog',
        name: 'Alphabet',
        symbol: 'GOOG',
        assetType: 'stock',
        accountSource: 'IB',
        currency: 'USD',
        quantity: 10,
        averageCost: 120,
        currentPrice: 180,
      },
    ],
    category: 'general_question',
    analysisQuestion: question,
    analysisBackground: '請用專業投資角度回答一般問題。',
    analysisModel: 'claude-opus-4-7',
  });
}

function buildExternalSearchFixture(overrides: Partial<ExternalSearchResult> = {}): ExternalSearchResult {
  const retrievedAt = new Date('2026-05-02T10:00:00.000Z').toISOString();
  return {
    summary: 'Alphabet 官方財報顯示收入、利潤與現金流仍在增長。',
    sources: [],
    externalEvidence: [
      {
        sourceTitle: 'Alphabet Q1 2026 Earnings Release',
        sourceUrl: 'https://abc.xyz/investor/earnings/q1-2026',
        publishedDate: '2026-04-25',
        retrievedAt,
        sourceType: 'official_report',
        keyFacts: ['管理層表示 AI capex 會維持高位。', '未披露一次性重大收益。'],
        keyFigures: [
          'Revenue $90.2B, up 14% YoY',
          'Operating income $28.4B',
          'Operating margin 31.5%',
          'Net income $23.1B',
          'Diluted EPS $1.89',
          'Operating cash flow $33.0B',
          'Free cash flow $17.8B',
          'Capital expenditures $15.2B',
          'Google Cloud revenue $12.3B',
          'Google Cloud operating income $2.1B',
        ],
        uncertainty: [],
      },
    ],
    status: 'ok',
    retrievedAt,
    ...overrides,
  };
}

test('buildPrompt sorts holdings by HKD value and labels local plus HKD values', () => {
  const request = buildAnalysisRequestFromAssets({
    assets: [
      {
        id: 'metaplanet',
        name: 'Metaplanet',
        symbol: '3350',
        assetType: 'stock',
        accountSource: 'IB',
        currency: 'JPY',
        quantity: 100,
        averageCost: 1500,
        currentPrice: 1800,
      },
      {
        id: 'nvda',
        name: 'NVIDIA',
        symbol: 'NVDA',
        assetType: 'stock',
        accountSource: 'IB',
        currency: 'USD',
        quantity: 1,
        averageCost: 1000,
        currentPrice: 1500,
      },
    ],
    category: 'asset_analysis',
    analysisQuestion: '請分析持倉',
    analysisBackground: '測試背景',
    analysisModel: 'gemini-3.1-pro-preview',
  });

  const prompt = buildPrompt(request);
  const nvdaIndex = prompt.indexOf('NVDA');
  const metaplanetIndex = prompt.indexOf('3350');

  assert.ok(nvdaIndex >= 0);
  assert.ok(metaplanetIndex >= 0);
  assert.ok(nvdaIndex < metaplanetIndex);
  assert.match(prompt, /市值 JPY 180,000 \/ 約 HKD 9,360/);
  assert.doesNotMatch(prompt, /市值 180,?000(?!\s*\/)/);
  assert.doesNotMatch(prompt, /成本 150,?000(?!\s*\/)/);
});

test('general question prompt expects grounded macro context and structured answer', () => {
  const request = buildAnalysisRequestFromAssets({
    assets: [
      {
        id: 'goog',
        name: 'Alphabet',
        symbol: 'GOOG',
        assetType: 'stock',
        accountSource: 'IB',
        currency: 'USD',
        quantity: 46,
        averageCost: 180,
        currentPrice: 250,
      },
    ],
    category: 'general_question',
    analysisQuestion: '根據 Google 最新財報，係咩水平？背後有咩說明？',
    analysisBackground: '請用專業投資角度回答一般問題。',
    analysisModel: 'claude-opus-4-7',
  });

  const prompt = buildPrompt(
    request,
    'Alphabet 最新季度雲業務增長加快，搜尋廣告仍是主要收入來源；市場同時關注 AI 資本開支。',
  );

  assert.match(prompt, /專業投資研究與投資組合分析助手/);
  assert.match(prompt, /Latest external information summary \(retrieved from Google Search\)/);
  assert.match(prompt, /收入、利潤、現金流、資本開支、分部業務/);
  assert.match(prompt, /"usedPortfolioFacts"/);
});

test('qualityCheckGeneralAnswer rejects shallow earnings answer', () => {
  const request = buildGoogGeneralRequest();

  const result = qualityCheckGeneralAnswer({
    answer: '一句話：財報強勁，但資料不完整，建議查閱完整財報。',
    intent: 'earnings_analysis',
    question: request.analysisQuestion || '',
    request,
    externalEvidence: [],
  });

  assert.equal(result.ok, false);
  assert.ok(result.failures.some((failure) => failure.includes('收入')));
  assert.ok(result.failures.some((failure) => failure.includes('核心數字表')));
});

test('earnings_analysis flow builds earnings evidence pack before model call', async () => {
  const request = buildGoogGeneralRequest();
  let buildPackCalls = 0;
  let modelPrompt = '';

  const response = await runPortfolioAnalysisRequest(request, {
    testHooks: {
      generateExternalSearchSummary: async () => buildExternalSearchFixture({ earningsEvidencePack: undefined }),
      buildEarningsEvidencePack: (question, sources, snapshot) => {
        buildPackCalls += 1;
        return buildEarningsEvidencePack(question, sources, snapshot);
      },
      analyzeWithClaude: async (_systemPrompt, userPrompt) => {
        modelPrompt = userPrompt;
        return JSON.stringify({
          answer:
            '一句話結論：Google 財報屬於強勁，收入、利潤與現金流都有官方數字支持。\n\n| 指標 | 數字 |\n| 收入 | $90.2B |\n| 收入增長 | 14% YoY |\n| 經營利潤 | $28.4B |\n| 經營利潤率 | 31.5% |\n| 淨利潤 | $23.1B |\n| EPS | $1.89 |\n| 營運現金流 | $33.0B |\n| 自由現金流 | $17.8B |\n| 資本開支 | $15.2B |\n\n收入分析：Search 與 Google Cloud 是分部重點。利潤分析：經營利潤率改善。現金流／capex：AI 數據中心資本開支高但仍有自由現金流。業務分部：Cloud revenue $12.3B、operating income $2.1B。一次性因素：未能確認重大一次性收益。投資含義：你持有 GOOG，市值及成本需要結合組合佔比觀察。監察指標：Cloud 增速、Search 廣告、capex、free cash flow、margin。',
          usedPortfolioFacts: ['GOOG 持倉市值與成本已納入。'],
          uncertainty: ['未能確認是否有其他一次性因素。'],
          suggestedActions: ['追蹤 Cloud 增速與 capex。'],
        });
      },
      qualityCheckGeneralAnswer: () => ({ ok: true, failures: [] }),
    },
  });

  assert.equal(response.intent, 'earnings_analysis');
  assert.equal(buildPackCalls, 1);
  assert.match(modelPrompt, /Structured external evidence pack/);
  assert.match(modelPrompt, /earningsEvidencePack/);
  assert.equal(response.earningsEvidencePack?.revenue, 'Revenue $90.2B, up 14% YoY');
});

test('quality failure triggers exactly one rewrite with failure reasons and returns rewritten answer', async () => {
  const request = buildGoogGeneralRequest();
  const prompts: string[] = [];
  let qualityCalls = 0;

  const response = await runPortfolioAnalysisRequest(request, {
    testHooks: {
      generateExternalSearchSummary: async () => buildExternalSearchFixture(),
      analyzeWithClaude: async (_systemPrompt, userPrompt) => {
        prompts.push(userPrompt);
        if (prompts.length === 1) {
          return JSON.stringify({
            answer: '一句話：財報強勁，但資料不完整，建議查閱完整財報。',
            usedPortfolioFacts: [],
            uncertainty: [],
            suggestedActions: [],
          });
        }
        return JSON.stringify({
          answer:
            '一句話結論：重寫後，Google 財報屬於強勁但 capex 壓力需要監察。\n\n| 指標 | 數字 |\n| 收入 | $90.2B |\n| 收入增長 | 14% YoY |\n| 經營利潤 | $28.4B |\n| 經營利潤率 | 31.5% |\n| 淨利潤 | $23.1B |\n| EPS | $1.89 |\n| 營運現金流 | $33.0B |\n| 自由現金流 | $17.8B |\n| 資本開支 | $15.2B |\n\n收入分析：收入由核心廣告與 Cloud 推動。利潤分析：經營利潤改善，但不能只看 EPS。現金流／capex：自由現金流仍正面，AI 數據中心資本開支是估值焦點。業務分部：Cloud revenue $12.3B，Cloud operating income $2.1B。一次性因素：未能確認其他重大一次性項目。投資含義：你持有 GOOG，需以市值、佔比、成本及30日走勢判斷分段部署。監察指標：Cloud 增速、Search 廣告、capex、free cash flow、margin。',
          usedPortfolioFacts: ['GOOG 持倉已引用。'],
          uncertainty: ['未能確認其他一次性項目。'],
          suggestedActions: ['下季檢查 capex 與 FCF。'],
        });
      },
      qualityCheckGeneralAnswer: () => {
        qualityCalls += 1;
        return qualityCalls === 1
          ? { ok: false, failures: ['缺少核心數字表。', '缺少現金流分析。'] }
          : { ok: true, failures: [] };
      },
    },
  });

  assert.equal(prompts.length, 2);
  assert.equal(qualityCalls, 2);
  assert.match(prompts[1], /質檢失敗原因/);
  assert.match(prompts[1], /缺少核心數字表/);
  assert.match(response.answer, /重寫後/);
  assert.doesNotMatch(response.answer, /建議查閱完整財報/);
});

test('portfolio_only does not build external evidence', async () => {
  const request = buildGoogGeneralRequest('我而家 GOOG 佔成個組合幾多？');
  let searchCalls = 0;

  const response = await runPortfolioAnalysisRequest(request, {
    testHooks: {
      generateExternalSearchSummary: async () => {
        searchCalls += 1;
        return buildExternalSearchFixture();
      },
      analyzeWithClaude: async () =>
        JSON.stringify({
          answer: '一句話結論：GOOG 佔比應只根據你目前持倉市值計算。',
          usedPortfolioFacts: ['GOOG 持倉市值已納入。'],
          uncertainty: [],
          suggestedActions: [],
        }),
    },
  });

  assert.equal(response.intent, 'portfolio_only');
  assert.equal(searchCalls, 0);
  assert.equal(response.dataFreshness?.externalSearchStatus, 'not_needed');
  assert.equal(response.externalEvidence, undefined);
});

test('external evidence cache hit marks data freshness as cached', async () => {
  clearExternalEvidenceCacheForTest();
  const request = buildGoogGeneralRequest('Google Cloud 增長對我持有 GOOG 有咩啟示？');
  request.conversationContext = '第 1 輪：已經討論過 Google Cloud。';
  seedExternalEvidenceCacheForTest(request, 'earnings_analysis', buildExternalSearchFixture());

  const response = await runPortfolioAnalysisRequest(request, {
    testHooks: {
      analyzeWithClaude: async () =>
        JSON.stringify({
          answer:
            '一句話結論：Google Cloud 增長支持 GOOG 的第二增長曲線，但估值仍要看利潤率與 capex。\n\n| 指標 | 數字 |\n| 收入 | $90.2B |\n| 收入增長 | 14% YoY |\n| 經營利潤 | $28.4B |\n| 經營利潤率 | 31.5% |\n| 淨利潤 | $23.1B |\n| EPS | $1.89 |\n| 營運現金流 | $33.0B |\n| 自由現金流 | $17.8B |\n| 資本開支 | $15.2B |\n\n收入分析：Cloud 是重要分部。利潤分析：Cloud operating income 改善。現金流／capex：AI capex 需要監察。業務分部：Search、Advertising、YouTube、Cloud。一次性因素：未能確認重大一次性因素。投資含義：你持有 GOOG，應用市值、佔比、成本及30日走勢做風險控制。監察指標：Cloud 增速、margin、capex、FCF、AI monetization。',
          usedPortfolioFacts: ['GOOG 持倉已納入。'],
          uncertainty: ['未能確認重大一次性因素。'],
          suggestedActions: ['追蹤 Cloud margin。'],
        }),
    },
  });

  assert.equal(response.dataFreshness?.externalSearchStatus, 'cached');
  assert.ok(response.externalEvidence && response.externalEvidence.length > 0);
  clearExternalEvidenceCacheForTest();
});

test('buildEarningsEvidencePack prefers official sources and flags missing fields', () => {
  const request = buildGoogGeneralRequest();
  const pack = buildEarningsEvidencePack(
    request.analysisQuestion || '',
    [
      {
        sourceTitle: 'Market News',
        sourceUrl: 'https://news.example/google',
        retrievedAt: '2026-05-02T10:00:00.000Z',
        sourceType: 'news',
        keyFacts: ['股價上升。'],
        keyFigures: ['Revenue $999B'],
        uncertainty: [],
      },
      {
        sourceTitle: 'Alphabet Form 10-Q',
        sourceUrl: 'https://sec.gov/google-10q',
        publishedDate: '2026-04-25',
        retrievedAt: '2026-05-02T10:00:00.000Z',
        sourceType: 'sec_filing',
        keyFacts: ['一次性 restructuring charge 影響淨利潤。'],
        keyFigures: [
          'Revenue $90.2B, up 14% YoY',
          'Operating income $28.4B',
          'Google Cloud revenue $12.3B',
          'Google Cloud operating income $2.1B',
        ],
        uncertainty: [],
      },
    ],
    request,
  );

  assert.equal(pack.revenue, 'Revenue $90.2B, up 14% YoY');
  assert.deepEqual(pack.segmentOperatingIncome, ['Google Cloud operating income $2.1B']);
  assert.deepEqual(pack.oneOffItems, ['一次性 restructuring charge 影響淨利潤。']);
  assert.ok(pack.uncertainty.some((item) => item.includes('自由現金流')));
  assert.equal(pack.sources[0].sourceType, 'sec_filing');
});
