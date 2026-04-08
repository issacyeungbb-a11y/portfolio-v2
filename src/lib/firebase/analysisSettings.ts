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

export function getDefaultAnalysisPromptSettings(): AnalysisPromptSettings {
  return {
    asset_analysis: '根據我目前資產，分析一下而家最值得留意嘅重點。',
    general_question: '根據我目前組合，直接回答我接住落嚟提出嘅問題。',
    asset_report: '請根據我目前資產整理一份清晰嘅資產報告，列出重點持倉、風險與跟進項目。',
  };
}

function normalizeAnalysisPromptSettings(
  value: Record<string, unknown> | null,
): AnalysisPromptSettings {
  const defaults = getDefaultAnalysisPromptSettings();

  return {
    asset_analysis: normalizePromptValue(value?.asset_analysis, defaults.asset_analysis),
    general_question: normalizePromptValue(value?.general_question, defaults.general_question),
    asset_report: normalizePromptValue(value?.asset_report, defaults.asset_report),
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
