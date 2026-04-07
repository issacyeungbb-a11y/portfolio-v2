import { GoogleGenAI } from '@google/genai';

import type {
  ExtractTransactionsRequest,
  ExtractTransactionsResponse,
  ExtractedTransactionCandidate,
} from '../src/types/extractAssets';
import type { AssetTransactionType, AssetType } from '../src/types/portfolio';

const EXTRACT_ROUTE = '/api/extract-transactions' as const;
const DEFAULT_EXTRACT_MODEL = 'gemini-2.5-flash-lite';

class ExtractTransactionsError extends Error {
  status: number;

  constructor(message: string, status = 500) {
    super(message);
    this.name = 'ExtractTransactionsError';
    this.status = status;
  }
}

function getExtractModel() {
  return process.env.GEMINI_EXTRACT_MODEL?.trim() || DEFAULT_EXTRACT_MODEL;
}

function getGeminiApiKey() {
  const apiKey = process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim();

  if (!apiKey) {
    throw new ExtractTransactionsError(
      '未設定 GEMINI_API_KEY 或 GOOGLE_API_KEY，暫時無法解析交易截圖。',
      500,
    );
  }

  return apiKey;
}

function normalizeRequest(payload: unknown): ExtractTransactionsRequest {
  if (typeof payload !== 'object' || payload === null) {
    throw new ExtractTransactionsError('交易截圖解析請求格式不正確。', 400);
  }

  const value = payload as Record<string, unknown>;
  const fileName = typeof value.fileName === 'string' ? value.fileName.trim() : '';
  const mimeType = typeof value.mimeType === 'string' ? value.mimeType.trim() : '';
  const imageBase64 = typeof value.imageBase64 === 'string' ? value.imageBase64.trim() : '';

  if (!fileName || !mimeType || !imageBase64) {
    throw new ExtractTransactionsError('缺少必要的截圖資料，請重新上傳圖片。', 400);
  }

  return { fileName, mimeType, imageBase64 };
}

function sanitizeString(value: unknown) {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function sanitizeNumber(value: unknown) {
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

function sanitizeType(value: unknown): AssetType | null {
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

function sanitizeTransactionType(value: unknown): AssetTransactionType | null {
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

function stripJsonFence(text: string) {
  const trimmed = text.trim();
  if (!trimmed.startsWith('```')) {
    return trimmed;
  }

  return trimmed.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/, '').trim();
}

function parseGeminiJson(text: string) {
  try {
    return JSON.parse(stripJsonFence(text)) as unknown;
  } catch {
    throw new ExtractTransactionsError('Gemini 未回傳可解析的交易 JSON，請換一張更清晰的截圖再試。', 502);
  }
}

function sanitizeTransactions(rawPayload: unknown): ExtractedTransactionCandidate[] {
  if (
    typeof rawPayload !== 'object' ||
    rawPayload === null ||
    !('transactions' in rawPayload) ||
    !Array.isArray(rawPayload.transactions)
  ) {
    throw new ExtractTransactionsError('Gemini 回傳格式不正確，未找到 transactions 陣列。', 502);
  }

  return rawPayload.transactions.map((entry) => {
    const value = typeof entry === 'object' && entry !== null ? (entry as Record<string, unknown>) : {};

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

function buildPrompt(fileName: string) {
  return `
You are extracting investment transactions from a brokerage screenshot.

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
- Extract only transactions clearly visible in the screenshot.
- If a field is missing or uncertain, set it to null.
- "price" means trade price per unit, not total amount.
- "date" should be YYYY-MM-DD if visible and inferable.
- Keep numbers as JSON numbers.
- Do not include fields outside the fixed schema.

Screenshot filename: ${fileName}
  `.trim();
}

export function getExtractTransactionsErrorResponse(error: unknown) {
  if (error instanceof ExtractTransactionsError) {
    return {
      status: error.status,
      body: { ok: false, route: EXTRACT_ROUTE, message: error.message },
    };
  }

  if (error instanceof Error) {
    return {
      status: 500,
      body: { ok: false, route: EXTRACT_ROUTE, message: error.message },
    };
  }

  return {
    status: 500,
    body: { ok: false, route: EXTRACT_ROUTE, message: '交易截圖解析失敗，請稍後再試。' },
  };
}

export async function extractTransactionsFromScreenshot(payload: unknown): Promise<ExtractTransactionsResponse> {
  const normalizedPayload = normalizeRequest(payload);
  const apiKey = getGeminiApiKey();
  const ai = new GoogleGenAI({ apiKey });
  const model = getExtractModel();
  const result = await ai.models.generateContent({
    model,
    contents: [
      { text: buildPrompt(normalizedPayload.fileName) },
      {
        inlineData: {
          mimeType: normalizedPayload.mimeType,
          data: normalizedPayload.imageBase64,
        },
      },
    ],
    config: { temperature: 0.1 },
  });

  return {
    ok: true,
    route: EXTRACT_ROUTE,
    mode: 'live',
    model,
    transactions: sanitizeTransactions(parseGeminiJson(result.text ?? '')),
  };
}
