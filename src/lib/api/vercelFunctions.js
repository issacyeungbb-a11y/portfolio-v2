import { getCurrentPortfolioAccessCode } from '../access/accessCode';
export const portfolioFunctionConfig = {
    health: { path: '/api/health', method: 'GET' },
    'extract-assets': { path: '/api/extract-assets', method: 'POST' },
    'extract-transactions': { path: '/api/extract-transactions', method: 'POST' },
    'manual-monthly-analysis': { path: '/api/cron-monthly-analysis', method: 'POST' },
    'manual-quarterly-report': { path: '/api/cron-quarterly-report', method: 'POST' },
    'manual-capture-snapshot': { path: '/api/manual-capture-snapshot', method: 'POST' },
    'parse-assets-command': { path: '/api/parse-assets-command', method: 'POST' },
    'parse-transactions-command': { path: '/api/parse-transactions-command', method: 'POST' },
    'update-prices': { path: '/api/update-prices', method: 'POST' },
    analyze: { path: '/api/analyze', method: 'POST' },
};
function normalizeTextError(status, text) {
    const trimmed = text.trim();
    if (!trimmed) {
        return `Request failed with status ${status}`;
    }
    if (trimmed.includes('Request Entity Too Large') ||
        trimmed.includes('FUNCTION_PAYLOAD_TOO_LARGE')) {
        return '上傳圖片太大，請先裁剪或壓縮截圖後再試。';
    }
    if (trimmed.includes('A server error has occurred')) {
        return '伺服器暫時出錯，請稍後再試。';
    }
    return trimmed.length > 180 ? `${trimmed.slice(0, 180)}...` : trimmed;
}
export async function callPortfolioFunction(key, payload) {
    const config = portfolioFunctionConfig[key];
    if (!config) {
        throw new Error(`未支援的函式請求：${key}`);
    }
    const headers = {};
    if (config.method === 'POST') {
        headers['Content-Type'] = 'application/json';
    }
    if (key !== 'health') {
        const accessCode = getCurrentPortfolioAccessCode();
        if (!accessCode) {
            throw new Error('尚未設定共享存取碼，請先設定 VITE_PORTFOLIO_ACCESS_CODE。');
        }
        headers['x-portfolio-access-code'] = accessCode;
    }
    const response = await fetch(config.path, {
        method: config.method,
        headers,
        body: config.method === 'POST' ? JSON.stringify(payload ?? {}) : undefined,
    });
    const rawText = await response.text();
    const contentType = response.headers.get('content-type') ?? '';
    let data = null;
    if (rawText) {
        if (contentType.includes('application/json')) {
            try {
                data = JSON.parse(rawText);
            }
            catch {
                throw new Error('伺服器回傳了無法解析的 JSON，請稍後再試。');
            }
        }
        else if (rawText.trim().startsWith('{') || rawText.trim().startsWith('[')) {
            try {
                data = JSON.parse(rawText);
            }
            catch {
                data = rawText;
            }
        }
        else {
            data = rawText;
        }
    }
    if (!response.ok) {
        const message = typeof data === 'object' &&
            data !== null &&
            'message' in data &&
            typeof data.message === 'string'
            ? data.message
            : typeof data === 'string'
                ? normalizeTextError(response.status, data)
                : `Request failed with status ${response.status}`;
        throw new Error(message);
    }
    return data;
}
export async function triggerManualSnapshot() {
    return callPortfolioFunction('manual-capture-snapshot');
}
