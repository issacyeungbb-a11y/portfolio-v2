import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import type { StatusBadgeTone } from '../components/ui/StatusBadge';

export interface TopBarMetaItem {
  label: string;
  value: string;
  compact?: boolean;
}

export interface TopBarStatusItem {
  label: string;
  tone?: StatusBadgeTone;
  title?: string;
}

export interface TopBarConfig {
  title: string;
  subtitle: string;
  metaItems?: TopBarMetaItem[];
  statusItems?: TopBarStatusItem[];
  actions?: ReactNode;
}

interface TopBarContextValue {
  config: TopBarConfig | null;
  setConfig: (config: TopBarConfig | null) => void;
}

const TopBarContext = createContext<TopBarContextValue | null>(null);

export function TopBarProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<TopBarConfig | null>(null);

  const value = useMemo(
    () => ({
      config,
      setConfig,
    }),
    [config],
  );

  return <TopBarContext.Provider value={value}>{children}</TopBarContext.Provider>;
}

export function useTopBar(config: TopBarConfig | null) {
  const context = useContext(TopBarContext);

  useEffect(() => {
    if (!context) {
      return;
    }

    context.setConfig(config);

    return () => {
      context.setConfig(null);
    };
  }, [context, config]);
}

export function useTopBarState() {
  const context = useContext(TopBarContext);

  if (!context) {
    throw new Error('useTopBarState must be used within TopBarProvider');
  }

  return context;
}
