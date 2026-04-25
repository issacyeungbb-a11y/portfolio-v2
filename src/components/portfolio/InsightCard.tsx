import { getInsightToneLabel } from '../../data/mockPortfolio';
import { DataCard } from '../ui/DesignSystem';
import type { Insight } from '../../types/portfolio';

interface InsightCardProps {
  insight: Insight;
}

export function InsightCard({ insight }: InsightCardProps) {
  return (
    <DataCard className="insight-card" tone={insight.tone}>
      <div className="insight-header">
        <span className="chip chip-soft">{getInsightToneLabel(insight.tone)}</span>
        <h3>{insight.title}</h3>
      </div>
      <p>{insight.summary}</p>
    </DataCard>
  );
}
