import type { Dispatch, SetStateAction } from 'react';

import { EmptyState } from '../ui/EmptyState';
import { ReportAllocationSummaryCard } from '../portfolio/ReportAllocationSummaryCard';
import type { AnalysisCategory, DisplayCurrency } from '../../types/portfolio';
import type { QuarterlyReport } from '../../lib/firebase/quarterlyReports';
import { splitParagraphs, type ReportSection } from '../../lib/portfolio/quarterlyReportPdf';

interface ConversationTurn {
  question: string;
  answer: string;
  generatedAt: string;
  model: string;
}

interface QuarterlyReportPanelProps {
  reports: QuarterlyReport[];
  reportsStatus: 'loading' | 'ready' | 'error';
  selectedReport: QuarterlyReport | null;
  selectedReportId: string | null;
  selectedSections: ReportSection[];
  displayCurrency: DisplayCurrency;
  canGenerateCurrentQuarterReport: boolean;
  generatingPeriodicReport: 'monthly' | 'quarterly' | null;
  generatingReportId: string | null;
  selectedQuarterlyReportThreadExists: boolean;
  selectedQuarterlyThreadTurnsStatus: string;
  quarterlyActiveConversationTurns: ConversationTurn[];
  followUpQuestion: string;
  isAnalyzing: boolean;
  onGenerateQuarterlyReport: () => void;
  onGeneratePdf: (report: QuarterlyReport) => void;
  onSelectedReportIdChange: (id: string) => void;
  onOpenSettings: () => void;
  onSwitchToMonthly: () => void;
  onCopyReport: () => void;
  onFollowUpQuestionChange: Dispatch<SetStateAction<Record<AnalysisCategory, string>>>;
  onQuarterlyReportFollowUp: () => void;
  formatGeneratedAt: (value: string) => string;
  formatAnalysisTime: (value: string) => string;
  getAnalysisModelLabel: (model: string) => string;
}

export function QuarterlyReportPanel({
  reports,
  reportsStatus,
  selectedReport,
  selectedReportId,
  selectedSections,
  displayCurrency,
  canGenerateCurrentQuarterReport,
  generatingPeriodicReport,
  generatingReportId,
  selectedQuarterlyReportThreadExists,
  selectedQuarterlyThreadTurnsStatus,
  quarterlyActiveConversationTurns,
  followUpQuestion,
  isAnalyzing,
  onGenerateQuarterlyReport,
  onGeneratePdf,
  onSelectedReportIdChange,
  onOpenSettings,
  onSwitchToMonthly,
  onCopyReport,
  onFollowUpQuestionChange,
  onQuarterlyReportFollowUp,
  formatGeneratedAt,
  formatAnalysisTime,
  getAnalysisModelLabel,
}: QuarterlyReportPanelProps) {
  return (
    <div className="analysis-workbench-layout">
      <aside className="card quarterly-list-card analysis-history-panel">
        <div className="section-heading">
          <div>
            <h2>歷史季報</h2>
            <p className="table-hint">季度投資報告</p>
          </div>
          <span className="chip chip-soft">
            {reportsStatus === 'loading' ? '同步中' : `${reports.length} 份報告`}
          </span>
        </div>

        {reportsStatus === 'ready' && reports.length === 0 ? (
          <EmptyState
            title="尚未生成季度報告"
            reason="生成第一份季度報告後，這裡會列出歷史版本同 PDF 下載入口。"
            primaryAction={
              canGenerateCurrentQuarterReport ? (
                <button
                  className="button button-primary"
                  type="button"
                  onClick={onGenerateQuarterlyReport}
                  disabled={generatingPeriodicReport === 'quarterly'}
                >
                  {generatingPeriodicReport === 'quarterly' ? '生成中...' : '生成今季報告'}
                </button>
              ) : (
                <button
                  className="button button-secondary"
                  type="button"
                  onClick={onOpenSettings}
                >
                  檢視一般問題設定
                </button>
              )
            }
            secondaryAction={
              <button
                className="button button-secondary"
                type="button"
                onClick={onSwitchToMonthly}
              >
                切換至每月分析
              </button>
            }
          />
        ) : null}

        <div className="quarterly-report-list">
          {reports.map((report) => {
            const isSelected = report.id === selectedReportId;
            const isGenerating = generatingReportId === report.id;

            return (
              <article
                key={report.id}
                className={isSelected ? 'quarterly-report-row active' : 'quarterly-report-row'}
              >
                <button
                  type="button"
                  className="quarterly-report-row-main"
                  onClick={() => onSelectedReportIdChange(report.id)}
                >
                  <div>
                    <strong>{report.quarter}</strong>
                    <p>{formatGeneratedAt(report.generatedAt)}</p>
                  </div>
                  <span className="table-hint">
                    {report.provider ? `${report.provider} · ${report.model}` : report.model}
                  </span>
                </button>

                <div className="quarterly-report-actions">
                  {report.pdfUrl ? (
                    <a
                      className="button button-secondary"
                      href={report.pdfUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      下載 PDF
                    </a>
                  ) : (
                    <button
                      type="button"
                      className="button button-secondary"
                      onClick={() => onGeneratePdf(report)}
                      disabled={isGenerating}
                    >
                      {isGenerating ? '生成中...' : '生成 PDF'}
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </aside>

      {selectedReport ? (
        <main className="card quarterly-viewer-card analysis-report-main-card">
          <div className="analysis-report-header">
            <div>
              <p className="eyebrow">Quarterly Report</p>
              <h2>{selectedReport.quarter}</h2>
              <div className="analysis-report-meta-strip" aria-label="季報摘要">
                <span>季度：{selectedReport.quarter}</span>
                <span>生成：{formatGeneratedAt(selectedReport.generatedAt)}</span>
                <span>模型：{getAnalysisModelLabel(selectedReport.model)}</span>
                <span>PDF：{selectedReport.pdfUrl ? '已生成' : '未生成'}</span>
              </div>
            </div>
            <div className="analysis-report-actions">
              {selectedReport.pdfUrl ? (
                <a
                  className="button button-secondary"
                  href={selectedReport.pdfUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  下載 PDF
                </a>
              ) : (
                <button
                  type="button"
                  className="button button-secondary"
                  onClick={() => onGeneratePdf(selectedReport)}
                  disabled={generatingReportId === selectedReport.id}
                >
                  {generatingReportId === selectedReport.id ? '生成中...' : '生成 PDF'}
                </button>
              )}
              <button className="button button-secondary" type="button" onClick={onCopyReport}>
                複製內容
              </button>
              {canGenerateCurrentQuarterReport ? (
                <button
                  className="button button-primary"
                  type="button"
                  onClick={onGenerateQuarterlyReport}
                  disabled={generatingPeriodicReport === 'quarterly'}
                >
                  {generatingPeriodicReport === 'quarterly' ? '生成中...' : '生成今季報告'}
                </button>
              ) : null}
            </div>
          </div>

          <section className="analysis-report-section-block">
            <div className="section-heading">
              <div>
                <h3>報告基準資產分佈</h3>
                <p className="table-hint">此分佈是生成報告時保存的基準快照。</p>
              </div>
            </div>
            <ReportAllocationSummaryCard
              summary={selectedReport.allocationSummary}
              displayCurrency={displayCurrency}
              className="report-allocation-summary-card-compact"
            />
          </section>

          <section className="analysis-report-section-block">
            <div className="section-heading">
              <div>
                <h3>報告內容</h3>
              </div>
            </div>
          <div className="quarterly-report-body">
            {selectedSections.map((section, index) => (
              <section key={`${selectedReport.id}-${index}`} className="quarterly-report-section">
                {section.title ? <h3>{section.title}</h3> : null}
                {splitParagraphs(section.body).map((paragraph, paragraphIndex) => (
                  <p key={`${selectedReport.id}-${index}-${paragraphIndex}`}>{paragraph}</p>
                ))}
              </section>
            ))}
          </div>
          </section>
        </main>
      ) : null}

      {selectedReport ? (
        <section className="card analysis-thread-card analysis-follow-up-workspace">
          <div className="section-heading">
            <div>
              <h2>追問此報告</h2>
            </div>
            <span className="chip chip-soft">
              {selectedQuarterlyReportThreadExists
                ? `${selectedQuarterlyThreadTurnsStatus === 'loading' ? '讀取中' : `${quarterlyActiveConversationTurns.length} 輪`}`
                : '新 thread'}
            </span>
          </div>

          {quarterlyActiveConversationTurns.length > 0 ? (
            <div className="analysis-chat-thread">
              {quarterlyActiveConversationTurns.map((turn, index) => (
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
              ))}
            </div>
          ) : (
            <p className="status-message">尚未有追問紀錄，可直接在下方輸入。</p>
          )}

          <div className="analysis-chat-composer">
            <label className="form-field" style={{ gridColumn: '1 / -1' }}>
              <span>追問</span>
              <textarea
                value={followUpQuestion}
                onChange={(event) =>
                  onFollowUpQuestionChange((current) => ({
                    ...current,
                    asset_report: event.target.value,
                  }))
                }
                placeholder="例如：本季為何現金比例上升？哪一項持倉最值得減持？"
                rows={4}
                disabled={isAnalyzing}
              />
            </label>

            <div className="analysis-chat-input-row">
              <button
                className="button button-primary"
                type="button"
                onClick={onQuarterlyReportFollowUp}
                disabled={!selectedReport || !followUpQuestion.trim() || isAnalyzing}
              >
                {isAnalyzing ? '送出中...' : '送出'}
              </button>
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}
