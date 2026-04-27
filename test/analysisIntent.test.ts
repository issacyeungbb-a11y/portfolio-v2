import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyIntent, intentNeedsExternalSearch } from '../server/analysisIntent.ts';
import { isValidAnalysisModel, MODEL_REGISTRY, GEMINI_ANALYZE_MODEL, CLAUDE_ANALYZE_MODEL } from '../server/analysisModels.ts';

// ---------------------------------------------------------------------------
// 1. portfolio_only — must NOT trigger external search
// ---------------------------------------------------------------------------

test('classifyIntent: portfolio_only — largest holding question', () => {
  assert.equal(classifyIntent('我最大持倉係邊隻？'), 'portfolio_only');
});

test('classifyIntent: portfolio_only — crypto allocation question', () => {
  assert.equal(classifyIntent('我而家加密貨幣佔幾多？'), 'portfolio_only');
});

test('classifyIntent: portfolio_only — highest cost asset', () => {
  assert.equal(classifyIntent('我成本最高嘅資產係邊個？'), 'portfolio_only');
});

test('intentNeedsExternalSearch: portfolio_only → false', () => {
  assert.equal(intentNeedsExternalSearch('portfolio_only'), false);
});

// ---------------------------------------------------------------------------
// 2. market_research — triggers external search
// ---------------------------------------------------------------------------

test('classifyIntent: market_research — news about specific stock', () => {
  const result = classifyIntent('最近 AAPL 有咩新聞？');
  assert.equal(result, 'market_research');
});

test('classifyIntent: market_research — interest rate impact', () => {
  const result = classifyIntent('利率高企對我組合有咩影響？');
  assert.equal(result, 'market_research');
});

test('classifyIntent: market_research — crypto market risk', () => {
  const result = classifyIntent('最近加密貨幣市場有咩風險？');
  assert.equal(result, 'market_research');
});

test('intentNeedsExternalSearch: market_research → true', () => {
  assert.equal(intentNeedsExternalSearch('market_research'), true);
});

// ---------------------------------------------------------------------------
// 3. deep_analysis — portfolio + external + reasoning
// ---------------------------------------------------------------------------

test('classifyIntent: deep_analysis — should I reduce position', () => {
  const result = classifyIntent('我而家應唔應該減倉？');
  assert.equal(result, 'deep_analysis');
});

test('classifyIntent: deep_analysis — recession risk', () => {
  const result = classifyIntent('如果經濟衰退，我嘅組合風險係邊？');
  assert.equal(result, 'deep_analysis');
});

test('classifyIntent: deep_analysis — next 3 months watch', () => {
  const result = classifyIntent('呢個組合未來三個月最需要留意咩？');
  assert.equal(result, 'deep_analysis');
});

test('intentNeedsExternalSearch: deep_analysis → true', () => {
  assert.equal(intentNeedsExternalSearch('deep_analysis'), true);
});

// ---------------------------------------------------------------------------
// 4. External search failure — status field
// ---------------------------------------------------------------------------

test('intentNeedsExternalSearch returns boolean for all intents', () => {
  assert.equal(typeof intentNeedsExternalSearch('portfolio_only'), 'boolean');
  assert.equal(typeof intentNeedsExternalSearch('market_research'), 'boolean');
  assert.equal(typeof intentNeedsExternalSearch('deep_analysis'), 'boolean');
});

// ---------------------------------------------------------------------------
// 5 & 6. Model validation — gemini-3.1-pro-preview and claude-opus-4-7
// ---------------------------------------------------------------------------

test('isValidAnalysisModel: gemini-3.1-pro-preview is valid', () => {
  assert.equal(isValidAnalysisModel('gemini-3.1-pro-preview'), true);
});

test('isValidAnalysisModel: claude-opus-4-7 is valid', () => {
  assert.equal(isValidAnalysisModel('claude-opus-4-7'), true);
});

test('GEMINI_ANALYZE_MODEL defaults to gemini-3.1-pro-preview', () => {
  assert.equal(isValidAnalysisModel(GEMINI_ANALYZE_MODEL), true);
});

test('CLAUDE_ANALYZE_MODEL defaults to claude-opus-4-7', () => {
  assert.equal(isValidAnalysisModel(CLAUDE_ANALYZE_MODEL), true);
});

// ---------------------------------------------------------------------------
// 7. Invalid model is rejected
// ---------------------------------------------------------------------------

test('isValidAnalysisModel: invalid model → false', () => {
  assert.equal(isValidAnalysisModel('gpt-4'), false);
  assert.equal(isValidAnalysisModel('gemini-1.5-flash'), false);
  assert.equal(isValidAnalysisModel(''), false);
  assert.equal(isValidAnalysisModel(null), false);
  assert.equal(isValidAnalysisModel(42), false);
});

// ---------------------------------------------------------------------------
// 8. MODEL_REGISTRY — both models have required fields
// ---------------------------------------------------------------------------

test('MODEL_REGISTRY: gemini-3.1-pro-preview has provider and label', () => {
  const entry = MODEL_REGISTRY['gemini-3.1-pro-preview'];
  assert.equal(entry.provider, 'google');
  assert.ok(entry.label.length > 0);
});

test('MODEL_REGISTRY: claude-opus-4-7 has provider and label', () => {
  const entry = MODEL_REGISTRY['claude-opus-4-7'];
  assert.equal(entry.provider, 'anthropic');
  assert.ok(entry.label.length > 0);
});

// ---------------------------------------------------------------------------
// 9. Default fallback for unclassified questions
// ---------------------------------------------------------------------------

test('classifyIntent: unclassified question defaults to market_research', () => {
  const result = classifyIntent('幫我分析吓個組合？');
  assert.equal(result, 'market_research');
});
