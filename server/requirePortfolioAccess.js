class PortfolioAccessError extends Error {
  status;
  route;
  constructor(message, route, status = 401) {
    super(message);
    this.name = "PortfolioAccessError";
    this.status = status;
    this.route = route;
  }
}
function getConfiguredPortfolioAccessCode() {
  return process.env.PORTFOLIO_ACCESS_CODE?.trim() || process.env.VITE_PORTFOLIO_ACCESS_CODE?.trim() || "";
}
function getNodeAccessCodeHeader(request) {
  const header = request.headers["x-portfolio-access-code"];
  if (Array.isArray(header)) {
    return header[0] ?? "";
  }
  return typeof header === "string" ? header : "";
}
function isPortfolioAccessError(error) {
  return error instanceof PortfolioAccessError;
}
async function requirePortfolioAccess(request, route) {
  const configuredCode = getConfiguredPortfolioAccessCode();
  if (!configuredCode) {
    throw new PortfolioAccessError(
      "\u5C1A\u672A\u8A2D\u5B9A\u5171\u4EAB\u5B58\u53D6\u78BC\uFF0C\u8ACB\u5148\u8A2D\u5B9A PORTFOLIO_ACCESS_CODE \u6216 VITE_PORTFOLIO_ACCESS_CODE\u3002",
      route,
      500
    );
  }
  const requestCode = getNodeAccessCodeHeader(request).trim();
  if (!requestCode) {
    throw new PortfolioAccessError("\u7F3A\u5C11\u5171\u4EAB\u5B58\u53D6\u78BC\uFF0C\u8ACB\u91CD\u65B0\u8F38\u5165\u5F8C\u518D\u8A66\u3002", route, 401);
  }
  if (requestCode !== configuredCode) {
    throw new PortfolioAccessError("\u5171\u4EAB\u5B58\u53D6\u78BC\u4E0D\u6B63\u78BA\uFF0C\u8ACB\u91CD\u65B0\u8F38\u5165\u5F8C\u518D\u8A66\u3002", route, 401);
  }
}
function getPortfolioAccessErrorResponse(error, route) {
  if (error instanceof PortfolioAccessError) {
    return {
      status: error.status,
      body: {
        ok: false,
        route,
        message: error.message
      }
    };
  }
  if (error instanceof Error) {
    return {
      status: 500,
      body: {
        ok: false,
        route,
        message: error.message
      }
    };
  }
  return {
    status: 500,
    body: {
      ok: false,
      route,
      message: "\u5171\u4EAB\u5B58\u53D6\u78BC\u9A57\u8B49\u5931\u6557\uFF0C\u8ACB\u7A0D\u5F8C\u518D\u8A66\u3002"
    }
  };
}
export {
  getPortfolioAccessErrorResponse,
  isPortfolioAccessError,
  requirePortfolioAccess
};
