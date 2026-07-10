/**
 * 報告富文本解析 — 將月報 / 季報嘅純文字內容解析成有結構嘅 blocks，
 * 畀 ReportBody 組件做視覺化排版（列點、分類標籤、箭咀流程、數字高亮）。
 *
 * 設計原則：解析失敗時必須優雅降級成普通段落，唔可以令舊報告爆版。
 */

export type ReportFigureTone = 'positive' | 'negative' | 'neutral';

export type ReportInlineToken =
  | { kind: 'text'; text: string }
  | { kind: 'figure'; text: string; tone: ReportFigureTone };

export type ReportActionTone = 'must' | 'consider' | 'avoid';

export interface ReportSegment {
  label: string | null;
  text: string;
}

export interface ReportListItem {
  index: number | null;
  actionTone: ReportActionTone | null;
  actionLabel: string | null;
  segments: ReportSegment[];
}

export type ReportBlock =
  | { kind: 'paragraph'; text: string }
  | { kind: 'note'; text: string }
  | { kind: 'list'; ordered: boolean; items: ReportListItem[] };

const ACTION_TONE_MAP: Record<string, ReportActionTone> = {
  必須跟進: 'must',
  必要跟進: 'must',
  可以考慮: 'consider',
  可考慮: 'consider',
  暫時不建議: 'avoid',
  不建議: 'avoid',
};

const BULLET_PREFIX_PATTERN = /^[-•‧・*]\s+/;
const NUMBERED_PREFIX_PATTERN = /^(\d{1,2})[.、．)]\s*/;
const SEGMENT_LABEL_PATTERN = /^([^，。；、：:！？\d]{2,12})[:：]\s*/;

/**
 * 數字 token：百分比 / pp、萬（可帶幣別）、幣別金額、金額＋中文幣別。
 * 帶正負號先會着色，避免將日期、代號誤判成升跌。
 */
const FIGURE_PATTERN = new RegExp(
  [
    '[+\\-−]?\\d[\\d,]*(?:\\.\\d+)?\\s*(?:%|pp)',
    '[+\\-−]?\\d[\\d,]*(?:\\.\\d+)?\\s*萬(?:\\s*(?:HKD|USD|JPY|美元|港元|港幣|日圓))?',
    '(?:USD|HKD|JPY|US\\$|HK\\$)\\s?\\d[\\d,]*(?:\\.\\d+)?(?:\\s*萬)?',
    '[+\\-−]?\\d[\\d,]{2,}(?:\\.\\d+)?\\s*(?:HKD|USD|JPY|美元|港元|港幣|日圓)',
  ].join('|'),
  'g',
);

export function tokenizeReportText(text: string): ReportInlineToken[] {
  const tokens: ReportInlineToken[] = [];
  let lastIndex = 0;

  FIGURE_PATTERN.lastIndex = 0;
  for (let match = FIGURE_PATTERN.exec(text); match; match = FIGURE_PATTERN.exec(text)) {
    if (match.index > lastIndex) {
      tokens.push({ kind: 'text', text: text.slice(lastIndex, match.index) });
    }

    const figure = match[0];
    const tone: ReportFigureTone = figure.startsWith('+')
      ? 'positive'
      : figure.startsWith('-') || figure.startsWith('−')
        ? 'negative'
        : 'neutral';

    tokens.push({ kind: 'figure', text: figure, tone });
    lastIndex = match.index + figure.length;
  }

  if (lastIndex < text.length) {
    tokens.push({ kind: 'text', text: text.slice(lastIndex) });
  }

  return tokens.length > 0 ? tokens : [{ kind: 'text', text }];
}

function parseSegments(text: string): ReportSegment[] {
  return text
    .split(/\s*→\s*/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const labelMatch = part.match(SEGMENT_LABEL_PATTERN);

      if (!labelMatch) {
        return { label: null, text: part };
      }

      return {
        label: labelMatch[1].trim(),
        text: part.slice(labelMatch[0].length).trim(),
      };
    });
}

function parseListItem(rawText: string, index: number | null): ReportListItem {
  let text = rawText.trim();
  let actionTone: ReportActionTone | null = null;
  let actionLabel: string | null = null;

  const actionMatch = text.match(/^([^：:]{2,6})[:：]\s*/);
  if (actionMatch && ACTION_TONE_MAP[actionMatch[1].trim()]) {
    actionLabel = actionMatch[1].trim();
    actionTone = ACTION_TONE_MAP[actionLabel];
    text = text.slice(actionMatch[0].length).trim();
  }

  return {
    index,
    actionTone,
    actionLabel,
    segments: parseSegments(text),
  };
}

function isNoteParagraph(text: string) {
  return (
    (text.startsWith('（') && text.endsWith('）')) ||
    (text.startsWith('(') && text.endsWith(')'))
  );
}

export function parseReportBlocks(body: string): ReportBlock[] {
  const lines = body
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  const blocks: ReportBlock[] = [];

  for (const line of lines) {
    const bulletMatch = line.match(BULLET_PREFIX_PATTERN);
    const numberedMatch = line.match(NUMBERED_PREFIX_PATTERN);

    if (bulletMatch || numberedMatch) {
      const ordered = Boolean(numberedMatch);
      const item = numberedMatch
        ? parseListItem(line.slice(numberedMatch[0].length), Number(numberedMatch[1]))
        : parseListItem(line.slice(bulletMatch![0].length), null);

      const previous = blocks[blocks.length - 1];
      if (previous && previous.kind === 'list' && previous.ordered === ordered) {
        previous.items.push(item);
      } else {
        blocks.push({ kind: 'list', ordered, items: [item] });
      }
      continue;
    }

    if (isNoteParagraph(line)) {
      blocks.push({ kind: 'note', text: line.slice(1, -1).trim() });
      continue;
    }

    blocks.push({ kind: 'paragraph', text: line });
  }

  return blocks;
}

const HERO_SECTION_TITLES = new Set(['【本月一句總結】', '【管理層摘要】']);

export function isHeroReportSection(title: string | undefined) {
  return Boolean(title && HERO_SECTION_TITLES.has(title));
}

export function stripSectionTitleBrackets(title: string) {
  return title.replace(/^【/, '').replace(/】$/, '');
}
