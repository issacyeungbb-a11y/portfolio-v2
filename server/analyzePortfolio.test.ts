import assert from 'node:assert/strict';
import test from 'node:test';

import { buildPrompt, qualityCheckGeneralAnswer } from './analyzePortfolio.js';
import { buildAnalysisRequestFromAssets } from './scheduledAnalysis.js';

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
  const request = buildAnalysisRequestFromAssets({
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
    analysisQuestion: '根據 Google 最新財報，係咩水平？背後有咩啟示？',
    analysisBackground: '請用專業投資角度回答一般問題。',
    analysisModel: 'claude-opus-4-7',
  });

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
