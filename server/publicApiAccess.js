import { timingSafeEqual } from "node:crypto";
import { sendJson } from "./apiShared.js";
const PUBLIC_PORTFOLIO_ROUTE = "/api/portfolio-public";
const PUBLIC_READ_TOKEN_MIN_LENGTH = 32;
function getLoginAccessCodes() {
  return [
    process.env.PORTFOLIO_ACCESS_CODE?.trim() ?? "",
    process.env.VITE_PORTFOLIO_ACCESS_CODE?.trim() ?? ""
  ].filter((code) => code.length > 0);
}
function getConfiguredPublicReadToken() {
  const token = process.env.PORTFOLIO_PUBLIC_READ_TOKEN?.trim() ?? "";
  if (token.length < PUBLIC_READ_TOKEN_MIN_LENGTH) {
    return "";
  }
  if (getLoginAccessCodes().includes(token)) {
    return "";
  }
  return token;
}
function getPublicReadTokenFromRequest(request) {
  try {
    return new URL(request.url ?? PUBLIC_PORTFOLIO_ROUTE, "http://localhost").searchParams.get("token")?.trim() ?? "";
  } catch {
    return "";
  }
}
function hasLegacyCodeParam(request) {
  try {
    return new URL(request.url ?? PUBLIC_PORTFOLIO_ROUTE, "http://localhost").searchParams.has("code");
  } catch {
    return false;
  }
}
function isValidPublicReadToken(provided, configured) {
  if (!provided || !configured) {
    return false;
  }
  const providedBuffer = Buffer.from(provided, "utf8");
  const configuredBuffer = Buffer.from(configured, "utf8");
  return providedBuffer.length === configuredBuffer.length && timingSafeEqual(providedBuffer, configuredBuffer);
}
const PUBLIC_ALLOWED_METHODS = "GET, HEAD, OPTIONS";
function setPublicApiHeaders(response) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", PUBLIC_ALLOWED_METHODS);
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader("Cache-Control", "no-store");
}
function logPublicApiRequest(request, route, status, startedAt, extra = {}) {
  const userAgent = request.headers?.["user-agent"];
  console.info("[public-api]", JSON.stringify({
    route,
    method: request.method ?? "",
    status,
    durationMs: Date.now() - startedAt,
    userAgent: (Array.isArray(userAgent) ? userAgent.join(" ") : userAgent ?? "").slice(0, 200),
    ...extra
  }));
}
function answerPublicRequestPreamble(request, response, route, startedAt) {
  setPublicApiHeaders(response);
  if (request.method === "OPTIONS") {
    response.statusCode = 204;
    response.end();
    logPublicApiRequest(request, route, 204, startedAt);
    return true;
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.setHeader("Allow", PUBLIC_ALLOWED_METHODS);
    sendJson(response, 405, {
      ok: false,
      message: "Method not allowed"
    });
    logPublicApiRequest(request, route, 405, startedAt);
    return true;
  }
  const configuredToken = getConfiguredPublicReadToken();
  const requestToken = getPublicReadTokenFromRequest(request);
  if (!isValidPublicReadToken(requestToken, configuredToken)) {
    sendJson(response, 401, {
      ok: false,
      message: "Unauthorized"
    });
    logPublicApiRequest(request, route, 401, startedAt, {
      tokenProvided: requestToken.length > 0,
      tokenConfigured: configuredToken.length > 0,
      legacyCodeParam: hasLegacyCodeParam(request)
    });
    return true;
  }
  if (request.method === "HEAD") {
    response.statusCode = 200;
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.end();
    logPublicApiRequest(request, route, 200, startedAt);
    return true;
  }
  return false;
}
export {
  PUBLIC_ALLOWED_METHODS,
  PUBLIC_READ_TOKEN_MIN_LENGTH,
  answerPublicRequestPreamble,
  getConfiguredPublicReadToken,
  getPublicReadTokenFromRequest,
  isValidPublicReadToken,
  logPublicApiRequest,
  setPublicApiHeaders
};
