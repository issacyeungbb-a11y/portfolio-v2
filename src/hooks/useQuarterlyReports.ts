import { useEffect, useState } from 'react';

import {
  getQuarterlyReportsErrorMessage,
  subscribeToQuarterlyReports,
  type QuarterlyReport,
} from '../lib/firebase/quarterlyReports';

interface QuarterlyReportsState {
  status: 'loading' | 'ready' | 'error';
  entries: QuarterlyReport[];
  error: string | null;
}

export function useQuarterlyReports() {
  const [state, setState] = useState<QuarterlyReportsState>({
    status: 'loading',
    entries: [],
    error: null,
  });

  useEffect(() => {
    const unsubscribe = subscribeToQuarterlyReports(
      (entries) => setState({ status: 'ready', entries, error: null }),
      (error) => setState({
        status: 'error',
        entries: [],
        error: getQuarterlyReportsErrorMessage(error),
      }),
    );

    return unsubscribe;
  }, []);

  return state;
}
