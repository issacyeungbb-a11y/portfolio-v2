import type { Dispatch, SetStateAction } from 'react';

import type { AnalysisPromptSettings } from '../../types/portfolio';

interface AnalysisSettingsModalProps {
  promptDrafts: AnalysisPromptSettings;
  isSavingPromptSettings: boolean;
  onClose: () => void;
  onPromptDraftsChange: Dispatch<SetStateAction<AnalysisPromptSettings>>;
  onSave: () => void;
}

export function AnalysisSettingsModal({
  promptDrafts,
  isSavingPromptSettings,
  onClose,
  onPromptDraftsChange,
  onSave,
}: AnalysisSettingsModalProps) {
  return (
    <div
      className="modal-backdrop analysis-settings-modal"
      role="dialog"
      aria-modal="true"
      aria-label="一般問題分析設定"
      onClick={onClose}
    >
      <section className="modal-card modal-card-wide analysis-settings-card" onClick={(event) => event.stopPropagation()}>
        <div className="section-heading">
          <div>
            <h2>一般問題分析設定</h2>
            <p className="table-hint">只影響一般問題對話，不會改變每月資產分析或季度投資報告。</p>
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
          <h2>對話背景</h2>
          <p className="status-message">
            這裡保存的背景內容只會帶入「一般問題」模式。
          </p>
          <p className="table-hint">
            每月資產分析與季度投資報告會沿用各自的固定報告設定，不受此處文字影響。
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
