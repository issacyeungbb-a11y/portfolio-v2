import { getInsightToneLabel } from '../../data/mockPortfolio';
import type { Insight } from '../../types/portfolio';

interface InsightCardProps {
  insight: Insight;
}

export function InsightCard({ insight }: InsightCardProps) {
  return (
    <article className="insight-card" data-tone={insight.tone}>
      <div className="insight-header">
        <span className="chip chip-soft">{getInsightToneLabel(insight.tone)}</span>
        <h3>{insight.title}</h3>
      </div>
      <p>{insight.summary}</p>
    </article>
  );
}
