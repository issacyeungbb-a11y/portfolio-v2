import type { Dispatch, SetStateAction } from 'react';

import type { AnalysisCategory } from '../../types/portfolio';

interface ConversationTurn {
  question: string;
  answer: string;
  generatedAt: string;
  model: string;
}

interface ConversationArchiveItem {
  id: string;
  title: string;
  updatedAt: string;
  turnCount: number;
}

interface AnalysisConversationPanelProps {
  analysisQuestion: string;
  selectedSessionId: string | null;
  activeConversationTurns: ConversationTurn[];
  conversationArchiveSessions: ConversationArchiveItem[];
  visibleCount: number;
  isAnalyzing: boolean;
  canAnalyze: boolean;
  onAnalysisQuestionChange: Dispatch<SetStateAction<Record<AnalysisCategory, string>>>;
  onFollowUpQuestionChange: Dispatch<SetStateAction<Record<AnalysisCategory, string>>>;
  onSelectedSessionIdChange: Dispatch<SetStateAction<string | null>>;
  onVisibleCountChange: Dispatch<SetStateAction<number>>;
  onAnalyze: () => void;
  onFollowUp: () => void;
  formatAnalysisTime: (value: string) => string;
  getAnalysisModelLabel: (model: string) => string;
}

export function AnalysisConversationPanel({
  analysisQuestion,
  selectedSessionId,
  activeConversationTurns,
  conversationArchiveSessions,
  visibleCount,
  isAnalyzing,
  canAnalyze,
  onAnalysisQuestionChange,
  onFollowUpQuestionChange,
  onSelectedSessionIdChange,
  onVisibleCountChange,
  onAnalyze,
  onFollowUp,
  formatAnalysisTime,
  getAnalysisModelLabel,
}: AnalysisConversationPanelProps) {
  function handleNewConversation() {
    onSelectedSessionIdChange(null);
    onAnalysisQuestionChange((current) => ({ ...current, general_question: '' }));
    onFollowUpQuestionChange((current) => ({ ...current, general_question: '' }));
  }

  function handleSend() {
    if (activeConversationTurns.length > 0) {
      onFollowUp();
    } else {
      onAnalyze();
    }
  }

  return (
    <section className="card analysis-thread-card">
      <div className="analysis-thread-layout">
        {/* Left: history sidebar */}
        <aside className="analysis-thread-sidebar">
          <div className="analysis-thread-sidebar-top">
            <span className="analysis-thread-sidebar-label">歷史對話</span>
            <button
              type="button"
              className="button button-secondary"
              onClick={handleNewConversation}
            >
              新對話
            </button>
          </div>

          {conversationArchiveSessions.length > 0 ? (
            <div className="analysis-archive-list">
              {conversationArchiveSessions.slice(0, visibleCount).map((item) => {
                const isActive = selectedSessionId === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={isActive ? 'analysis-archive-row active' : 'analysis-archive-row'}
                    onClick={() => onSelectedSessionIdChange(item.id)}
                  >
                    <div className="analysis-archive-main">
                      <strong>{item.title}</strong>
                      <p>
                        {formatAnalysisTime(item.updatedAt)} · {item.turnCount} 輪
                      </p>
                    </div>
                  </button>
                );
              })}
              {visibleCount < conversationArchiveSessions.length ? (
                <div className="button-row">
                  <button
                    className="button button-secondary"
                    type="button"
                    onClick={() =>
                      onVisibleCountChange((current) =>
                        Math.min(current + 10, conversationArchiveSessions.length),
                      )
                    }
                  >
                    載入更多
                  </button>
                </div>
              ) : null}
            </div>
          ) : (
            <p className="status-message">尚未有對話記錄。</p>
          )}
        </aside>

        {/* Right: chat area + input */}
        <div className="analysis-thread-main">
          <div className="analysis-chat-thread">
            {activeConversationTurns.length > 0 ? (
              activeConversationTurns.map((turn, index) => (
                <div key={`${turn.generatedAt}-${index}`} className="analysis-thread-turn">
                  <div className="analysis-chat-bubble analysis-chat-bubble-user">
                    <div className="analysis-chat-bubble-meta">
                      <span>我</span>
                      <span>{formatAnalysisTime(turn.generatedAt)}</span>
                    </div>
                    <p>{turn.question}</p>
                  </div>
                  <div className="analysis-chat-bubble analysis-chat-bubble-assistant">
                    <div className="analysis-chat-bubble-meta">
                      <span>{getAnalysisModelLabel(turn.model)}</span>
                      <span>{formatAnalysisTime(turn.generatedAt)}</span>
                    </div>
                    <p style={{ whiteSpace: 'pre-wrap' }}>{turn.answer}</p>
                  </div>
                </div>
              ))
            ) : (
              <p className="status-message">選取左側對話，或直接輸入新問題開始。</p>
            )}
          </div>

          <div className="analysis-chat-composer">
            <label className="form-field" style={{ gridColumn: '1 / -1' }}>
              <span>問題</span>
              <textarea
                value={analysisQuestion}
                onChange={(event) => {
                  const nextValue = event.target.value;
                  onAnalysisQuestionChange((current) => ({
                    ...current,
                    general_question: nextValue,
                  }));
                  onFollowUpQuestionChange((current) => ({
                    ...current,
                    general_question: nextValue,
                  }));
                }}
                placeholder="輸入問題後送出"
                rows={3}
                disabled={isAnalyzing}
              />
            </label>

            <div className="analysis-chat-input-row">
              <button
                className="button button-primary"
                type="button"
                onClick={handleSend}
                disabled={!analysisQuestion.trim() || !canAnalyze || isAnalyzing}
              >
                {isAnalyzing ? '送出中...' : activeConversationTurns.length > 0 ? '繼續追問' : '送出問題'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
