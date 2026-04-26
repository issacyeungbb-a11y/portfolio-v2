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
  return (
    <section className="card analysis-thread-card">
      <div className="section-heading">
        <div>
          <h2>對話</h2>
          <p className="table-hint">輸入問題、查看目前 thread 與過往對話。</p>
        </div>
        <div className="analysis-thread-header-actions">
          <span className="chip chip-soft">{conversationArchiveSessions.length} 條對話</span>
        </div>
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
            className="button button-secondary"
            type="button"
            onClick={() => {
              onSelectedSessionIdChange(null);
              onAnalysisQuestionChange((current) => ({ ...current, general_question: '' }));
              onFollowUpQuestionChange((current) => ({ ...current, general_question: '' }));
            }}
          >
            新對話
          </button>
          <button
            className="button button-primary"
            type="button"
            onClick={() => {
              if (activeConversationTurns.length > 0) {
                onFollowUp();
                return;
              }

              onAnalyze();
            }}
            disabled={!analysisQuestion.trim() || !canAnalyze || isAnalyzing}
          >
            {isAnalyzing ? '送出中...' : '送出問題'}
          </button>
        </div>
      </div>

      <div className="analysis-thread-layout">
        <aside className="analysis-thread-sidebar">
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
            <p className="status-message">尚未有對話。</p>
          )}
        </aside>

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
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}
