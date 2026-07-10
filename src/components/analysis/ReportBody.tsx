import type { ReportSection } from '../../lib/portfolio/quarterlyReportPdf';
import {
  isHeroReportSection,
  parseReportBlocks,
  stripSectionTitleBrackets,
  tokenizeReportText,
  type ReportBlock,
  type ReportListItem,
} from '../../lib/portfolio/reportRichText';

interface ReportBodyProps {
  sections: ReportSection[];
  keyPrefix: string;
}

function InlineText({ text }: { text: string }) {
  return (
    <>
      {tokenizeReportText(text).map((token, index) => {
        if (token.kind === 'text') {
          return <span key={index}>{token.text}</span>;
        }

        const toneClass =
          token.tone === 'positive'
            ? 'report-figure is-positive'
            : token.tone === 'negative'
              ? 'report-figure is-negative'
              : 'report-figure';

        return (
          <strong key={index} className={toneClass}>
            {token.text}
          </strong>
        );
      })}
    </>
  );
}

const ACTION_TONE_CLASS: Record<string, string> = {
  must: 'report-tone-badge tone-must',
  consider: 'report-tone-badge tone-consider',
  avoid: 'report-tone-badge tone-avoid',
};

function ListItemContent({ item }: { item: ReportListItem }) {
  const hasLabelledFlow =
    item.segments.length > 1 && item.segments.some((segment) => segment.label);

  return (
    <div className="report-item-content">
      {item.actionLabel && item.actionTone ? (
        <span className={ACTION_TONE_CLASS[item.actionTone]}>{item.actionLabel}</span>
      ) : null}

      {hasLabelledFlow ? (
        <div className="report-flow">
          {item.segments.map((segment, index) => (
            <div key={index} className="report-flow-step">
              {segment.label ? <span className="report-flow-label">{segment.label}</span> : null}
              <p>
                <InlineText text={segment.text} />
              </p>
            </div>
          ))}
        </div>
      ) : (
        <p>
          {item.segments.map((segment, index) => (
            <span key={index}>
              {segment.label ? (
                <strong className="report-item-label">{segment.label}：</strong>
              ) : null}
              <InlineText text={segment.text} />
              {index < item.segments.length - 1 ? ' → ' : ''}
            </span>
          ))}
        </p>
      )}
    </div>
  );
}

function ReportBlockView({ block }: { block: ReportBlock }) {
  if (block.kind === 'paragraph') {
    return (
      <p className="report-paragraph">
        <InlineText text={block.text} />
      </p>
    );
  }

  if (block.kind === 'note') {
    return (
      <p className="report-note">
        <InlineText text={block.text} />
      </p>
    );
  }

  if (block.ordered) {
    return (
      <ol className="report-numbered-list">
        {block.items.map((item, index) => (
          <li key={index} className="report-numbered-item">
            <span className="report-numbered-index">{item.index ?? index + 1}</span>
            <ListItemContent item={item} />
          </li>
        ))}
      </ol>
    );
  }

  return (
    <ul className="report-bullet-list">
      {block.items.map((item, index) => (
        <li key={index} className="report-bullet-item">
          <ListItemContent item={item} />
        </li>
      ))}
    </ul>
  );
}

export function ReportBody({ sections, keyPrefix }: ReportBodyProps) {
  return (
    <div className="quarterly-report-body report-rich-body">
      {sections.map((section, sectionIndex) => {
        const blocks = parseReportBlocks(section.body);

        if (isHeroReportSection(section.title)) {
          return (
            <section key={`${keyPrefix}-${sectionIndex}`} className="report-hero-section">
              <span className="report-hero-label">
                {stripSectionTitleBrackets(section.title ?? '')}
              </span>
              {blocks.map((block, blockIndex) => (
                <ReportBlockView key={blockIndex} block={block} />
              ))}
            </section>
          );
        }

        return (
          <section key={`${keyPrefix}-${sectionIndex}`} className="quarterly-report-section report-rich-section">
            {section.title ? <h3>{stripSectionTitleBrackets(section.title)}</h3> : null}
            {blocks.map((block, blockIndex) => (
              <ReportBlockView key={blockIndex} block={block} />
            ))}
          </section>
        );
      })}
    </div>
  );
}
