import { GoogleGenAI } from '@google/genai';

import type {
  ExtractAssetsRequest,
  ExtractAssetsResponse,
  ExtractedAssetCandidate,
} from '../src/types/extractAssets';
import type { AssetType } from '../src/types/portfolio';

const EXTRACT_ROUTE = '/api/extract-assets' as const;
const DEFAULT_EXTRACT_MODEL = 'gemini-2.5-flash-lite';

class ExtractAssetsError extends Error {
  status: number;

  constructor(message: string, status = 500) {
    super(message);
    this.name = 'ExtractAssetsError';
    this.status = status;
  }
}

function getExtractModel() {
  return process.env.GEMINI_EXTRACT_MODEL?.trim() || DEFAULT_EXTRACT_MODEL;
}

function getGeminiApiKey() {
  const apiKey = process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim();

  if (!apiKey) {
    throw new ExtractAssetsError(
      '未設定 GEMINI_API_KEY 或 GOOGLE_API_KEY，暫時無法解析截圖。',
      500,
    );
  }

  return apiKey;
}

function normalizeExtractAssetsRequest(payload: unknown): ExtractAssetsRequest {
  if (typeof payload !== 'object' || payload === null) {
    throw new ExtractAssetsError('截圖解析請求格式不正確。', 400);
  }

  const value = payload as Record<string, unknown>;
  const fileName =
    typeof value.fileName === 'string' ? value.fileName.trim() : '';
  const mimeType =
    typeof value.mimeType === 'string' ? value.mimeType.trim() : '';
  const imageBase64 =
    typeof value.imageBase64 === 'string' ? value.imageBase64.trim() : '';

  if (!fileName || !mimeType || !imageBase64) {
    throw new ExtractAssetsError('缺少必要的截圖資料，請重新上傳圖片。', 400);
  }

  return {
    fileName,
    mimeType,
    imageBase64,
  };
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

  if (normalized === 'stock' || normalized === 'stocks' || normalized === 'equity') {
    return 'stock';
  }

  if (normalized === 'etf') {
    return 'etf';
  }

  if (normalized === 'bond' || normalized === 'bonds' || normalized === 'fixed income') {
    return 'bond';
  }

  if (normalized === 'crypto' || normalized === 'cryptocurrency' || normalized === 'coin') {
    return 'crypto';
  }

  if (normalized === 'cash') {
    return 'cash';
  }

  return null;
}

function sanitizeCurrency(value: unknown) {
  const normalized = sanitizeString(value);
  return normalized ? normalized.toUpperCase() : null;
}

function sanitizeExtractedAssets(rawPayload: unknown): ExtractedAssetCandidate[] {
  if (
    typeof rawPayload !== 'object' ||
    rawPayload === null ||
    !('assets' in rawPayload) ||
    !Array.isArray(rawPayload.assets)
  ) {
    throw new ExtractAssetsError('Gemini 回傳格式不正確，未找到 assets 陣列。', 502);
  }

  return rawPayload.assets.map((asset) => {
    const value =
      typeof asset === 'object' && asset !== null
        ? (asset as Record<string, unknown>)
        : {};

    return {
      name: sanitizeString(value.name),
      ticker: sanitizeString(value.ticker),
      type: sanitizeType(value.type),
      quantity: sanitizeNumber(value.quantity),
      currency: sanitizeCurrency(value.currency),
      costBasis: sanitizeNumber(value.costBasis),
    };
  });
}

function stripJsonFence(text: string) {
  const trimmed = text.trim();
  if (!trimmed.startsWith('```')) {
    return trimmed;
  }

  return trimmed
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
}

function parseGeminiJson(text: string) {
  const normalized = stripJsonFence(text);

  try {
    return JSON.parse(normalized) as unknown;
  } catch {
    throw new ExtractAssetsError('Gemini 未回傳可解析的 JSON，請換一張更清晰的截圖再試。', 502);
  }
}

function buildExtractionPrompt(fileName: string) {
  return `
You are extracting portfolio holdings from a brokerage or wallet screenshot.

Return ONLY raw JSON. Do not use markdown fences. Do not add any explanation.

Use this exact shape:
{
  "assets": [
    {
      "name": string | null,
      "ticker": string | null,
      "type": "stock" | "etf" | "bond" | "crypto" | "cash" | null,
      "quantity": number | null,
      "currency": string | null,
      "costBasis": number | null
    }
  ]
}

Rules:
- Extract only assets that are actually visible in the screenshot.
- If a field is not visible or uncertain, set it to null.
- "costBasis" means average cost per unit, not total cost.
- "currency" should be an uppercase currency code like HKD or USD when visible.
- "type" must be one of: stock, etf, bond, crypto, cash, or null.
- Keep numbers as JSON numbers, not strings.
- Do not include fields outside the fixed schema.

Screenshot filename: ${fileName}
  `.trim();
}

export function getExtractAssetsErrorResponse(error: unknown) {
  if (error instanceof ExtractAssetsError) {
    return {
      status: error.status,
      body: {
        ok: false,
        route: EXTRACT_ROUTE,
        message: error.message,
      },
    };
  }

  if (error instanceof Error) {
    return {
      status: 500,
      body: {
        ok: false,
        route: EXTRACT_ROUTE,
        message: error.message,
      },
    };
  }

  return {
    status: 500,
    body: {
      ok: false,
      route: EXTRACT_ROUTE,
      message: '截圖解析失敗，請稍後再試。',
    },
  };
}

export async function extractAssetsFromScreenshot(
  payload: unknown,
): Promise<ExtractAssetsResponse> {
  const normalizedPayload = normalizeExtractAssetsRequest(payload);

  const apiKey = getGeminiApiKey();
  const ai = new GoogleGenAI({ apiKey });
  const model = getExtractModel();
  const result = await ai.models.generateContent({
    model,
    contents: [
      {
        text: buildExtractionPrompt(normalizedPayload.fileName),
      },
      {
        inlineData: {
          mimeType: normalizedPayload.mimeType,
          data: normalizedPayload.imageBase64,
        },
      },
    ],
    config: {
      temperature: 0.1,
    },
  });

  const parsed = parseGeminiJson(result.text ?? '');
  const assets = sanitizeExtractedAssets(parsed);

  return {
    ok: true,
    route: EXTRACT_ROUTE,
    mode: 'live',
    model,
    assets,
  };
}
