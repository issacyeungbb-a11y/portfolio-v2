import { ReportAllocationSummaryCard } from '../components/portfolio/ReportAllocationSummaryCard';
import type { ReportAllocationSummary } from '../types/portfolio';

interface PreviewSection {
  title: string;
  paragraphs: string[];
}

const monthlyAllocationSummary: ReportAllocationSummary = {
  asOfDate: '2026-04-30T00:00:00+08:00',
  basis: 'monthly',
  comparisonLabel: '較上月',
  styleTag: '平衡型',
  warningTags: ['加密資產波動偏高', '現金水位充足'],
  dominantBucketKey: 'etf',
  totalValueHKD: 2485600,
  summarySentence: 'ETF 仍然是核心配置，較上月小幅增持加密資產，同時保留足夠現金作下月部署。',
  slices: [
    {
      key: 'etf',
      label: 'ETF',
      color: '#0f766e',
      percentage: 38.4,
      totalValueHKD: 954470,
      totalValueUSD: 122368,
    },
    {
      key: 'stock',
      label: '股票',
      color: '#2563eb',
      percentage: 27.1,
      totalValueHKD: 673598,
      totalValueUSD: 86359,
    },
    {
      key: 'crypto',
      label: '加密貨幣',
      color: '#f59e0b',
      percentage: 18.8,
      totalValueHKD: 467293,
      totalValueUSD: 59909,
    },
    {
      key: 'cash',
      label: '現金',
      color: '#8b5cf6',
      percentage: 11.9,
      totalValueHKD: 295786,
      totalValueUSD: 37921,
    },
    {
      key: 'bond',
      label: '債券',
      color: '#94a3b8',
      percentage: 3.8,
      totalValueHKD: 94453,
      totalValueUSD: 12109,
    },
  ],
  deltas: [
    { key: 'etf', deltaPercentagePoints: 1.4 },
    { key: 'stock', deltaPercentagePoints: -0.9 },
    { key: 'crypto', deltaPercentagePoints: 2.2 },
    { key: 'cash', deltaPercentagePoints: -1.8 },
    { key: 'bond', deltaPercentagePoints: -0.9 },
  ],
};

const quarterlyAllocationSummary: ReportAllocationSummary = {
  asOfDate: '2026-03-31T00:00:00+08:00',
  basis: 'quarterly',
  comparisonLabel: '較上季',
  styleTag: '進攻型',
  warningTags: ['科技倉位偏重', '美元資產比重上升'],
  dominantBucketKey: 'stock',
  totalValueHKD: 2394200,
  summarySentence: '本季組合風格轉向進攻，股票與加密貨幣合計佔比擴大，整體回報由風險資產帶動。',
  slices: [
    {
      key: 'stock',
      label: '股票',
      color: '#2563eb',
      percentage: 41.6,
      totalValueHKD: 995987,
      totalValueUSD: 127691,
    },
    {
      key: 'etf',
      label: 'ETF',
      color: '#0f766e',
      percentage: 29.8,
      totalValueHKD: 713472,
      totalValueUSD: 91471,
    },
    {
      key: 'crypto',
      label: '加密貨幣',
      color: '#f59e0b',
      percentage: 16.1,
      totalValueHKD: 385466,
      totalValueUSD: 49419,
    },
    {
      key: 'cash',
      label: '現金',
      color: '#8b5cf6',
      percentage: 8.3,
      totalValueHKD: 198719,
      totalValueUSD: 25477,
    },
    {
      key: 'bond',
      label: '債券',
      color: '#94a3b8',
      percentage: 4.2,
      totalValueHKD: 100556,
      totalValueUSD: 12895,
    },
  ],
  deltas: [
    { key: 'stock', deltaPercentagePoints: 3.6 },
    { key: 'etf', deltaPercentagePoints: -1.7 },
    { key: 'crypto', deltaPercentagePoints: 1.9 },
    { key: 'cash', deltaPercentagePoints: -2.4 },
    { key: 'bond', deltaPercentagePoints: -1.4 },
  ],
};

const monthlySections: PreviewSection[] = [
  {
    title: '本月一句總結',
    paragraphs: ['本月組合以 ETF 穩定回升為主，並在市場拉回時小幅增加加密資產倉位，整體風險承受度較上月略為提高。'],
  },
  {
    title: '本月資產變化摘要',
    paragraphs: [
      'ETF 倉位繼續維持核心角色，主要受美股寬基指數推升，佔比提升 1.4 個百分點。',
      '現金比重下降，反映月內有再部署資金至風險資產，但仍保留足夠緩衝應付波動。',
    ],
  },
  {
    title: '組合健康檢查',
    paragraphs: [
      '現金與債券合計仍接近 16%，短線流動性健康，未見過度透支風險。',
      '加密貨幣升至接近兩成，若下月波幅放大，整體淨值回撤可能會較上月明顯。',
    ],
  },
  {
    title: '三個重點觀察',
    paragraphs: [
      '第一，股票與 ETF 仍然構成主要防線，代表核心配置未有失衡。',
      '第二，風險資產升幅開始集中，表示組合回報來源較依賴少數主題。',
      '第三，現金部署效率提升，但再減持現金前要留意未來兩週事件風險。',
    ],
  },
  {
    title: '下月行動建議',
    paragraphs: [
      '維持 ETF 核心持倉不變，等待更清晰的加息與通脹訊號後再調整股票比重。',
      '為控制波動，若加密貨幣突破目標比重，可考慮分段回收部分盈利至現金。',
    ],
  },
];

const quarterlySections: PreviewSection[] = [
  {
    title: '管理層摘要',
    paragraphs: ['本季組合整體回報由股票及加密貨幣帶動，風格由平衡逐步轉向進攻，換取較高上行但亦同步提高波動敏感度。'],
  },
  {
    title: '季度總覽',
    paragraphs: [
      '季內總資產規模穩步上升，新增資金主要流向股票與 ETF，反映部署重點仍集中在中長線增長資產。',
      '相對上季，現金與債券佔比回落，資金閒置情況減少，但組合防守能力亦有所下降。',
    ],
  },
  {
    title: '資產配置分佈',
    paragraphs: [
      '股票比重升至 41.6%，成為最主要風險敞口；ETF 仍保持接近三成，提供一定分散效果。',
      '加密貨幣已升至 16.1%，屬回報放大器，同時亦是淨值波動的主要來源之一。',
    ],
  },
  {
    title: '幣別曝險',
    paragraphs: [
      '美元資產仍佔主導，若美元回吐或匯率波動擴大，季度收益會受到放大影響。',
      '港元現金保留比例下降，短線資金彈性比上季少，需要更有紀律地安排再平衡。',
    ],
  },
  {
    title: '重點持倉分析',
    paragraphs: [
      '科技與指數型產品仍然是核心獲利來源，表示組合表現與美股風險偏好高度相關。',
      '若單一主題繼續擴大，建議下季加入更多低相關性資產，減低回報過度集中。',
    ],
  },
  {
    title: '季度對比摘要',
    paragraphs: [
      '相較上季，股票比重上升 3.6 個百分點，ETF 及現金同步回落，顯示資金更積極追求增長。',
      '資產配置由偏平衡轉向偏進攻，回報彈性提高，但對市場情緒的依賴亦更明顯。',
    ],
  },
  {
    title: '主要風險與集中度',
    paragraphs: [
      '目前最大風險來自科技相關資產集中，以及加密貨幣波動同時放大組合回撤。',
      '若市場由風險偏好轉向避險，現有現金與債券比重未必足以完全緩衝季度級別調整。',
    ],
  },
  {
    title: '下季觀察重點',
    paragraphs: [
      '留意風險資產是否持續由少數題材帶動，若市場廣度轉弱，應優先處理過度集中的倉位。',
      '同時觀察美元及利率走勢，決定是否需要重新提升現金或債券比重作防守。',
    ],
  },
];

function PreviewReportBody({
  sections,
}: {
  sections: PreviewSection[];
}) {
  return (
    <div className="quarterly-report-body">
      {sections.map((section) => (
        <section key={section.title} className="quarterly-report-section">
          <h3>{section.title}</h3>
          {section.paragraphs.map((paragraph) => (
            <p key={`${section.title}-${paragraph}`}>{paragraph}</p>
          ))}
        </section>
      ))}
    </div>
  );
}

export function ReportPreviewPage() {
  return (
    <div className="page-grid report-preview-page">
      <section className="hero-panel report-preview-hero">
        <div>
          <p className="eyebrow">Local Preview</p>
          <h2>月報與季報 UI Sandbox</h2>
          <p className="hero-text">
            此頁只作本機 UI 預覽，不會寫入資料庫，不會生成正式報告。
          </p>
        </div>
        <div className="report-preview-warning-list" aria-label="本機預覽限制">
          <span className="chip chip-soft">不改 production route</span>
          <span className="chip chip-soft">不呼叫 Firestore write</span>
          <span className="chip chip-soft">不呼叫 AI API</span>
          <span className="chip chip-soft">不上傳 PDF</span>
          <span className="chip chip-soft">不部署 Vercel</span>
        </div>
      </section>

      <section className="card quarterly-viewer-card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Monthly Preview</p>
            <h2>每月資產分析預覽</h2>
            <p className="table-hint">純 mock data 顯示，專門用嚟檢查版面與「資產分佈總覽」效果。</p>
          </div>
        </div>

        <ReportAllocationSummaryCard summary={monthlyAllocationSummary} />
        <PreviewReportBody sections={monthlySections} />
      </section>

      <section className="card quarterly-viewer-card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Quarterly Preview</p>
            <h2>季度報告預覽</h2>
            <p className="table-hint">重用正式報告卡片，但資料來源只係本頁 mock payload。</p>
          </div>
        </div>

        <ReportAllocationSummaryCard summary={quarterlyAllocationSummary} />
        <PreviewReportBody sections={quarterlySections} />
      </section>

      <section className="card quarterly-viewer-card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Legacy Test</p>
            <h2>舊報告測試區</h2>
            <p className="table-hint">模擬舊報告未保存 allocation summary 時的顯示方式。</p>
          </div>
        </div>

        <ReportAllocationSummaryCard summary={undefined} />
      </section>
    </div>
  );
}
