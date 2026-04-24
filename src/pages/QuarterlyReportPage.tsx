import { useEffect, useMemo, useState } from 'react';

import { jsPDF } from 'jspdf';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';

import { storage } from '../lib/firebase/client';
import {
  getQuarterlyReportsErrorMessage,
  subscribeToQuarterlyReports,
  updateQuarterlyReportPdfUrl,
  type QuarterlyReport,
} from '../lib/firebase/quarterlyReports';
import { ReportAllocationSummaryCard } from '../components/portfolio/ReportAllocationSummaryCard';

const REPORT_SECTION_TITLES = [
  '【管理層摘要】',
  '【季度總覽】',
  '【資產配置分佈】',
  '【幣別曝險】',
  '【重點持倉分析】',
  '【季度對比摘要】',
  '【主要風險與集中度】',
  '【下季觀察重點】',
] as const;

const REPORT_SECTION_TITLE_SET = new Set<string>(REPORT_SECTION_TITLES);
const NOTO_FONT_CANDIDATE_URLS = [
  'https://cdn.jsdelivr.net/npm/noto-cjk-base64@latest/dist/NotoSansCJKtc-Regular-normal.js',
  'https://cdn.jsdelivr.net/npm/noto-cjk-base64@latest/dist/NotoSansTC-Regular-normal.js',
] as const;

interface ReportSection {
  title?: string;
  body: string;
}

function formatGeneratedAt(value: string) {
  if (!value) {
    return '尚未生成';
  }

  try {
    return new Intl.DateTimeFormat('zh-HK', {
      timeZone: 'Asia/Hong_Kong',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function extractBase64FontPayload(rawText: string) {
  const trimmed = rawText.trim();

  if (!trimmed) {
    return '';
  }

  if (trimmed.startsWith('data:font/')) {
    return trimmed.split(',')[1] ?? '';
  }

  const directBase64Match = trimmed.match(/['"`]([A-Za-z0-9+/=]{2000,})['"`]/);

  if (directBase64Match?.[1]) {
    return directBase64Match[1];
  }

  const dataUrlMatch = trimmed.match(/data:font\/[^;]+;base64,([A-Za-z0-9+/=]+)/);

  if (dataUrlMatch?.[1]) {
    return dataUrlMatch[1];
  }

  return '';
}

async function tryLoadPdfFont(pdf: jsPDF) {
  for (const url of NOTO_FONT_CANDIDATE_URLS) {
    try {
      const response = await fetch(url);

      if (!response.ok) {
        continue;
      }

      const text = await response.text();
      const base64 = extractBase64FontPayload(text);

      if (!base64) {
        continue;
      }

      pdf.addFileToVFS('NotoSansCJKtc-Regular.ttf', base64);
      pdf.addFont('NotoSansCJKtc-Regular.ttf', 'NotoSansCJKtc', 'normal');
      pdf.addFileToVFS('NotoSansCJKtc-Bold.ttf', base64);
      pdf.addFont('NotoSansCJKtc-Bold.ttf', 'NotoSansCJKtc', 'bold');

      return 'NotoSansCJKtc';
    } catch (error) {
      console.warn('[quarterlyReportPdf] font load failed', {
        url,
        reason: error instanceof Error ? error.message : 'unknown_error',
      });
    }
  }

  return null;
}

function splitReportIntoSections(report: string): ReportSection[] {
  const cleaned = report.trim();

  if (!cleaned) {
    return [];
  }

  const parts = cleaned.split(/(【[^】]+】)/g).filter((part) => part.trim());
  const sections: ReportSection[] = [];

  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index].trim();

    if (REPORT_SECTION_TITLE_SET.has(part)) {
      const next = parts[index + 1]?.trim() ?? '';
      sections.push({
        title: part,
        body: next,
      });
      index += 1;
      continue;
    }

    sections.push({ body: part });
  }

  return sections;
}

function splitParagraphs(body: string) {
  const paragraphs = body
    .split(/\n+/)
    .map((entry) => entry.trim())
    .filter(Boolean);

  return paragraphs.length > 0 ? paragraphs : [''];
}

function addTextPdfFooter(pdf: jsPDF, fontFamily: string) {
  const totalPages = pdf.getNumberOfPages();

  for (let index = 1; index <= totalPages; index += 1) {
    pdf.setPage(index);
    pdf.setFont(fontFamily, 'normal');
    pdf.setFontSize(9);
    pdf.setTextColor(98, 90, 81);
    pdf.text(`第 ${index} 頁 / 共 ${totalPages} 頁`, 105, 286, { align: 'center' });
    pdf.text('Portfolio V2 · 季度資產報告 · 僅供個人參考', 105, 291, {
      align: 'center',
    });
  }
}

function parseHexColor(hexColor: string) {
  const normalized = hexColor.trim().replace('#', '');

  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) {
    return { r: 75, g: 85, b: 99 };
  }

  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16),
  };
}

function formatPdfPercentage(value: number) {
  return `${value.toFixed(1)}%`;
}

function formatPdfDelta(value: number) {
  if (Math.abs(value) < 0.05) {
    return '0.0pp';
  }

  return `${value > 0 ? '+' : ''}${value.toFixed(1)}pp`;
}

function getPdfComparisonText(report: QuarterlyReport) {
  const summary = report.allocationSummary;

  if (summary?.comparisonLabel && summary.deltas?.length) {
    return `${summary.comparisonLabel}變化`;
  }

  return '未有可比較的上期快照';
}

function renderDirectPdfAllocationSummary(params: {
  report: QuarterlyReport;
  pdf: jsPDF;
  fontFamily: string;
  cursorY: number;
  margin: number;
  contentWidth: number;
  ensureSpace: (requiredHeight: number) => void;
}) {
  const { report, pdf, fontFamily, margin, contentWidth, ensureSpace } = params;
  const summary = report.allocationSummary;
  let cursorY = params.cursorY;

  ensureSpace(40);
  pdf.setFont(fontFamily, 'bold');
  pdf.setFontSize(12);
  pdf.setTextColor(29, 26, 23);
  pdf.text('資產分佈總覽', margin, cursorY);
  cursorY += 7;

  pdf.setFont(fontFamily, 'normal');
  pdf.setFontSize(9);
  pdf.setTextColor(98, 90, 81);

  if (!summary) {
    pdf.text('此報告未保存資產分佈快照', margin, cursorY);
    cursorY += 10;
    return cursorY;
  }

  pdf.text(`截至 ${summary.asOfDate || '未提供日期'} · ${getPdfComparisonText(report)}`, margin, cursorY);
  cursorY += 7;

  pdf.setFillColor(244, 239, 232);
  pdf.roundedRect(margin, cursorY, contentWidth, 7, 3.5, 3.5, 'F');
  let barX = margin;

  summary.slices
    .filter((slice) => slice.percentage > 0)
    .forEach((slice) => {
      const width = Math.max(1.5, (slice.percentage / 100) * contentWidth);
      const color = parseHexColor(slice.color);
      pdf.setFillColor(color.r, color.g, color.b);
      pdf.rect(barX, cursorY, Math.min(width, margin + contentWidth - barX), 7, 'F');
      barX += width;
    });
  cursorY += 13;

  summary.slices.forEach((slice) => {
    ensureSpace(6);
    const color = parseHexColor(slice.color);
    const delta = summary.deltas?.find((item) => item.key === slice.key);
    pdf.setFillColor(color.r, color.g, color.b);
    pdf.rect(margin, cursorY - 3.2, 3, 3, 'F');
    pdf.setTextColor(29, 26, 23);
    pdf.text(
      `${slice.label} ${formatPdfPercentage(slice.percentage)}${delta ? `（${formatPdfDelta(delta.deltaPercentagePoints)}）` : ''}`,
      margin + 5,
      cursorY,
    );
    cursorY += 5.2;
  });

  ensureSpace(18);
  pdf.setFont(fontFamily, 'bold');
  pdf.setFontSize(9);
  pdf.setTextColor(15, 118, 110);
  pdf.text(`配置：${summary.styleTag}`, margin, cursorY);
  cursorY += 5.2;

  pdf.setFont(fontFamily, 'normal');
  pdf.setTextColor(98, 90, 81);
  const tagLines = pdf.splitTextToSize(`提示：${summary.warningTags.join('、') || '無'}`, contentWidth);
  tagLines.forEach((line: string) => {
    ensureSpace(5);
    pdf.text(line, margin, cursorY);
    cursorY += 4.8;
  });

  if (summary.summarySentence) {
    const sentenceLines = pdf.splitTextToSize(summary.summarySentence, contentWidth);
    sentenceLines.forEach((line: string) => {
      ensureSpace(5);
      pdf.text(line, margin, cursorY);
      cursorY += 4.8;
    });
  }

  cursorY += 4;
  return cursorY;
}

function renderDirectTextPdf(report: QuarterlyReport, pdf: jsPDF, fontFamily: string) {
  const pageHeight = 297;
  const margin = 20;
  const contentWidth = 170;
  let cursorY = margin;

  const ensureSpace = (requiredHeight: number) => {
    if (cursorY + requiredHeight > pageHeight - margin - 18) {
      pdf.addPage();
      cursorY = margin;
    }
  };

  pdf.setFont(fontFamily, 'bold');
  pdf.setFontSize(16);
  pdf.setTextColor(29, 26, 23);
  pdf.text(report.quarter, margin, cursorY);
  cursorY += 8;

  pdf.setFont(fontFamily, 'normal');
  pdf.setFontSize(10);
  pdf.setTextColor(98, 90, 81);
  pdf.text(`生成日期：${formatGeneratedAt(report.generatedAt)}`, margin, cursorY);
  cursorY += 6;

  pdf.setDrawColor(210, 198, 184);
  pdf.line(margin, cursorY, margin + contentWidth, cursorY);
  cursorY += 8;

  cursorY = renderDirectPdfAllocationSummary({
    report,
    pdf,
    fontFamily,
    cursorY,
    margin,
    contentWidth,
    ensureSpace,
  });

  const sections = splitReportIntoSections(report.report);

  sections.forEach((section) => {
    if (section.title) {
      ensureSpace(12);
      pdf.setFont(fontFamily, 'bold');
      pdf.setFontSize(12);
      pdf.setTextColor(29, 26, 23);
      pdf.text(section.title, margin, cursorY);
      cursorY += 7;
    }

    pdf.setFont(fontFamily, 'normal');
    pdf.setFontSize(10);
    pdf.setTextColor(29, 26, 23);

    splitParagraphs(section.body).forEach((paragraph) => {
      const lines = pdf.splitTextToSize(paragraph, contentWidth);

      lines.forEach((line: string) => {
        ensureSpace(6);
        pdf.text(line, margin, cursorY);
        cursorY += 5.5;
      });

      cursorY += 2;
    });

    cursorY += 3;
  });

  addTextPdfFooter(pdf, fontFamily);
  return pdf;
}

function createCanvasPage() {
  const canvas = document.createElement('canvas');
  canvas.width = 1240;
  canvas.height = 1754;
  const context = canvas.getContext('2d');

  if (!context) {
    throw new Error('無法建立 PDF 畫布，請稍後再試。');
  }

  context.fillStyle = '#fffaf4';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#1d1a17';
  context.textBaseline = 'top';

  return { canvas, context };
}

function wrapCanvasText(
  context: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
) {
  const lines: string[] = [];

  for (const paragraph of text.split('\n')) {
    if (!paragraph.trim()) {
      lines.push('');
      continue;
    }

    let current = '';

    for (const character of Array.from(paragraph)) {
      const candidate = `${current}${character}`;

      if (current && context.measureText(candidate).width > maxWidth) {
        lines.push(current);
        current = character;
      } else {
        current = candidate;
      }
    }

    if (current) {
      lines.push(current);
    }
  }

  return lines;
}

function renderCanvasAllocationSummary(params: {
  report: QuarterlyReport;
  context: CanvasRenderingContext2D;
  cursorY: number;
  marginPx: number;
  contentWidthPx: number;
}) {
  const { report, context, marginPx, contentWidthPx } = params;
  const summary = report.allocationSummary;
  let cursorY = params.cursorY;

  context.fillStyle = '#1d1a17';
  context.font = '700 30px "Noto Sans TC","PingFang TC","Microsoft JhengHei",sans-serif';
  context.fillText('資產分佈總覽', marginPx, cursorY);
  cursorY += 44;

  context.font = '400 22px "Noto Sans TC","PingFang TC","Microsoft JhengHei",sans-serif';
  context.fillStyle = '#625a51';

  if (!summary) {
    context.fillText('此報告未保存資產分佈快照', marginPx, cursorY);
    return cursorY + 48;
  }

  context.fillText(`截至 ${summary.asOfDate || '未提供日期'} · ${getPdfComparisonText(report)}`, marginPx, cursorY);
  cursorY += 42;

  context.fillStyle = '#f4efe8';
  context.fillRect(marginPx, cursorY, contentWidthPx, 22);
  let barX = marginPx;

  summary.slices
    .filter((slice) => slice.percentage > 0)
    .forEach((slice) => {
      const width = Math.max(8, (slice.percentage / 100) * contentWidthPx);
      context.fillStyle = slice.color;
      context.fillRect(barX, cursorY, Math.min(width, marginPx + contentWidthPx - barX), 22);
      barX += width;
    });
  cursorY += 48;

  context.font = '400 22px "Noto Sans TC","PingFang TC","Microsoft JhengHei",sans-serif';
  summary.slices.forEach((slice) => {
    const delta = summary.deltas?.find((item) => item.key === slice.key);
    context.fillStyle = slice.color;
    context.fillRect(marginPx, cursorY + 5, 14, 14);
    context.fillStyle = '#1d1a17';
    context.fillText(
      `${slice.label} ${formatPdfPercentage(slice.percentage)}${delta ? `（${formatPdfDelta(delta.deltaPercentagePoints)}）` : ''}`,
      marginPx + 24,
      cursorY,
    );
    cursorY += 34;
  });

  context.fillStyle = '#0f766e';
  context.font = '700 22px "Noto Sans TC","PingFang TC","Microsoft JhengHei",sans-serif';
  context.fillText(`配置：${summary.styleTag}`, marginPx, cursorY);
  cursorY += 34;

  context.fillStyle = '#625a51';
  context.font = '400 21px "Noto Sans TC","PingFang TC","Microsoft JhengHei",sans-serif';
  const infoLines = [
    ...wrapCanvasText(context, `提示：${summary.warningTags.join('、') || '無'}`, contentWidthPx),
    ...(summary.summarySentence
      ? wrapCanvasText(context, summary.summarySentence, contentWidthPx)
      : []),
  ];

  infoLines.forEach((line) => {
    context.fillText(line, marginPx, cursorY);
    cursorY += 31;
  });

  return cursorY + 18;
}

function renderCanvasFallbackPdf(report: QuarterlyReport) {
  const pdf = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });
  const pages: Array<{ canvas: HTMLCanvasElement; context: CanvasRenderingContext2D }> = [];
  const pageWidthPx = 1240;
  const pageHeightPx = 1754;
  const marginPx = 118;
  const contentWidthPx = pageWidthPx - marginPx * 2;
  const footerTopPx = pageHeightPx - 140;
  let page = createCanvasPage();
  let cursorY = marginPx;

  const ensureSpace = (requiredHeight: number) => {
    if (cursorY + requiredHeight > footerTopPx) {
      pages.push(page);
      page = createCanvasPage();
      cursorY = marginPx;
    }
  };

  page.context.font = '700 42px "Noto Sans TC","PingFang TC","Microsoft JhengHei",sans-serif';
  page.context.fillText(report.quarter, marginPx, cursorY);
  cursorY += 68;

  page.context.font = '400 24px "Noto Sans TC","PingFang TC","Microsoft JhengHei",sans-serif';
  page.context.fillStyle = '#625a51';
  page.context.fillText(`生成日期：${formatGeneratedAt(report.generatedAt)}`, marginPx, cursorY);
  cursorY += 42;

  page.context.strokeStyle = '#d2c6b8';
  page.context.beginPath();
  page.context.moveTo(marginPx, cursorY);
  page.context.lineTo(pageWidthPx - marginPx, cursorY);
  page.context.stroke();
  cursorY += 48;

  cursorY = renderCanvasAllocationSummary({
    report,
    context: page.context,
    cursorY,
    marginPx,
    contentWidthPx,
  });

  const sections = splitReportIntoSections(report.report);

  sections.forEach((section) => {
    if (section.title) {
      ensureSpace(60);
      page.context.fillStyle = '#1d1a17';
      page.context.font = '700 30px "Noto Sans TC","PingFang TC","Microsoft JhengHei",sans-serif';
      page.context.fillText(section.title, marginPx, cursorY);
      cursorY += 52;
    }

    page.context.fillStyle = '#1d1a17';
    page.context.font = '400 24px "Noto Sans TC","PingFang TC","Microsoft JhengHei",sans-serif';

    splitParagraphs(section.body).forEach((paragraph) => {
      const lines = wrapCanvasText(page.context, paragraph, contentWidthPx);

      lines.forEach((line) => {
        ensureSpace(40);
        page.context.fillText(line, marginPx, cursorY);
        cursorY += 36;
      });

      cursorY += 14;
    });

    cursorY += 18;
  });

  pages.push(page);

  const totalPages = pages.length;

  pages.forEach((entry, index) => {
    entry.context.fillStyle = '#625a51';
    entry.context.font = '400 20px "Noto Sans TC","PingFang TC","Microsoft JhengHei",sans-serif';
    entry.context.textAlign = 'center';
    entry.context.fillText(`第 ${index + 1} 頁 / 共 ${totalPages} 頁`, pageWidthPx / 2, pageHeightPx - 74);
    entry.context.fillText('Portfolio V2 · 季度資產報告 · 僅供個人參考', pageWidthPx / 2, pageHeightPx - 42);
    entry.context.textAlign = 'left';

    if (index > 0) {
      pdf.addPage();
    }

    pdf.addImage(entry.canvas.toDataURL('image/png'), 'PNG', 0, 0, 210, 297);
  });

  return pdf;
}

async function createQuarterlyReportPdf(report: QuarterlyReport) {
  const textPdf = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });
  const loadedFont = await tryLoadPdfFont(textPdf);

  if (loadedFont) {
    return renderDirectTextPdf(report, textPdf, loadedFont);
  }

  console.warn(
    '[quarterlyReportPdf] Unable to load Noto Sans CJK font, falling back to canvas rendering.',
  );
  return renderCanvasFallbackPdf(report);
}

function sanitizeQuarterStorageKey(quarter: string) {
  return quarter.trim().replace(/\s+/g, '').replace(/[/:?#[\]@!$&'()*+,;=%]/g, '-');
}

export function QuarterlyReportPage() {
  const [reports, setReports] = useState<QuarterlyReport[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const [generatingReportId, setGeneratingReportId] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    setStatus('loading');
    setError(null);

    const unsubscribe = subscribeToQuarterlyReports(
      (entries) => {
        setReports(entries);
        setStatus('ready');
        setError(null);
      },
      (nextError) => {
        setStatus('error');
        setError(getQuarterlyReportsErrorMessage(nextError));
      },
    );

    return unsubscribe;
  }, []);

  useEffect(() => {
    if (reports.length === 0) {
      setSelectedReportId(null);
      return;
    }

    setSelectedReportId((current) =>
      current && reports.some((report) => report.id === current) ? current : reports[0].id,
    );
  }, [reports]);

  const selectedReport = useMemo(
    () => reports.find((report) => report.id === selectedReportId) ?? null,
    [reports, selectedReportId],
  );

  const selectedSections = useMemo(
    () => splitReportIntoSections(selectedReport?.report ?? ''),
    [selectedReport],
  );

  async function generateAndUploadPdf(report: QuarterlyReport) {
    if (!storage) {
      throw new Error('Firebase Storage 尚未設定完成，請先補上 storageBucket。');
    }

    const pdf = await createQuarterlyReportPdf(report);
    const arrayBuffer = pdf.output('arraybuffer');
    const storageRef = ref(
      storage,
      `reports/quarterly/${sanitizeQuarterStorageKey(report.quarter)}.pdf`,
    );

    await uploadBytes(storageRef, new Uint8Array(arrayBuffer), {
      contentType: 'application/pdf',
      customMetadata: {
        quarter: report.quarter,
        generatedAt: report.generatedAt,
      },
    });

    const downloadUrl = await getDownloadURL(storageRef);
    await updateQuarterlyReportPdfUrl(report.id, downloadUrl);
    return downloadUrl;
  }

  async function handleGeneratePdf(report: QuarterlyReport) {
    setGeneratingReportId(report.id);
    setActionMessage(null);
    setActionError(null);

    try {
      await generateAndUploadPdf(report);
      setActionMessage(`${report.quarter} PDF 已生成並上傳。`);
    } catch (nextError) {
      setActionError(getQuarterlyReportsErrorMessage(nextError));
    } finally {
      setGeneratingReportId(null);
    }
  }

  return (
    <div className="page-stack">
      <section className="hero-panel quarterly-hero">
        <div>
          <p className="eyebrow">Quarterly Reports</p>
          <h2>季度資產報告</h2>
        </div>
        <p className="table-hint">每季首日自動生成，可下載 PDF 留存。</p>
      </section>

      {error ? <p className="status-message status-message-error">{error}</p> : null}
      {actionError ? <p className="status-message status-message-error">{actionError}</p> : null}
      {actionMessage ? <p className="status-message status-message-success">{actionMessage}</p> : null}

      <section className="card quarterly-list-card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Archive</p>
            <h2>報告列表</h2>
          </div>
          <span className="chip chip-soft">
            {status === 'loading' ? '同步中' : `${reports.length} 份報告`}
          </span>
        </div>

        {status === 'ready' && reports.length === 0 ? (
          <p className="status-message">尚未生成季度報告。</p>
        ) : null}

        <div className="quarterly-report-list">
          {reports.map((report) => {
            const isSelected = report.id === selectedReportId;
            const isGenerating = generatingReportId === report.id;

            return (
              <article
                key={report.id}
                className={isSelected ? 'quarterly-report-row active' : 'quarterly-report-row'}
              >
                <button
                  type="button"
                  className="quarterly-report-row-main"
                  onClick={() => setSelectedReportId(report.id)}
                >
                  <div>
                    <strong>{report.quarter}</strong>
                    <p>{formatGeneratedAt(report.generatedAt)}</p>
                  </div>
                  <span className="table-hint">
                    {report.provider ? `${report.provider} · ${report.model}` : report.model}
                  </span>
                </button>

                <div className="quarterly-report-actions">
                  {report.pdfUrl ? (
                    <a
                      className="button button-secondary"
                      href={report.pdfUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      下載 PDF
                    </a>
                  ) : (
                    <button
                      type="button"
                      className="button button-secondary"
                      onClick={() => void handleGeneratePdf(report)}
                      disabled={isGenerating}
                    >
                      {isGenerating ? '生成中...' : '生成 PDF'}
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </section>

      {selectedReport ? (
        <section className="card quarterly-viewer-card">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Report Body</p>
              <h2>{selectedReport.quarter}</h2>
              <p className="table-hint">{formatGeneratedAt(selectedReport.generatedAt)}</p>
            </div>
          </div>

          <ReportAllocationSummaryCard summary={selectedReport.allocationSummary} />

          <div className="quarterly-report-body">
            {selectedSections.map((section, index) => (
              <section key={`${selectedReport.id}-${index}`} className="quarterly-report-section">
                {section.title ? <h3>{section.title}</h3> : null}
                {splitParagraphs(section.body).map((paragraph, paragraphIndex) => (
                  <p key={`${selectedReport.id}-${index}-${paragraphIndex}`}>{paragraph}</p>
                ))}
              </section>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
