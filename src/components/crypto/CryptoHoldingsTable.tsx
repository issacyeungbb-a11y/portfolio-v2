import { Fragment } from 'react';
import { cryptoPositionValue, cryptoDisplayAmount, formatCryptoMoney, type CryptoDisplayCurrency } from '../../lib/cryptoDisplay';
import { cryptoAssetStatus, stakingRewardQuantity } from '../../lib/cryptoClassification';
import type { CryptoManagementState, CryptoPosition } from '../../types/cryptoManagement';

const number = (n: number) => new Intl.NumberFormat('zh-HK', { maximumFractionDigits: 18 }).format(n);
type Props = {
  state: CryptoManagementState; prices: Record<string, number | null>; currency: CryptoDisplayCurrency; usdHkd: number | null; groups: Array<{ name: string; rows: CryptoPosition[] }>; category: 'platform' | 'coin'; busy: boolean;
  onPlatform: (name: string) => void; onMovement: (row: CryptoPosition) => void;
  onLink: (reward: CryptoPosition) => void;
  onRewards: (parent: CryptoPosition, action: 'increase' | 'release') => void; onAdd: (name: string) => void;
};
export function CryptoHoldingsTable({ state, prices, currency, usdHkd, groups, category, busy, onPlatform, onMovement, onRewards, onAdd, onLink }: Props) {
  const price = (symbol: string) => typeof prices[symbol] === 'number' && prices[symbol]! > 0 ? prices[symbol] : null;
  const unit = (symbol: string) => formatCryptoMoney(cryptoDisplayAmount(price(symbol), currency, usdHkd), currency, true);
  const value = (symbol: string, quantity: number) => formatCryptoMoney(cryptoDisplayAmount(cryptoPositionValue(quantity, price(symbol)), currency, usdHkd), currency);
  return <div className="cm-table-scroll"><table className="cm-table cm-holdings-table"><thead><tr><th>平台／錢包</th><th>幣種／狀態</th><th className="cm-numeric">數量</th><th className="cm-numeric">單價（{currency}）</th><th className="cm-numeric">總值（{currency}）</th><th>操作</th></tr></thead><tbody>{groups.map(group => {
    const rows = group.rows.filter(p => !p.stakingPositionId);
    for (const child of group.rows.filter(p => p.stakingPositionId)) {
      const parent = state.positions.find(p => p.id === child.stakingPositionId);
      if (parent && !rows.some(p => p.id === parent.id)) rows.push(parent);
    }
    const count = rows.length + rows.filter(p => cryptoAssetStatus(p.status) === '鎖定(質押)').length;
    if (!rows.length) return <tr key={`empty_${group.name}`}><td>{category === 'platform' ? <button className="cm-platform-name" disabled={busy} onClick={() => onPlatform(group.name)}>{group.name}</button> : '—'}</td><th>{category === 'coin' ? group.name : '—'}</th><td colSpan={3}>未有持倉</td><td><button className="button button-secondary" onClick={() => onAdd(group.name)}>新增資產</button></td></tr>;
    return <Fragment key={group.name}>{rows.map((r, i) => {
      const staked = cryptoAssetStatus(r.status) === '鎖定(質押)';
      const quantity = staked ? stakingRewardQuantity(state, r.id) : 0;
      return <Fragment key={r.id}><tr className={i === 0 ? 'cm-group-start' : ''} data-position={r.id}>
        {(category !== 'platform' || i === 0) && <td className="cm-platform-cell" rowSpan={category === 'platform' ? count : staked ? 2 : 1}><button className="cm-platform-name" disabled={busy} aria-label={`設定 ${r.custodian} 平台`} onClick={() => onPlatform(r.custodian)}>{r.custodian}</button></td>}
        <th scope="row" className="cm-asset-cell"><div><span>{r.symbol}</span><span className="cm-tag" data-status={r.status}>{r.status}</span></div>{r.network && <small>{r.network}</small>}</th><td className="cm-numeric">{number(r.quantity)}</td><td className="cm-numeric cm-unit-price">{unit(r.symbol)}</td><td className="cm-numeric cm-position-value">{value(r.symbol, r.quantity)}</td><td><button className="button button-secondary" disabled={busy} aria-label={`查看 ${r.symbol} ${r.custodian} 往來`} onClick={() => onMovement(r)}>往來</button>{r.status === '質押所賺' && <><small className="cm-unlinked-reward">未能唯一對應質押持倉</small><button className="button button-secondary" disabled={busy} onClick={() => onLink(r)}>關聯質押</button></>}</td>
      </tr>{staked && <tr className="cm-reward-branch" data-staking-parent={r.id}>
        <th scope="row"><span className="cm-branch-name">↳ 質押所賺</span><small>{r.symbol} · 尚未解除</small></th><td className="cm-numeric">{number(quantity)}</td><td className="cm-numeric cm-unit-price">{unit(r.symbol)}</td><td className="cm-numeric cm-position-value">{value(r.symbol, quantity)}</td>
        <td><div className="cm-reward-actions"><button className="button button-secondary" disabled={busy} aria-label={`新增 ${r.symbol} ${r.custodian} 質押收益（本金 ${number(r.quantity)}）`} onClick={() => onRewards(r, 'increase')}>新增收益</button><button className="button button-secondary" disabled={busy || quantity <= 0} aria-label={`解除 ${r.symbol} ${r.custodian} 質押收益（本金 ${number(r.quantity)}）`} onClick={() => onRewards(r, 'release')}>解除收益</button></div></td>
      </tr>}</Fragment>;
    })}</Fragment>;
  })}</tbody></table></div>;
}
