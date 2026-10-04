import { cryptoCoinValues, cryptoDisplayAmount, formatCryptoMoney, formatCryptoAllocation, type CryptoDisplayCurrency } from '../../lib/cryptoDisplay';
import type { CryptoManagementState, CryptoValuation } from '../../types/cryptoManagement';

const number = (n: number) => new Intl.NumberFormat('zh-HK', { maximumFractionDigits: 18 }).format(n);
export function CryptoCoinSidebar({ state, valuation, currency, usdHkd, selected, onSelect }: { state: CryptoManagementState; valuation: CryptoValuation; currency: CryptoDisplayCurrency; usdHkd: number | null; selected: string; onSelect: (symbol: string) => void }) {
  const coins = cryptoCoinValues(state, valuation).coins;
  return <aside className="cm-coin-sidebar" aria-label="各幣種數量、總值及佔比">
    <div className="cm-coin-sidebar-heading"><h3>幣種總覽</h3><span>全部平台合計</span></div>
    <button type="button" className={`cm-coin-all ${!selected ? 'active' : ''}`} aria-pressed={!selected} onClick={() => onSelect('')}>全部幣種</button>
    <div className="cm-coin-list">{coins.map(c => <button key={c.symbol} type="button" className={`cm-coin-total ${selected === c.symbol ? 'active' : ''}`} aria-pressed={selected === c.symbol} aria-label={`${c.symbol} 總數量 ${number(c.quantity)} 總值 ${formatCryptoMoney(cryptoDisplayAmount(c.valueUsd, currency, usdHkd), currency)} 佔 Crypto 持倉 ${formatCryptoAllocation(c.allocation)}`} onClick={() => onSelect(c.symbol)}>
      <strong>{c.symbol}</strong><span className="cm-coin-name">{c.name}</span><span className="cm-coin-quantity">{number(c.quantity)}</span><span className="cm-coin-market-value">{formatCryptoMoney(cryptoDisplayAmount(c.valueUsd, currency, usdHkd), currency)}</span><small>{c.platforms} 個平台 · 佔比 {formatCryptoAllocation(c.allocation)}</small>
    </button>)}</div>
  </aside>;
}
