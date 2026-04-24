import {
  onSnapshot,
  serverTimestamp,
  setDoc,
  Timestamp,
} from 'firebase/firestore';

import type { AnalysisPromptSettings } from '../../types/portfolio';
import { hasFirebaseConfig, missingFirebaseEnvKeys } from './client';
import { getSharedAnalysisSettingsDocRef } from './sharedPortfolio';

function createMissingConfigError() {
  return new Error(`Missing Firebase env vars: ${missingFirebaseEnvKeys.join(', ')}`);
}

function normalizePromptValue(value: unknown, fallback: string) {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function formatTimestamp(value: unknown) {
  if (value instanceof Timestamp) {
    return value.toDate().toISOString();
  }

  return typeof value === 'string' ? value : '';
}

const LEGACY_ANALYSIS_PROMPTS = {
  asset_analysis: '根據我目前資產，分析一下而家最值得留意嘅重點。',
  general_question: '根據我目前組合，直接回答我接住落嚟提出嘅問題。',
  asset_report: '請根據我目前資產整理一份清晰嘅資產報告，列出重點持倉、風險與跟進項目。',
} as const;

export function getDefaultAnalysisPromptSettings(): AnalysisPromptSettings {
  return {
    asset_analysis: [
      '你是每月資產分析助手，定位是監察、告警、下月行動。',
      '系統會在正文前顯示結構化「資產分佈總覽」圖像卡；你不要生成圖表、表格或圖表資料，也不要逐項重覆卡片上的百分比分布。',
      '你只需要承接系統提供的分佈判讀、持倉與快照對比，寫出短而準的文字結論。',
      '固定輸出欄目，並按順序使用以下標題：',
      '1. 【本月一句總結】',
      '2. 【本月資產變化摘要】',
      '3. 【組合健康檢查】',
      '4. 【三個重點觀察】',
      '5. 【下月行動建議】',
      '每段要引用可核對的持倉、變化或風險；如果資料不足，要直說，不要猜測外部市場消息。',
    ].join('\n'),
    general_question: [
      '你是投資組合對話助手，請直接回答我當次提出的問題。',
      '回答時要優先根據我目前的資產、帳戶、幣別、現金與走勢資料作答。',
      '如果問題與目前持倉直接相關，請引用組合內具體數字或結構去說明。',
      '如果問題屬於判斷或比較題，請先給結論，再給理由，最後補一句實際建議。',
      '避免將所有回答都寫成長篇報告；除非我要求詳細，否則請保持精煉、清楚、可操作。',
      '如果問題超出現有資料範圍，請先講清楚你基於哪些已知資料回答，哪些部分無法確定。',
    ].join('\n'),
    asset_report: [
      '你是季度資產報告撰寫助手，定位是季度總結、歸因、正式歸檔。',
      '系統會在正文前顯示結構化「資產分佈總覽」圖像卡；你不要生成圖表、表格或圖表資料，也不要逐項重覆卡片上的百分比分布。',
      '你只需要承接系統提供的分佈判讀、季度對比、趨勢與外部背景，寫成可歸檔的正式文字。',
      '固定輸出欄目，並按順序使用以下標題：',
      '1. 【管理層摘要】',
      '2. 【季度總覽】',
      '3. 【資產配置分佈】',
      '4. 【幣別曝險】',
      '5. 【重點持倉分析】',
      '6. 【季度對比摘要】',
      '7. 【主要風險與集中度】',
      '8. 【下季觀察重點】',
      '寫作要短而準，避免空泛投資常識；如果資料不足，要直說。',
    ].join('\n'),
  };
}

function resolvePromptValue(
  value: unknown,
  fallback: string,
  legacyValue: string,
) {
  const normalized = normalizePromptValue(value, fallback);

  if (normalized === legacyValue) {
    return fallback;
  }

  return normalized;
}

function normalizeAnalysisPromptSettings(
  value: Record<string, unknown> | null,
): AnalysisPromptSettings {
  const defaults = getDefaultAnalysisPromptSettings();

  return {
    asset_analysis: resolvePromptValue(
      value?.asset_analysis,
      defaults.asset_analysis,
      LEGACY_ANALYSIS_PROMPTS.asset_analysis,
    ),
    general_question: resolvePromptValue(
      value?.general_question,
      defaults.general_question,
      LEGACY_ANALYSIS_PROMPTS.general_question,
    ),
    asset_report: resolvePromptValue(
      value?.asset_report,
      defaults.asset_report,
      LEGACY_ANALYSIS_PROMPTS.asset_report,
    ),
    updatedAt: formatTimestamp(value?.updatedAt),
  };
}

export function getAnalysisSettingsErrorMessage(error?: unknown) {
  if (!hasFirebaseConfig) {
    return `Firebase 尚未設定完成，請先填入 .env.local 或 .env 內的設定值：${missingFirebaseEnvKeys.join(', ')}`;
  }

  if (error instanceof Error) {
    if (error.message.includes('permission-denied')) {
      return 'Firestore 權限被拒絕，請確認 rules 已容許共享投資組合讀寫 `portfolio/app/analysisSettings`。';
    }

    return error.message;
  }

  return '讀取或寫入 Prompt 設定失敗，請稍後再試。';
}

export function subscribeToAnalysisPromptSettings(
  onData: (settings: AnalysisPromptSettings) => void,
  onError: (error: unknown) => void,
) {
  if (!hasFirebaseConfig) {
    throw createMissingConfigError();
  }

  const settingsRef = getSharedAnalysisSettingsDocRef();

  return onSnapshot(
    settingsRef,
    (snapshot) => {
      onData(
        normalizeAnalysisPromptSettings(
          snapshot.exists() ? (snapshot.data() as Record<string, unknown>) : null,
        ),
      );
    },
    onError,
  );
}

export async function saveAnalysisPromptSettings(settings: AnalysisPromptSettings) {
  if (!hasFirebaseConfig) {
    throw createMissingConfigError();
  }

  const settingsRef = getSharedAnalysisSettingsDocRef();

  await setDoc(
    settingsRef,
    {
      asset_analysis: settings.asset_analysis.trim(),
      general_question: settings.general_question.trim(),
      asset_report: settings.asset_report.trim(),
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
}
