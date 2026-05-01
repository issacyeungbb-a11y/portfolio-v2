import type { IncomingMessage, ServerResponse } from 'node:http';

export type ApiRequest = IncomingMessage & {
  body?: unknown;
  method?: string;
};

export type ApiResponse = ServerResponse<IncomingMessage>;

function parseJsonString(rawBody: string) {
  const trimmed = rawBody.trim();

  if (!trimmed) {
    return {};
  }

  return JSON.parse(trimmed) as unknown;
}

export function sendJson(response: ApiResponse, statusCode: number, payload: unknown) {
  response.statusCode = statusCode;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(payload));
}

export async function readJsonBody(request: ApiRequest): Promise<unknown> {
  if (request.body != null) {
    if (typeof request.body === 'string') {
      return parseJsonString(request.body);
    }

    if (Buffer.isBuffer(request.body)) {
      return parseJsonString(request.body.toString('utf8'));
    }

    return request.body;
  }

  const chunks: Uint8Array[] = [];

  for await (const chunk of request) {
    if (typeof chunk === 'string') {
      chunks.push(Buffer.from(chunk));
      continue;
    }

    chunks.push(chunk);
  }

  return parseJsonString(Buffer.concat(chunks).toString('utf8'));
}
