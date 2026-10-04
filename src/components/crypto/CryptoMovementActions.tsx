import { cryptoMovementLabels } from '../../lib/cryptoMovements';
import type { CryptoMovementType } from '../../types/cryptoManagement';

export const cryptoMovementHelp: Record<CryptoMovementType, string> = {
  stake: '可動用資產 → 鎖定(質押)，幣種總數不變。',
  unstake: '鎖定(質押) → 可用，幣種總數不變。',
  collateral_lock: '可動用資產 → 鎖定(抵押)，幣種總數不變。',
  collateral_unlock: '鎖定(抵押) → 可用，幣種總數不變。',
  staking_reward: '新增已收到的質押收益；本金不會扣減，可另列「質押所賺」或繼續質押。',
  buy: '買入幣種，增加目的地持倉；請填成交單價及付款方式。',
  sell: '出售可動用資產，扣減來源持倉；請填成交單價及收款方式。鎖定資產須先解除。',
  transfer: '在已記錄的平台／錢包之間轉移，幣種總數不變。改變鎖定狀態請選投入或解除；質押所賺亦可轉回可用。',
  transfer_in: '從系統外的平台／錢包轉入，增加持倉；請填外部來源。',
  transfer_out: '轉到系統外的平台／錢包，扣減持倉；請填外部目的地。',
};
const groups: Array<{ label: string; types: CryptoMovementType[] }> = [
  { label: '資產狀態與收益', types: ['stake', 'unstake', 'collateral_lock', 'collateral_unlock', 'staking_reward'] },
  { label: '買賣交易', types: ['buy', 'sell'] },
  { label: '平台／錢包轉移', types: ['transfer', 'transfer_in', 'transfer_out'] },
];
const captions: Record<CryptoMovementType, string> = {
  stake: '可動用 → 鎖定(質押)', unstake: '鎖定(質押) → 可用',
  collateral_lock: '可動用 → 鎖定(抵押)', collateral_unlock: '鎖定(抵押) → 可用',
  staking_reward: '記錄已收到的質押所賺', buy: '購入幣種', sell: '變賣幣種',
  transfer: '已記錄的平台之間', transfer_in: '系統外 → 持倉', transfer_out: '持倉 → 系統外',
};
export function CryptoMovementActions({ value, onChange }: { value: CryptoMovementType; onChange: (type: CryptoMovementType) => void }) {
  return <div className="cm-operation-groups">{groups.map(group => <div key={group.label} role="group" aria-label={group.label}>
    <h4>{group.label}</h4><div className="cm-operation-options">{group.types.map(type => <button key={type} type="button" className={`cm-operation-option ${value === type ? 'active' : ''}`} aria-label={cryptoMovementLabels[type]} aria-pressed={value === type} onClick={() => onChange(type)}>
      <strong>{cryptoMovementLabels[type]}</strong><span>{captions[type]}</span>
    </button>)}</div>
  </div>)}</div>;
}
