import { useState } from 'react';

import {
  callPortfolioFunction,
  portfolioFunctionConfig,
  type PortfolioFunctionKey,
} from '../../lib/api/vercelFunctions';

interface FunctionTestCardProps {
  title: string;
  description: string;
  functionKey: PortfolioFunctionKey;
  buttonLabel: string;
  requestBody?: unknown;
}

export function FunctionTestCard({
  title,
  description,
  functionKey,
  buttonLabel,
  requestBody,
}: FunctionTestCardProps) {
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [response, setResponse] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);
  const config = portfolioFunctionConfig[functionKey];

  async function handleTest() {
    setStatus('loading');
    setError(null);

    try {
      const result = await callPortfolioFunction(functionKey, requestBody);
      setResponse(result);
      setStatus('success');
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : '測試 Function 失敗，請稍後再試。',
      );
      setStatus('error');
    }
  }

  return (
    <article className="card function-test-card">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Function Test</p>
          <h2>{title}</h2>
          {description ? <p className="table-hint">{description}</p> : null}
        </div>
        <span className="chip chip-soft">
          {config.method} {config.path}
        </span>
      </div>

      {requestBody ? (
        <div className="function-test-block">
          <p className="muted-label">測試 Request Body</p>
          <pre className="json-block">{JSON.stringify(requestBody, null, 2)}</pre>
        </div>
      ) : null}

      <div className="button-row">
        <button
          className="button button-primary"
          type="button"
          onClick={handleTest}
          disabled={status === 'loading'}
        >
          {status === 'loading' ? '測試中...' : buttonLabel}
        </button>
      </div>

      {error ? <p className="status-message status-message-error">{error}</p> : null}

      <div className="function-test-block">
        <p className="muted-label">Mock JSON Response</p>
        <pre className="json-block">
          {response ? JSON.stringify(response, null, 2) : '等待測試'}
        </pre>
      </div>
    </article>
  );
}
