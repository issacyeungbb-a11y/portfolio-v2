import type { Dispatch, SetStateAction } from 'react';

import type { AnalysisCategory, AnalysisPromptSettings } from '../../types/portfolio';

interface AnalysisSettingsModalProps {
  selectedCategory: AnalysisCategory;
  promptDrafts: AnalysisPromptSettings;
  analysisQuestion: string;
  monthlyQuestionPlaceholder: string;
  isSavingPromptSettings: boolean;
  isAnalyzing: boolean;
  canAnalyze: boolean;
  onClose: () => void;
  onPromptDraftsChange: Dispatch<SetStateAction<AnalysisPromptSettings>>;
  onMonthlyQuestionChange: Dispatch<SetStateAction<Record<AnalysisCategory, string>>>;
  onAnalyze: () => void;
  onSave: () => void;
}

export function AnalysisSettingsModal({
  selectedCategory,
  promptDrafts,
  analysisQuestion,
  monthlyQuestionPlaceholder,
  isSavingPromptSettings,
  isAnalyzing,
  canAnalyze,
  onClose,
  onPromptDraftsChange,
  onMonthlyQuestionChange,
  onAnalyze,
  onSave,
}: AnalysisSettingsModalProps) {
  return (
    <div
      className="modal-backdrop analysis-settings-modal"
      role="dialog"
      aria-modal="true"
      aria-label="分析設定"
      onClick={onClose}
    >
      <section className="modal-card modal-card-wide analysis-settings-card" onClick={(event) => event.stopPropagation()}>
        <div className="section-heading">
          <div>
            <h2>分析設定</h2>
          </div>
          <button
            className="button button-secondary"
            type="button"
            onClick={onClose}
          >
            關閉
          </button>
        </div>

        <div className="analysis-category-intro">
          <h2>一般問題</h2>
          <p className="status-message">
            只可在網頁中設定一般問題的背景資料。
          </p>
          <p className="table-hint">
            每月資產分析與季度報告會沿用內部設定，無法在此頁面修改。
          </p>
        </div>

        <div className="asset-form-grid">
          <label className="form-field" style={{ gridColumn: '1 / -1' }}>
            <span>背景內容</span>
            <textarea
              value={promptDrafts.general_question}
              onChange={(event) =>
                onPromptDraftsChange((current) => ({
                  ...current,
                  general_question: event.target.value,
                }))
              }
              placeholder="輸入希望固定帶入的分析背景。"
              rows={5}
              disabled={isSavingPromptSettings}
            />
          </label>
        </div>

        {selectedCategory === 'asset_analysis' ? (
          <div className="analysis-advanced-panel">
            <div className="section-heading">
              <div>
                <h2>手動生成</h2>
              </div>
            </div>

            <div className="asset-form-grid">
              <label className="form-field" style={{ gridColumn: '1 / -1' }}>
                <span>分析重點</span>
                <textarea
                  value={analysisQuestion}
                  onChange={(event) =>
                    onMonthlyQuestionChange((current) => ({
                      ...current,
                      asset_analysis: event.target.value,
                    }))
                  }
                  placeholder={monthlyQuestionPlaceholder}
                  rows={4}
                  disabled={isAnalyzing}
                />
              </label>
            </div>

            <div className="button-row">
              <button
                className="button button-secondary"
                type="button"
                onClick={onAnalyze}
                disabled={!canAnalyze}
              >
                {isAnalyzing ? '生成中...' : '立即生成'}
              </button>
            </div>
          </div>
        ) : null}

        <div className="button-row">
          <button
            className="button button-primary"
            type="button"
            onClick={onSave}
            disabled={isSavingPromptSettings}
          >
            {isSavingPromptSettings ? '儲存中...' : '儲存設定'}
          </button>
        </div>
      </section>
    </div>
  );
}
