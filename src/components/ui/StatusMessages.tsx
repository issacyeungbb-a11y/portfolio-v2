interface StatusMessagesProps {
  errors: Array<string | null | undefined>;
  successes?: Array<string | null | undefined>;
}

function getErrorHelpMessage(messages: string[]) {
  const hasPermissionIssue = messages.some((message) =>
    /Missing or insufficient permissions|permission|權限/i.test(message),
  );

  if (hasPermissionIssue) {
    return '這通常代表目前帳號未能讀取相關資料。請重新登入，或檢查 Firestore 權限設定。';
  }

  const hasSnapshotIssue = messages.some((message) => /snapshot|快照/i.test(message));
  if (hasSnapshotIssue) {
    return '目前至少有一部分快照未能取得。你可以先重整頁面，或前往資產頁後補快照。';
  }

  const hasPriceIssue = messages.some((message) => /price|價格|更新/i.test(message));
  if (hasPriceIssue) {
    return '價格更新可能未完成或回傳異常。請稍後重試，或到資產頁檢視待覆核項目。';
  }

  const hasAnalysisIssue = messages.some((message) => /analysis|分析|report|報告/i.test(message));
  if (hasAnalysisIssue) {
    return '分析或報告生成暫時失敗。請確認資產資料已同步，再重新嘗試。';
  }

  return '請稍後再試；如果問題持續，建議先重新整理頁面並檢查資料連線。';
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
      ? '資料同步遇到問題'
      : `發現 ${activeErrors.length} 項問題`;
  const errorHelpMessage = getErrorHelpMessage(activeErrors);

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
            <p className="status-message-details-help">{errorHelpMessage}</p>
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
