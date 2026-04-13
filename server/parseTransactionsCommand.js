import { GoogleGenAI } from '@google/genai';
const PARSE_ROUTE = '/api/parse-transactions-command';
const DEFAULT_PARSE_MODEL = 'gemini-2.5-flash-lite';
class ParseTransactionsCommandError extends Error {
    status;
    constructor(message, status = 500) {
        super(message);
        this.name = 'ParseTransactionsCommandError';
        this.status = status;
    }
}
function getParseModel() {
    return process.env.GEMINI_EXTRACT_MODEL?.trim() || DEFAULT_PARSE_MODEL;
}
function getGeminiApiKey() {
    const apiKey = process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim();
    if (!apiKey) {
        throw new ParseTransactionsCommandError('未設定 GEMINI_API_KEY 或 GOOGLE_API_KEY，暫時無法解析交易文字。', 500);
    }
    return apiKey;
}
function normalizeRequest(payload) {
    if (typeof payload !== 'object' || payload === null) {
        throw new ParseTransactionsCommandError('交易文字匯入請求格式不正確。', 400);
    }
    const value = payload;
    const text = typeof value.text === 'string' ? value.text.trim() : '';
    if (!text) {
        throw new ParseTransactionsCommandError('請先輸入交易內容，再開始解析。', 400);
    }
    return { text };
}
function sanitizeString(value) {
    if (typeof value !== 'string') {
        return null;
    }
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
}
function sanitizeNumber(value) {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }
    if (typeof value === 'string') {
        const cleaned = value.replace(/,/g, '').trim();
        if (!cleaned) {
            return null;
        }
        const parsed = Number(cleaned);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}
function sanitizeType(value) {
    if (typeof value !== 'string') {
        return null;
    }
    const normalized = value.trim().toLowerCase();
    if (normalized === 'stock' || normalized === 'stocks' || normalized === 'equity' || normalized === '股票') {
        return 'stock';
    }
    if (normalized === 'etf') {
        return 'etf';
    }
    if (normalized === 'bond' || normalized === 'bonds' || normalized === 'fixed income' || normalized === '債券') {
        return 'bond';
    }
    if (normalized === 'crypto' || normalized === 'cryptocurrency' || normalized === 'coin' || normalized === '加密貨幣') {
        return 'crypto';
    }
    if (normalized === 'cash' || normalized === '現金') {
        return 'cash';
    }
    return null;
}
function sanitizeTransactionType(value) {
    if (typeof value !== 'string') {
        return null;
    }
    const normalized = value.trim().toLowerCase();
    if (normalized === 'buy' || normalized === 'bought' || normalized === '買入' || normalized === '加倉') {
        return 'buy';
    }
    if (normalized === 'sell' || normalized === 'sold' || normalized === '賣出' || normalized === '減倉') {
        return 'sell';
    }
    return null;
}
function stripJsonFence(text) {
    const trimmed = text.trim();
    if (!trimmed.startsWith('```')) {
        return trimmed;
    }
    return trimmed.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/, '').trim();
}
function parseGeminiJson(text) {
    try {
        return JSON.parse(stripJsonFence(text));
    }
    catch {
        throw new ParseTransactionsCommandError('AI 未回傳可解析的交易 JSON，請重新描述一次。', 502);
    }
}
function sanitizeTransactions(rawPayload) {
    if (typeof rawPayload !== 'object' ||
        rawPayload === null ||
        !('transactions' in rawPayload) ||
        !Array.isArray(rawPayload.transactions)) {
        throw new ParseTransactionsCommandError('AI 回傳格式不正確，未找到 transactions 陣列。', 502);
    }
    return rawPayload.transactions.map((entry) => {
        const value = typeof entry === 'object' && entry !== null ? entry : {};
        return {
            name: sanitizeString(value.name),
            ticker: sanitizeString(value.ticker),
            type: sanitizeType(value.type),
            transactionType: sanitizeTransactionType(value.transactionType),
            quantity: sanitizeNumber(value.quantity),
            currency: sanitizeString(value.currency)?.toUpperCase() ?? null,
            price: sanitizeNumber(value.price),
            fees: sanitizeNumber(value.fees),
            date: sanitizeString(value.date),
            note: sanitizeString(value.note),
        };
    });
}
function buildPrompt(text) {
    return `
You are converting a user's natural-language trading instruction into structured transaction records.

Return ONLY raw JSON. Do not use markdown fences. Do not add any explanation.

Use this exact shape:
{
  "transactions": [
    {
      "name": string | null,
      "ticker": string | null,
      "type": "stock" | "etf" | "bond" | "crypto" | "cash" | null,
      "transactionType": "buy" | "sell" | null,
      "quantity": number | null,
      "currency": string | null,
      "price": number | null,
      "fees": number | null,
      "date": string | null,
      "note": string | null
    }
  ]
}

Rules:
- Parse only transactions explicitly mentioned by the user.
- The user may write in Traditional Chinese, Cantonese, or English.
- "price" means trade price per unit.
- "date" should be YYYY-MM-DD if present or inferable.
- If a field is missing or uncertain, set it to null.
- Keep numbers as JSON numbers.
- Do not include fields outside the fixed schema.

User instruction:
${text}
  `.trim();
}
export function getParseTransactionsCommandErrorResponse(error) {
    if (error instanceof ParseTransactionsCommandError) {
        return { status: error.status, body: { ok: false, route: PARSE_ROUTE, message: error.message } };
    }
    if (error instanceof Error) {
        return { status: 500, body: { ok: false, route: PARSE_ROUTE, message: error.message } };
    }
    return {
        status: 500,
        body: { ok: false, route: PARSE_ROUTE, message: '交易文字匯入失敗，請稍後再試。' },
    };
}
export async function parseTransactionsFromCommand(payload) {
    const normalizedPayload = normalizeRequest(payload);
    const apiKey = getGeminiApiKey();
    const ai = new GoogleGenAI({ apiKey });
    const model = getParseModel();
    const result = await ai.models.generateContent({
        model,
        contents: buildPrompt(normalizedPayload.text),
        config: { temperature: 0.1 },
    });
    return {
        ok: true,
        route: PARSE_ROUTE,
        mode: 'live',
        model,
        transactions: sanitizeTransactions(parseGeminiJson(result.text ?? '')),
    };
}
