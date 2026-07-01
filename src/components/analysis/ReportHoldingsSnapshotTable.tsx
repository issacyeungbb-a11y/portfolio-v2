import type { DisplayCurrency, ReportFactsPayload } from '../../types/portfolio';

interface ReportHoldingsSnapshotTableProps {
  reportFactsPayload?: ReportFactsPayload;
  displayCurrency: DisplayCurrency;
}

interface ReportHoldingRow {
  ticker: string;
  name: string;
  currency: string;
  quantity?: number;
  currentPrice?: number;
  marketValueHKD: number;
  marketValueLocal?: number;
  accountSources?: NonNullable<ReportFactsPayload['currentHoldings']>[number]['accountSources'];
}

function formatNumber(value?: number, maximumFractionDigits = 4) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return '—';
  }

  return new Intl.NumberFormat('en-HK', {
    maximumFractionDigits,
  }).format(value);
}

function formatMoney(value?: number, currency = 'HKD') {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return '—';
  }

  return new Intl.NumberFormat('en-HK', {
    style: 'currency',
    currency,
    maximumFractionDigits: currency === 'JPY' ? 0 : 2,
  }).format(value);
}

function formatPercentage(value?: number) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return '—';
  }

  return `${new Intl.NumberFormat('en-HK', {
    maximumFractionDigits: 1,
  }).format(value)}%`;
}

function getHoldingRows(reportFactsPayload?: ReportFactsPayload): ReportHoldingRow[] {
  if (!reportFactsPayload) {
    return [];
  }

  if (Array.isArray(reportFactsPayload.currentHoldings) && reportFactsPayload.currentHoldings.length > 0) {
    return [...reportFactsPayload.currentHoldings].sort(
      (left, right) => right.marketValueHKD - left.marketValueHKD,
    );
  }

  return [...reportFactsPayload.topHoldingsByHKD].sort(
    (left, right) => right.marketValueHKD - left.marketValueHKD,
  );
}

function formatAccountSources(holding: ReportHoldingRow) {
  const accountSources = holding.accountSources?.filter((entry) => entry.marketValueHKD > 0) ?? [];

  if (accountSources.length === 0) {
    return '';
  }

  return accountSources
    .map((entry) => entry.label || String(entry.accountSource || '未記錄'))
    .join('、');
}

export function ReportHoldingsSnapshotTable({
  reportFactsPayload,
  displayCurrency,
}: ReportHoldingsSnapshotTableProps) {
  const rows = getHoldingRows(reportFactsPayload);
  const totalValueHKD = reportFactsPayload?.totalValueHKD ?? rows.reduce(
    (sum, holding) => sum + holding.marketValueHKD,
    0,
  );

  if (rows.length === 0) {
    return null;
  }

  return (
    <section className="analysis-report-section-block report-holdings-snapshot">
      <div className="section-heading">
        <div>
          <h3>當刻資產明細</h3>
          <p className="table-hint">
            截至 {reportFactsPayload?.currentSnapshotDate ?? reportFactsPayload?.periodEndDate ?? '生成當刻'}
          </p>
        </div>
        <span className="chip chip-soft">{rows.length} 項資產</span>
      </div>

      <div className="report-holdings-table-shell">
        <table className="report-holdings-table">
          <thead>
            <tr>
              <th>資產</th>
              <th>來源帳戶</th>
              <th>持有數量</th>
              <th>當時價格</th>
              <th>總值</th>
              <th>佔比</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((holding) => {
              const holdingPercentage =
                totalValueHKD > 0 ? (holding.marketValueHKD / totalValueHKD) * 100 : undefined;

              return (
                <tr key={`${holding.ticker}-${holding.name}-${holding.currency}`}>
                  <td>
                    <strong>{holding.name}</strong>
                    <span>{holding.ticker}</span>
                  </td>
                  <td>{formatAccountSources(holding) || '—'}</td>
                  <td>{formatNumber(holding.quantity, 8)}</td>
                  <td>{formatMoney(holding.currentPrice, holding.currency)}</td>
                  <td>
                    <strong>{formatMoney(holding.marketValueHKD, displayCurrency)}</strong>
                    {holding.currency !== displayCurrency && typeof holding.marketValueLocal === 'number' ? (
                      <span>{formatMoney(holding.marketValueLocal, holding.currency)}</span>
                    ) : null}
                  </td>
                  <td>{formatPercentage(holdingPercentage)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
