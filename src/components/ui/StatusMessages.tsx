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

  return (
    <div className="status-messages-stack">
      {activeErrors.length > 0 ? (
        <div className="status-message status-message-error">
          {activeErrors.length === 1 ? (
            <p>{activeErrors[0]}</p>
          ) : (
            <>
              <p>發現 {activeErrors.length} 項問題：</p>
              <ul className="status-messages-list">
                {activeErrors.map((message, index) => (
                  <li key={index}>{message}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      ) : null}
      {activeSuccesses.length > 0 ? (
        <p className="status-message status-message-success">
          {activeSuccesses[activeSuccesses.length - 1]}
        </p>
      ) : null}
    </div>
  );
}
