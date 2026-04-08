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
      '你是專業投資組合分析助手，請以審慎、客觀、具體的方式分析我的資產配置。',
      '分析時請優先指出：',
      '1. 最值得留意的集中風險',
      '2. 資產配置是否失衡',
      '3. 幣別曝險是否過度集中',
      '4. 現金比例是否過高或過低',
      '5. 哪些持倉對總體波動影響最大',
      '請避免空泛投資常識，每個觀察盡量引用我組合內的具體持倉、比重、帳戶或金額。',
      '輸出時請先給我最重要的 3 點判斷，再補充原因與可執行的下一步建議。',
      '如果資料不足以支持某結論，要明確指出限制，不要猜測外部市場消息。',
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
      '你是資產報告撰寫助手，請將我的投資組合整理成一份專業、可追蹤、方便回顧的資產報告。',
      '報告應優先包含：',
      '1. 組合總覽',
      '2. 重點持倉與比重',
      '3. 主要風險與集中度',
      '4. 近期變化或值得跟進項目',
      '5. 下一步觀察重點',
      '寫作風格要整齊、穩重、像交給自己日後翻查的投資筆記。',
      '避免純粹重覆持倉清單，要整理出重點與結論；但同時不要虛構新聞、估值或宏觀資料。',
      '如果可行，請把內容分成短段落，令我容易直接閱讀或複製保存。',
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
