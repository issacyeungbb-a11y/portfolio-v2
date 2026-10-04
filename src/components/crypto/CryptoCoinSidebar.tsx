import { summarizeCryptoCoins } from '../../lib/cryptoClassification';
import type { CryptoManagementState } from '../../types/cryptoManagement';

const number = (n: number) => new Intl.NumberFormat('zh-HK', { maximumFractionDigits: 18 }).format(n);
export function CryptoCoinSidebar({ state, selected, onSelect }: { state: CryptoManagementState; selected: string; onSelect: (symbol: string) => void }) {
  const coins = summarizeCryptoCoins(state);
  return <aside className="cm-coin-sidebar" aria-label="各幣種總數量">
    <div className="cm-coin-sidebar-heading"><h3>幣種總數</h3><span>全部平台合計</span></div>
    <button type="button" className={`cm-coin-all ${!selected ? 'active' : ''}`} aria-pressed={!selected} onClick={() => onSelect('')}>全部幣種</button>
    <div className="cm-coin-list">{coins.map(c => <button key={c.symbol} type="button" className={`cm-coin-total ${selected === c.symbol ? 'active' : ''}`} aria-pressed={selected === c.symbol} aria-label={`${c.symbol} 總數量 ${number(c.quantity)}`} onClick={() => onSelect(c.symbol)}>
      <strong>{c.symbol}</strong><span className="cm-coin-name">{c.name}</span><span className="cm-coin-quantity">{number(c.quantity)}</span><small>{c.platforms} 個平台</small>
    </button>)}</div>
  </aside>;
}
