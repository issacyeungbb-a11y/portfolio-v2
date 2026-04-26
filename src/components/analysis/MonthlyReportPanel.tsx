import { EmptyState } from '../ui/EmptyState';
import { ReportAllocationSummaryCard } from '../portfolio/ReportAllocationSummaryCard';
import type { AnalysisSession, DisplayCurrency } from '../../types/portfolio';
import { splitParagraphs, splitReportIntoSections } from '../../lib/portfolio/quarterlyReportPdf';

interface MonthlyReportPanelProps {
  monthlyAnalysisSessions: AnalysisSession[];
  selectedMonthlyAnalysisId: string | null;
  expandedMonthlyAnalysisId: string | null;
  displayCurrency: DisplayCurrency;
  canGenerateCurrentMonthAnalysis: boolean;
  generatingPeriodicReport: 'monthly' | 'quarterly' | null;
  onGenerateMonthlyAnalysisReport: () => void;
  onSelectedMonthlyAnalysisIdChange: (id: string) => void;
  onExpandedMonthlyAnalysisIdChange: (id: string) => void;
  onOpenSettings: () => void;
  onSwitchToGeneralQuestion: () => void;
  formatGeneratedAt: (value: string) => string;
  getAnalysisModelLabel: (model: string) => string;
}

export function MonthlyReportPanel({
  monthlyAnalysisSessions,
  selectedMonthlyAnalysisId,
  expandedMonthlyAnalysisId,
  displayCurrency,
  canGenerateCurrentMonthAnalysis,
  generatingPeriodicReport,
  onGenerateMonthlyAnalysisReport,
  onSelectedMonthlyAnalysisIdChange,
  onExpandedMonthlyAnalysisIdChange,
  onOpenSettings,
  onSwitchToGeneralQuestion,
  formatGeneratedAt,
  getAnalysisModelLabel,
}: MonthlyReportPanelProps) {
  return (
    <section className="card quarterly-list-card">
      <div className="section-heading">
        <div>
          <h2>歷史記錄</h2>
          <p className="table-hint">每月資產分析</p>
        </div>
        <span className="chip chip-soft">
          {monthlyAnalysisSessions.length > 0 ? `${monthlyAnalysisSessions.length} 份分析` : '尚未生成'}
        </span>
      </div>

      {monthlyAnalysisSessions.length === 0 ? (
        <EmptyState
          title="尚未生成每月分析"
          reason={
            canGenerateCurrentMonthAnalysis
              ? '可以立即生成第一份每月資產分析。'
              : '未到每月生成時段，暫時未有可用的月報。'
          }
          primaryAction={
            canGenerateCurrentMonthAnalysis ? (
              <button
                className="button button-primary"
                type="button"
                onClick={onGenerateMonthlyAnalysisReport}
                disabled={generatingPeriodicReport === 'monthly'}
              >
                {generatingPeriodicReport === 'monthly' ? '生成中...' : '生成本月分析'}
              </button>
            ) : (
              <button
                className="button button-secondary"
                type="button"
                onClick={onOpenSettings}
              >
                檢視分析設定
              </button>
            )
          }
          secondaryAction={
            <button
              className="button button-secondary"
              type="button"
              onClick={onSwitchToGeneralQuestion}
            >
              切換至一般問題
            </button>
          }
        />
      ) : (
        <div className="quarterly-report-list">
          {monthlyAnalysisSessions.map((session) => {
            const isSelected = session.id === selectedMonthlyAnalysisId;
            const isExpanded = expandedMonthlyAnalysisId === session.id;
            return (
              <article
                key={session.id}
                className={isSelected ? 'quarterly-report-row active' : 'quarterly-report-row'}
              >
                <button
                  type="button"
                  className="quarterly-report-row-main"
                  onClick={() => {
                    onSelectedMonthlyAnalysisIdChange(session.id);
                    onExpandedMonthlyAnalysisIdChange(session.id);
                  }}
                >
                  <div>
                    <strong>{session.title}</strong>
                    <p>{formatGeneratedAt(session.updatedAt)}</p>
                  </div>
                  <span className="table-hint">{getAnalysisModelLabel(session.model)}</span>
                </button>
                {isExpanded ? (
                  <div className="analysis-report-body">
                    <div className="quarterly-report-body">
                      {splitReportIntoSections(session.result).map((section, sectionIndex) => (
                        <section
                          key={`${session.id}-${sectionIndex}`}
                          className="quarterly-report-section"
                        >
                          {section.title ? <h3>{section.title}</h3> : null}
                          {splitParagraphs(section.body).map((paragraph, paragraphIndex) => (
                            <p key={`${session.id}-${sectionIndex}-${paragraphIndex}`}>{paragraph}</p>
                          ))}
                        </section>
                      ))}
                    </div>
                    <details className="report-disclosure">
                      <summary>查看報告基準資產分佈</summary>
                      <ReportAllocationSummaryCard
                        summary={session.allocationSummary}
                        displayCurrency={displayCurrency}
                      />
                    </details>
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
