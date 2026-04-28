import { EmptyState } from '../ui/EmptyState';
import { ReportAllocationSummaryCard } from '../portfolio/ReportAllocationSummaryCard';
import type { AnalysisSession, DisplayCurrency } from '../../types/portfolio';
import { splitParagraphs, splitReportIntoSections } from '../../lib/portfolio/quarterlyReportPdf';

interface MonthlyReportPanelProps {
  monthlyAnalysisSessions: AnalysisSession[];
  selectedMonthlyAnalysisId: string | null;
  expandedMonthlyAnalysisId: string | null;
  displayCurrency: DisplayCurrency;
  assetCount: number;
  baseCurrency: string;
  canGenerateCurrentMonthAnalysis: boolean;
  generatingPeriodicReport: 'monthly' | 'quarterly' | null;
  onGenerateMonthlyAnalysisReport: () => void;
  onSelectedMonthlyAnalysisIdChange: (id: string) => void;
  onExpandedMonthlyAnalysisIdChange: (id: string) => void;
  onOpenSettings: () => void;
  onSwitchToGeneralQuestion: () => void;
  onCopyReport: () => void;
  formatGeneratedAt: (value: string) => string;
  getAnalysisModelLabel: (model: string) => string;
}

export function MonthlyReportPanel({
  monthlyAnalysisSessions,
  selectedMonthlyAnalysisId,
  displayCurrency,
  assetCount,
  baseCurrency,
  canGenerateCurrentMonthAnalysis,
  generatingPeriodicReport,
  onGenerateMonthlyAnalysisReport,
  onSelectedMonthlyAnalysisIdChange,
  onExpandedMonthlyAnalysisIdChange,
  onOpenSettings,
  onSwitchToGeneralQuestion,
  onCopyReport,
  formatGeneratedAt,
  getAnalysisModelLabel,
}: MonthlyReportPanelProps) {
  const selectedMonthlyAnalysis =
    monthlyAnalysisSessions.find((session) => session.id === selectedMonthlyAnalysisId) ??
    monthlyAnalysisSessions[0] ??
    null;

  return (
    <div className="analysis-workbench-layout">
      <section className="card quarterly-viewer-card analysis-report-main-card">
        {selectedMonthlyAnalysis ? (
          <>
            <div className="analysis-report-header">
              <div>
                <p className="eyebrow">Monthly Analysis</p>
                <h2>{selectedMonthlyAnalysis.title}</h2>
                <div className="analysis-report-meta-strip" aria-label="月報摘要">
                  <span>月份：{selectedMonthlyAnalysis.title.replace(/每月資產分析$/, '')}</span>
                  <span>生成：{formatGeneratedAt(selectedMonthlyAnalysis.updatedAt)}</span>
                  <span>模型：{getAnalysisModelLabel(selectedMonthlyAnalysis.model)}</span>
                  <span>資產：{assetCount} 項</span>
                  <span>基準：{baseCurrency}</span>
                </div>
              </div>
              <div className="analysis-report-actions">
                <button className="button button-secondary" type="button" onClick={onCopyReport}>
                  複製內容
                </button>
                {canGenerateCurrentMonthAnalysis ? (
                  <button
                    className="button button-primary"
                    type="button"
                    onClick={onGenerateMonthlyAnalysisReport}
                    disabled={generatingPeriodicReport === 'monthly'}
                  >
                    {generatingPeriodicReport === 'monthly' ? '生成中...' : '生成本月分析'}
                  </button>
                ) : null}
              </div>
            </div>

            <ReportAllocationSummaryCard
              summary={selectedMonthlyAnalysis.allocationSummary}
              displayCurrency={displayCurrency}
              className="report-allocation-summary-card-compact"
            />

            <div className="quarterly-report-body">
              {splitReportIntoSections(selectedMonthlyAnalysis.result).map((section, sectionIndex) => (
                <section
                  key={`${selectedMonthlyAnalysis.id}-${sectionIndex}`}
                  className="quarterly-report-section"
                >
                  {section.title ? <h3>{section.title}</h3> : null}
                  {splitParagraphs(section.body).map((paragraph, paragraphIndex) => (
                    <p key={`${selectedMonthlyAnalysis.id}-${sectionIndex}-${paragraphIndex}`}>{paragraph}</p>
                  ))}
                </section>
              ))}
            </div>
          </>
        ) : (
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
                <button className="button button-secondary" type="button" onClick={onOpenSettings}>
                  檢視一般問題設定
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
        )}
      </section>

      <aside className="card quarterly-list-card analysis-history-panel">
        <div className="section-heading">
          <div>
            <h2>歷史月報</h2>
            <p className="table-hint">每月資產分析記錄</p>
          </div>
          <span className="chip chip-soft">
            {monthlyAnalysisSessions.length > 0 ? `${monthlyAnalysisSessions.length} 份` : '尚未生成'}
          </span>
        </div>

        {monthlyAnalysisSessions.length > 0 ? (
          <div className="quarterly-report-list">
            {monthlyAnalysisSessions.map((session) => {
              const isSelected = session.id === selectedMonthlyAnalysis?.id;
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
                </article>
              );
            })}
          </div>
        ) : (
          <div className="button-row">
            <button
              className="button button-secondary"
              type="button"
              onClick={onSwitchToGeneralQuestion}
            >
              切換至一般問題
            </button>
          </div>
        )}
      </aside>
    </div>
  );
}
