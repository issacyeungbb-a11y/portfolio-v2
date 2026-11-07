import { sendJson } from "./apiShared.js";
const PUBLIC_PORTFOLIO_ROUTE = "/api/portfolio-public";
function getConfiguredPublicPortfolioCode() {
  return process.env.VITE_PORTFOLIO_ACCESS_CODE?.trim() || process.env.PORTFOLIO_ACCESS_CODE?.trim() || "";
}
function getPublicPortfolioQueryCode(request) {
  try {
    return new URL(request.url ?? PUBLIC_PORTFOLIO_ROUTE, "http://localhost").searchParams.get("code")?.trim() ?? "";
  } catch {
    return "";
  }
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
  const configuredCode = getConfiguredPublicPortfolioCode();
  const requestCode = getPublicPortfolioQueryCode(request);
  if (!configuredCode || requestCode !== configuredCode) {
    sendJson(response, 401, {
      ok: false,
      message: "Unauthorized"
    });
    logPublicApiRequest(request, route, 401, startedAt, {
      codeProvided: requestCode.length > 0,
      codeConfigured: configuredCode.length > 0
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
  answerPublicRequestPreamble,
  getConfiguredPublicPortfolioCode,
  getPublicPortfolioQueryCode,
  logPublicApiRequest,
  setPublicApiHeaders
};
