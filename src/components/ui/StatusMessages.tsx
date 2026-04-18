interface StatusMessagesProps {
  errors: Array<string | null | undefined>;
  successes?: Array<string | null | undefined>;
}

export function StatusMessages({ errors, successes = [] }: StatusMessagesProps) {
  const activeErrors = errors.filter(Boolean) as string[];
  const activeSuccesses = successes.filter(Boolean) as string[];

  if (activeErrors.length === 0 && activeSuccesses.length === 0) {
    return null;
  }

  const hasInfrastructureError = activeErrors.some((message) =>
    /Missing or insufficient permissions|permission|權限/i.test(message),
  );
  const errorSummary = hasInfrastructureError
    ? '資料讀取暫時有問題'
    : activeErrors.length === 1
      ? '分析流程遇到問題'
      : `發現 ${activeErrors.length} 項問題`;

  return (
    <div className="status-messages-stack">
      {activeErrors.length > 0 ? (
        <details className="status-message status-message-error status-message-error-details">
          <summary className="status-message-summary">
            <span className="status-message-summary-icon" aria-hidden="true">
              ⚠
            </span>
            <span className="status-message-summary-text">{errorSummary}</span>
            <span className="status-message-summary-link">詳情</span>
          </summary>
          <div className="status-message-details">
            {activeErrors.length === 1 ? (
              <p>{activeErrors[0]}</p>
            ) : (
              <ul className="status-messages-list">
                {activeErrors.map((message, index) => (
                  <li key={index}>{message}</li>
                ))}
              </ul>
            )}
          </div>
        </details>
      ) : null}
      {activeSuccesses.length > 0 ? (
        <p className="status-message status-message-success">
          {activeSuccesses[activeSuccesses.length - 1]}
        </p>
      ) : null}
    </div>
  );
}
