import assert from 'node:assert/strict';
import test from 'node:test';

import { buildPrompt } from './analyzePortfolio.js';
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
