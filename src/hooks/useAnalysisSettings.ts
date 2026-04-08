import { useEffect, useState } from 'react';

import type { AnalysisPromptSettings } from '../types/portfolio';
import {
  getAnalysisSettingsErrorMessage,
  getDefaultAnalysisPromptSettings,
  saveAnalysisPromptSettings,
  subscribeToAnalysisPromptSettings,
} from '../lib/firebase/analysisSettings';

type AnalysisSettingsStatus = 'idle' | 'loading' | 'ready' | 'error';

export function useAnalysisSettings() {
  const [status, setStatus] = useState<AnalysisSettingsStatus>('loading');
  const [settings, setSettings] = useState<AnalysisPromptSettings>(getDefaultAnalysisPromptSettings());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setStatus('loading');
    setError(null);

    const unsubscribe = subscribeToAnalysisPromptSettings(
      (nextSettings) => {
        setSettings(nextSettings);
        setStatus('ready');
        setError(null);
      },
      (nextError) => {
        setSettings(getDefaultAnalysisPromptSettings());
        setStatus('error');
        setError(getAnalysisSettingsErrorMessage(nextError));
      },
    );

    return unsubscribe;
  }, []);

  async function persistSettings(nextSettings: AnalysisPromptSettings) {
    try {
      await saveAnalysisPromptSettings(nextSettings);
      setSettings(nextSettings);
      setStatus('ready');
      setError(null);
    } catch (nextError) {
      const message = getAnalysisSettingsErrorMessage(nextError);
      setError(message);
      throw new Error(message);
    }
  }

  return {
    status,
    settings,
    error,
    persistSettings,
  };
}
