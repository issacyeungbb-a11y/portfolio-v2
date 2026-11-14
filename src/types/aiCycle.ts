// 人工智能週期訊號：由獨立的監察系統每週產生，投資組合只讀取、顯示及配對持倉。

export type AiCycleConfidence = 'LOW' | 'MEDIUM' | 'HIGH';
export type AiCyclePulseStatus = 'OK' | 'PARTIAL' | 'UNAVAILABLE';

export interface AiCycleIndex {
  score: number | null;
  weight_covered: number;
  pillars_used: string[];
  pillars_not_used: Array<{ code: string; label_zh: string; base_weight: number; reason_zh: string | null }>;
  null_reason_zh: string | null;
  change_2q: number | null;
  change_4q: number | null;
  momentum: string | null;
  formal_score: number | null;
  formal_status: string;
  formal_data_coverage: number;
  label_zh: string;
}

export interface AiCyclePillar {
  code: string;
  label_zh: string;
  base_weight: number;
  score: number | null;
  coverage: number;
  status: string;
  source_tier: number;
  used_in_provisional: boolean;
  not_used_reason_zh: string | null;
}

export interface AiCycleStance {
  code: string;
  label_zh: string;
  level: number | null;
  base_level: number | null;
  pulse_adjustment: number;
  confidence: AiCycleConfidence;
  confidence_zh: string;
  reasons_zh: string[];
  confidence_notes_zh: string[];
  caps_zh: string[];
}

export interface AiCyclePulse {
  status: AiCyclePulseStatus;
  as_of: string;
  basket: {
    ticker_count: number;
    as_of: string;
    median_return_4w: number | null;
    median_return_13w: number | null;
    median_drawdown_from_high: number | null;
    median_return_since_reference: number | null;
    reference_date: string;
    share_positive_13w: number | null;
  } | null;
  macro: Array<{ code: string; label_zh: string; unit: string; value: number; date: string; change_4w: number | null }>;
  flags: Array<{ code: string; label_zh: string }>;
  failures: Array<{ name: string }>;
  unavailable_reason_zh?: string;
}

export interface AiCycleFreshness {
  fundamentals_latest_period_end: string | null;
  fundamentals_latest_information_date: string | null;
  companies_total: number;
  companies_current: number;
  stale: boolean;
  stale_reason_zh: string | null;
  last_source_retrieved_at: string | null;
}

export interface AiCycleHistoryRow {
  as_of_date: string;
  period: string;
  ami: number | null;
  abri: number | null;
  ami_weight_covered: number;
  abri_weight_covered: number;
  candidate_state: string | null;
}

export interface AiCycleSignal {
  schema_version: 1;
  methodology_version: string;
  generated_at: string;
  as_of_date: string;
  latest_completed_quarter: string | null;
  ami: AiCycleIndex;
  abri: AiCycleIndex;
  cycle: {
    candidate_state: string | null;
    candidate_state_zh: string | null;
    consecutive_candidate_quarters: number;
    rules_triggered: string[];
    formal_status: string;
    basis: string;
  };
  stance: AiCycleStance;
  pillars: { ami: AiCyclePillar[]; abri: AiCyclePillar[] };
  pulse: AiCyclePulse;
  freshness: AiCycleFreshness;
  history: AiCycleHistoryRow[];
  coverage_universe: { company_count: number; note_zh: string };
  disclaimer_zh: string;
}

export interface AiCycleWeeklyRun {
  as_of_date: string;
  ami: number | null;
  abri: number | null;
  stance_level: number | null;
  stance_code: string;
  confidence: string;
  candidate_state: string | null;
  pulse_status: string;
  basket_median_return_13w: number | null;
  fundamentals_stale: boolean;
}

export type AiLayerCode = 'semiconductor' | 'infrastructure' | 'cloud' | 'application' | 'fund' | 'other' | 'none';

export interface AiLayerOption {
  code: AiLayerCode;
  label: string;
}

export interface AiExposureHolding {
  id: string;
  symbol: string;
  name: string;
  assetType: string;
  accountSource: string;
  valueHKD: number;
  shareOfTotal: number;
  layer: AiLayerCode;
  layerLabel: string;
  classifiedBy: 'default' | 'override' | 'unclassified';
  monitored: boolean;
}

export interface AiExposure {
  totalValueHKD: number;
  aiValueHKD: number;
  aiShare: number;
  fxSource: 'persisted' | 'default';
  layers: Array<{ code: AiLayerCode; label: string; valueHKD: number; shareOfTotal: number; shareOfAi: number; count: number }>;
  holdings: AiExposureHolding[];
  candidates: AiExposureHolding[];
  monitoredCount: number;
  unmonitoredCount: number;
}

export interface AiCycleGuidanceItem {
  tone: 'positive' | 'neutral' | 'caution' | 'danger';
  title: string;
  text: string;
}

export interface AiCycleAnalysis {
  text: string;
  model: string;
  generatedAt: string;
  signalAsOf: string;
  question: string;
}

export interface AiCycleMeta {
  source: 'live' | 'stored' | 'baseline';
  fetchedAt: string | null;
  signalAgeDays: number;
  overdue: boolean;
  tokenConfigured: boolean;
  lastFetchError: string | null;
}

export interface AiCycleResponse {
  ok: true;
  signal: AiCycleSignal;
  weeklyRuns: AiCycleWeeklyRun[];
  meta: AiCycleMeta;
  exposure: AiExposure;
  guidance: AiCycleGuidanceItem[];
  overrides: Record<string, AiLayerCode>;
  layerOptions: AiLayerOption[];
  analysis: AiCycleAnalysis | null;
}
