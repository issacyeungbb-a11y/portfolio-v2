import type { DisplayCurrency } from '../../types/portfolio';

const currencyOrder: DisplayCurrency[] = ['HKD', 'USD', 'JPY'];

interface CurrencyToggleProps {
  value: DisplayCurrency;
  onChange: (currency: DisplayCurrency) => void;
  ariaLabel?: string;
  className?: string;
}

export function CurrencyToggle({
  value,
  onChange,
  ariaLabel = '選擇顯示貨幣',
  className = '',
}: CurrencyToggleProps) {
  const toggleClassName = ['currency-toggle', className].filter(Boolean).join(' ');

  return (
    <div className={toggleClassName} role="group" aria-label={ariaLabel}>
      {currencyOrder.map((currency) => (
        <button
          key={currency}
          className={value === currency ? 'currency-toggle-button active' : 'currency-toggle-button'}
          type="button"
          onClick={() => onChange(currency)}
        >
          {currency}
        </button>
      ))}
    </div>
  );
}
