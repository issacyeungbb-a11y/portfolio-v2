import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isHeroReportSection,
  parseReportBlocks,
  stripSectionTitleBrackets,
  tokenizeReportText,
} from './reportRichText.ts';

test('tokenizeReportText highlights signed percentages with tone', () => {
  const tokens = tokenizeReportText('BTC 價格 -20.6%（拖累約 -7.5 萬）、OSCR +28.3%');
  const figures = tokens.filter((token) => token.kind === 'figure');

  assert.deepEqual(
    figures.map((token) => [token.text, token.tone]),
    [
      ['-20.6%', 'negative'],
      ['-7.5 萬', 'negative'],
      ['+28.3%', 'positive'],
    ],
  );
});

test('tokenizeReportText marks unsigned amounts and pp as neutral figures', () => {
  const tokens = tokenizeReportText('總值 USD 234,008，加密 23.6%，現金 0pp，跌破 59,000 美元');
  const figures = tokens.filter((token) => token.kind === 'figure');

  assert.deepEqual(
    figures.map((token) => token.text),
    ['USD 234,008', '23.6%', '0pp', '59,000 美元'],
  );
  assert.ok(figures.every((token) => token.tone === 'neutral'));
});

test('tokenizeReportText matches trailing currency code amounts', () => {
  const tokens = tokenizeReportText('總值約 1,825,265.50 HKD，較上季下跌 25,090.64 HKD');
  const figures = tokens.filter((token) => token.kind === 'figure');

  assert.deepEqual(
    figures.map((token) => token.text),
    ['1,825,265.50 HKD', '25,090.64 HKD'],
  );
});

test('tokenizeReportText does not treat dates or tickers as figures', () => {
  const tokens = tokenizeReportText('截至 2026年7月1日，持有 2800 及 3350');

  assert.equal(tokens.filter((token) => token.kind === 'figure').length, 0);
});

test('parseReportBlocks groups consecutive bullet lines into one list', () => {
  const blocks = parseReportBlocks(
    [
      '資料品質狀態 ok。',
      '- Risk-on 情境：若回暖可反彈。',
      '- Risk-off 情境：防守不足。',
    ].join('\n'),
  );

  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].kind, 'paragraph');
  assert.equal(blocks[1].kind, 'list');
  assert.equal(blocks[1].ordered, false);
  assert.equal(blocks[1].items.length, 2);
  assert.equal(blocks[1].items[0].segments[0].label, 'Risk-on 情境');
});

test('parseReportBlocks parses numbered observation with arrow segments', () => {
  const blocks = parseReportBlocks(
    '1. 宏觀背景：ETF 淨流出。→ 對我資產影響：BTC 拖累 -7.5 萬。→ 投資含義：控管合計曝險。',
  );

  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].kind, 'list');
  assert.equal(blocks[0].ordered, true);

  const item = blocks[0].items[0];
  assert.equal(item.index, 1);
  assert.deepEqual(
    item.segments.map((segment) => segment.label),
    ['宏觀背景', '對我資產影響', '投資含義'],
  );
});

test('parseReportBlocks extracts action tone labels', () => {
  const blocks = parseReportBlocks(
    [
      '- 必須跟進：補回成本資料。',
      '- 可以考慮：轉向價值板塊。',
      '- 暫時不建議：加碼單一加密。',
    ].join('\n'),
  );

  assert.equal(blocks[0].kind, 'list');
  assert.deepEqual(
    blocks[0].items.map((item) => item.actionTone),
    ['must', 'consider', 'avoid'],
  );
  assert.deepEqual(
    blocks[0].items.map((item) => item.actionLabel),
    ['必須跟進', '可以考慮', '暫時不建議'],
  );
});

test('parseReportBlocks treats fully parenthesised paragraph as note', () => {
  const blocks = parseReportBlocks('（限制提示：無交易記錄，請勿當投資虧損解讀。）');

  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].kind, 'note');
  assert.ok(blocks[0].text.startsWith('限制提示'));
});

test('parseReportBlocks keeps long prose intact as paragraph fallback', () => {
  const prose = '總資產由 204.4 萬跌至 182.5 萬 HKD（-10.7%）；淨入金／出金為 0。';
  const blocks = parseReportBlocks(prose);

  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].kind, 'paragraph');
  assert.equal(blocks[0].text, prose);
});

test('parseReportBlocks does not split segments without labels incorrectly', () => {
  const blocks = parseReportBlocks('- 最大拖累集中於加密與加密概念：BTC 價格 -20.6%。');

  assert.equal(blocks[0].kind, 'list');
  const item = blocks[0].items[0];
  assert.equal(item.actionTone, null);
  assert.equal(item.segments.length, 1);
  assert.equal(item.segments[0].label, null);
});

test('hero section helpers', () => {
  assert.equal(isHeroReportSection('【本月一句總結】'), true);
  assert.equal(isHeroReportSection('【管理層摘要】'), true);
  assert.equal(isHeroReportSection('【組合健康檢查】'), false);
  assert.equal(stripSectionTitleBrackets('【三個重點觀察】'), '三個重點觀察');
});
