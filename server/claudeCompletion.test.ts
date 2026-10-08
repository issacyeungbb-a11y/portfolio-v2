import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { analyzeWithClaude } from './analyzePortfolio.js';

const oldKey = process.env.ANTHROPIC_API_KEY;
process.env.ANTHROPIC_API_KEY = 'test-key';
after(() => { if (oldKey === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = oldKey; });
const response = (text: string, reason: string) => new Response(JSON.stringify({
  content: [{ type: 'text', text }], stop_reason: reason, usage: { output_tokens: 3500 },
}), { status: 200, headers: { 'content-type': 'application/json', 'request-id': 'test-request' } });

test('Claude completes a single-turn report without an unnecessary second request', async () => {
  let calls = 0;
  const result = await analyzeWithClaude('system', 'question', 'claude-opus-5-5', 8000, 120000,
    (async () => { calls += 1; return response('完整月報。', 'end_turn'); }) as typeof fetch);
  assert.equal(result, '完整月報。');
  assert.equal(calls, 1);
});

test('Claude max_tokens continuation preserves the original question and joins the full answer', async () => {
  const bodies: any[] = [];
  const result = await analyzeWithClaude('system', 'original question', 'claude-opus-5-5', 8000, 120000,
    (async (_url: any, options: any) => {
      bodies.push(JSON.parse(options.body));
      return bodies.length === 1 ? response('最後一句中', 'max_tokens') : response('途接續完成。', 'end_turn');
    }) as typeof fetch);
  assert.equal(result, '最後一句中途接續完成。');
  assert.equal(bodies[1].messages[0].content, 'original question');
  assert.equal(bodies[1].messages[1].role, 'assistant');
  assert.equal(bodies[1].messages[1].content, '最後一句中');
  assert.equal(bodies[1].max_tokens, 8000);
});

test('continued truncation rejects the partial report instead of treating it as complete', async () => {
  let calls = 0;
  await assert.rejects(analyzeWithClaude('system', 'question', 'claude-opus-5-5', 8000, 120000,
    (async () => { calls += 1; return response('截斷', 'max_tokens'); }) as typeof fetch), /未儲存截斷報告/);
  assert.equal(calls, 3);
});

test('continuations share one deadline rather than resetting a full model timeout', async () => {
  let calls = 0;
  await assert.rejects(analyzeWithClaude('system', 'question', 'claude-opus-5-5', 8000, 10,
    (async () => { calls += 1; await new Promise((resolve) => setTimeout(resolve, 20)); return response('截斷', 'max_tokens'); }) as typeof fetch),
    (error: any) => error.name === 'TimeoutError');
  assert.equal(calls, 1);
});

test('refusal and missing completion metadata do not overwrite a report with partial text', async () => {
  await assert.rejects(analyzeWithClaude('system', 'question', 'claude-opus-5-5', 8000, 120000,
    (async () => response('未完成內容', 'refusal')) as typeof fetch), /模型未完成回應/);
});
