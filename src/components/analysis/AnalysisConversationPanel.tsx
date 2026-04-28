import { useState, type Dispatch, type SetStateAction } from 'react';

import type { AnalysisCategory } from '../../types/portfolio';
import type { GeneralQuestionDataFreshness } from '../../types/portfolioAnalysis';

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
  onCopyLatestResponse: () => void;
  formatAnalysisTime: (value: string) => string;
  getAnalysisModelLabel: (model: string) => string;
  lastResponseMeta?: GeneralQuestionDataFreshness | null;
  lastResponseSources?: string[];
  lastResponseUncertainty?: string[];
  lastResponseActions?: string[];
}

function formatSearchAt(isoString?: string) {
  if (!isoString) return '';
  try {
    return new Intl.DateTimeFormat('zh-HK', {
      timeZone: 'Asia/Hong_Kong',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: 'numeric',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(isoString));
  } catch {
    return isoString;
  }
}

function DataFreshnessHint({ meta }: { meta: GeneralQuestionDataFreshness }) {
  if (!meta.hasExternalSearch || meta.externalSearchStatus === 'not_needed') {
    return (
      <p className="table-hint analysis-data-hint">
        本次回答只使用目前投資組合資料，未進行外部搜尋。
      </p>
    );
  }
  if (meta.externalSearchStatus === 'failed') {
    return (
      <p className="table-hint analysis-data-hint analysis-data-hint-warn">
        外部資料檢索失敗，本次回答只基於目前投資組合資料。
      </p>
    );
  }
  return (
    <p className="table-hint analysis-data-hint">
      本次回答已參考外部資料，資料檢索時間：{formatSearchAt(meta.externalSearchAt)}。
    </p>
  );
}

function LastResponseMeta({
  meta,
  sources,
  uncertainty,
  actions,
}: {
  meta: GeneralQuestionDataFreshness;
  sources: string[];
  uncertainty: string[];
  actions: string[];
}) {
  const [open, setOpen] = useState(false);
  const hasDetails = sources.length > 0 || uncertainty.length > 0 || actions.length > 0;

  return (
    <div className="analysis-response-meta">
      <div className="analysis-meta-row">
        <DataFreshnessHint meta={meta} />
        <span className="chip chip-soft">
          {[sources.length ? `${sources.length} 來源` : null, uncertainty.length ? `${uncertainty.length} 不確定` : null, actions.length ? `${actions.length} 跟進` : null]
            .filter(Boolean)
            .join(' · ') || '無額外事項'}
        </span>
      </div>
      {hasDetails ? (
        <details
          open={open}
          onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
          className="analysis-meta-details"
        >
          <summary className="analysis-meta-summary">資料來源、不確定性、建議跟進</summary>
          <div className="analysis-meta-body">
            {sources.length > 0 ? (
              <div className="analysis-meta-section">
                <p className="analysis-meta-label">外部資料來源</p>
                <ul>
                  {sources.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {uncertainty.length > 0 ? (
              <div className="analysis-meta-section">
                <p className="analysis-meta-label">資料不足或不確定之處</p>
                <ul>
                  {uncertainty.map((u, i) => (
                    <li key={i}>{u}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {actions.length > 0 ? (
              <div className="analysis-meta-section">
                <p className="analysis-meta-label">建議跟進事項</p>
                <ul>
                  {actions.map((a, i) => (
                    <li key={i}>{a}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </details>
      ) : null}
    </div>
  );
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
  onCopyLatestResponse,
  formatAnalysisTime,
  getAnalysisModelLabel,
  lastResponseMeta,
  lastResponseSources = [],
  lastResponseUncertainty = [],
  lastResponseActions = [],
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

  // Show meta only after the last AI turn (most recent response)
  const showMeta = Boolean(lastResponseMeta) && activeConversationTurns.length > 0;

  return (
    <section className="card analysis-thread-card">
      <div className="section-heading analysis-thread-heading">
        <div>
          <h2>一般問題工作區</h2>
          <p className="table-hint">右側聚焦 AI 回答與追問，歷史對話作為輔助資料。</p>
        </div>
        <button
          className="button button-secondary"
          type="button"
          onClick={onCopyLatestResponse}
          disabled={activeConversationTurns.length === 0}
        >
          複製最新回覆
        </button>
      </div>
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
              activeConversationTurns.map((turn, index) => {
                const isLast = index === activeConversationTurns.length - 1;
                return (
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
                    {isLast && showMeta && lastResponseMeta ? (
                      <LastResponseMeta
                        meta={lastResponseMeta}
                        sources={lastResponseSources}
                        uncertainty={lastResponseUncertainty}
                        actions={lastResponseActions}
                      />
                    ) : null}
                  </div>
                );
              })
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
