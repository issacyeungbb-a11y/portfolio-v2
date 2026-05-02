function parseJsonString(rawBody) {
    const trimmed = rawBody.trim();
    if (!trimmed) {
        return {};
    }
    return JSON.parse(trimmed);
}
export function sendJson(response, statusCode, payload) {
    response.statusCode = statusCode;
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.end(JSON.stringify(payload));
}
export async function readJsonBody(request) {
    if (request.body != null) {
        if (typeof request.body === 'string') {
            return parseJsonString(request.body);
        }
        if (Buffer.isBuffer(request.body)) {
            return parseJsonString(request.body.toString('utf8'));
        }
        return request.body;
    }
    const chunks = [];
    for await (const chunk of request) {
        if (typeof chunk === 'string') {
            chunks.push(Buffer.from(chunk));
            continue;
        }
        chunks.push(chunk);
    }
    return parseJsonString(Buffer.concat(chunks).toString('utf8'));
}
