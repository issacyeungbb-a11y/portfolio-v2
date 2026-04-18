import {
  addDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  increment,
  serverTimestamp,
  Timestamp,
  updateDoc,
} from 'firebase/firestore';

import { hasFirebaseConfig, missingFirebaseEnvKeys } from './client';
import {
  getSharedAnalysisThreadTurnsCollectionRef,
  getSharedAnalysisThreadsCollectionRef,
} from './sharedPortfolio';

export type AnalysisThreadCategory = 'general_question';
export type AnalysisThreadProvider = 'google' | 'anthropic';

export interface AnalysisThread {
  id: string;
  title: string;
  category: AnalysisThreadCategory;
  turnCount: number;
  lastQuestion: string;
  lastModel: string;
  provider: AnalysisThreadProvider;
  snapshotHash: string;
  createdAt: string;
  updatedAt: string;
}

export interface AnalysisThreadTurn {
  id: string;
  question: string;
  answer: string;
  model: string;
  provider: AnalysisThreadProvider;
  snapshotHash: string;
  generatedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAnalysisThreadTurnInput {
  title: string;
  question: string;
  answer: string;
  model: string;
  provider?: AnalysisThreadProvider;
  snapshotHash: string;
  generatedAt: string;
}

export interface AppendAnalysisThreadTurnInput {
  question: string;
  answer: string;
  model: string;
  provider?: AnalysisThreadProvider;
  snapshotHash: string;
  generatedAt: string;
}

function createMissingConfigError() {
  return new Error(`Missing Firebase env vars: ${missingFirebaseEnvKeys.join(', ')}`);
}

function formatTimestamp(value: unknown) {
  if (value instanceof Timestamp) {
    return value.toDate().toISOString();
  }

  return typeof value === 'string' ? value : '';
}

function sanitizeString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeThread(
  id: string,
  value: Record<string, unknown>,
): AnalysisThread {
  return {
    id,
    title: sanitizeString(value.title) || '未命名對話',
    category: 'general_question',
    turnCount: typeof value.turnCount === 'number' ? value.turnCount : 0,
    lastQuestion: sanitizeString(value.lastQuestion),
    lastModel: sanitizeString(value.lastModel),
    provider: value.provider === 'anthropic' ? 'anthropic' : 'google',
    snapshotHash: sanitizeString(value.snapshotHash),
    createdAt: formatTimestamp(value.createdAt),
    updatedAt: formatTimestamp(value.updatedAt),
  };
}

function normalizeTurn(
  id: string,
  value: Record<string, unknown>,
): AnalysisThreadTurn {
  return {
    id,
    question: sanitizeString(value.question),
    answer: sanitizeString(value.answer),
    model: sanitizeString(value.model),
    provider: value.provider === 'anthropic' ? 'anthropic' : 'google',
    snapshotHash: sanitizeString(value.snapshotHash),
    generatedAt: formatTimestamp(value.generatedAt),
    createdAt: formatTimestamp(value.createdAt),
    updatedAt: formatTimestamp(value.updatedAt),
  };
}

export function getAnalysisThreadsErrorMessage(error?: unknown) {
  if (!hasFirebaseConfig) {
    return `Firebase 尚未設定完成，請先填入 .env.local 或 .env 內的設定值：${missingFirebaseEnvKeys.join(', ')}`;
  }

  if (error instanceof Error) {
    if (error.message.includes('permission-denied')) {
      return 'Firestore 權限被拒絕，請確認 rules 已容許共享投資組合讀寫 `portfolio/app/analysisThreads`。';
    }

    return error.message;
  }

  return '讀取或寫入對話串失敗，請稍後再試。';
}

export function subscribeToAnalysisThreads(
  onData: (entries: AnalysisThread[]) => void,
  onError: (error: unknown) => void,
) {
  if (!hasFirebaseConfig) {
    throw createMissingConfigError();
  }

  const threadsQuery = query(getSharedAnalysisThreadsCollectionRef(), orderBy('updatedAt', 'desc'));

  return onSnapshot(
    threadsQuery,
    (snapshot) => {
      onData(snapshot.docs.map((entry) => normalizeThread(entry.id, entry.data() as Record<string, unknown>)));
    },
    onError,
  );
}

export function subscribeToAnalysisThreadTurns(
  threadId: string,
  onData: (entries: AnalysisThreadTurn[]) => void,
  onError: (error: unknown) => void,
) {
  if (!hasFirebaseConfig) {
    throw createMissingConfigError();
  }

  const turnsQuery = query(getSharedAnalysisThreadTurnsCollectionRef(threadId), orderBy('createdAt', 'asc'));

  return onSnapshot(
    turnsQuery,
    (snapshot) => {
      onData(snapshot.docs.map((entry) => normalizeTurn(entry.id, entry.data() as Record<string, unknown>)));
    },
    onError,
  );
}

export async function createAnalysisThreadWithTurn(input: CreateAnalysisThreadTurnInput) {
  if (!hasFirebaseConfig) {
    throw createMissingConfigError();
  }

  const threadRef = await addDoc(getSharedAnalysisThreadsCollectionRef(), {
    title: input.title.trim() || '未命名對話',
    category: 'general_question',
    turnCount: 1,
    lastQuestion: input.question.trim(),
    lastModel: input.model,
    provider: input.provider ?? 'google',
    snapshotHash: input.snapshotHash,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  await addDoc(getSharedAnalysisThreadTurnsCollectionRef(threadRef.id), {
    question: input.question.trim(),
    answer: input.answer.trim(),
    model: input.model,
    provider: input.provider ?? 'google',
    snapshotHash: input.snapshotHash,
    generatedAt: input.generatedAt,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  return threadRef.id;
}

export async function appendAnalysisThreadTurn(threadId: string, input: AppendAnalysisThreadTurnInput) {
  if (!hasFirebaseConfig) {
    throw createMissingConfigError();
  }

  const threadRef = doc(getSharedAnalysisThreadsCollectionRef(), threadId);

  await addDoc(getSharedAnalysisThreadTurnsCollectionRef(threadId), {
    question: input.question.trim(),
    answer: input.answer.trim(),
    model: input.model,
    provider: input.provider ?? 'google',
    snapshotHash: input.snapshotHash,
    generatedAt: input.generatedAt,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  await updateDoc(threadRef, {
    turnCount: increment(1),
    lastQuestion: input.question.trim(),
    lastModel: input.model,
    provider: input.provider ?? 'google',
    snapshotHash: input.snapshotHash,
    updatedAt: serverTimestamp(),
  });
}
