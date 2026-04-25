import type { HTMLAttributes, ReactNode } from 'react';

import { normalizeCurrencyCode } from '../../lib/currency';
import type { DisplayCurrency } from '../../types/portfolio';

type ValueTone = 'neutral' | 'positive' | 'caution' | 'danger';

function joinClassNames(...values: Array<string | undefined | false | null>) {
  return values.filter(Boolean).join(' ');
}

function formatCurrencyValue(value: number, currency: string, showSign = false) {
  const normalizedCurrency = normalizeCurrencyCode(currency);
  const fractionDigits = normalizedCurrency === 'JPY' ? 0 : 2;
  const absoluteValue = Math.abs(value);
  const formatted = new Intl.NumberFormat('zh-HK', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(absoluteValue);
  const prefix = value < 0 ? '-' : showSign && value > 0 ? '+' : '';

  return `${normalizedCurrency} ${prefix}${formatted}`;
}

function formatPercentValue(value: number, showSign = true) {
  const absoluteValue = Math.abs(value);
  const formatted = new Intl.NumberFormat('zh-HK', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(absoluteValue);
  const prefix = value < 0 ? '-' : showSign && value > 0 ? '+' : '';

  return `${prefix}${formatted}%`;
}

function formatQuantityValue(value: number, precision = 4) {
  return new Intl.NumberFormat('zh-HK', {
    minimumFractionDigits: 0,
    maximumFractionDigits: precision,
  }).format(value);
}

function formatDateTimeValue(value: string | Date, options?: Intl.DateTimeFormatOptions) {
  const date = typeof value === 'string' ? new Date(value) : value;

  if (Number.isNaN(date.getTime())) {
    return '—';
  }

  return new Intl.DateTimeFormat('zh-HK', {
    dateStyle: 'medium',
    timeStyle: 'short',
    ...options,
  }).format(date);
}

export interface MoneyValueProps extends HTMLAttributes<HTMLSpanElement> {
  value?: number | null;
  currency?: DisplayCurrency | string;
  fallback?: ReactNode;
  tone?: ValueTone;
  showSign?: boolean;
}

export function MoneyValue({
  value,
  currency = 'HKD',
  fallback = '—',
  tone = 'neutral',
  showSign = false,
  className,
  ...props
}: MoneyValueProps) {
  const content =
    typeof value === 'number' && Number.isFinite(value)
      ? formatCurrencyValue(value, currency, showSign)
      : fallback;

  return (
    <span className={joinClassNames('finance-value', 'money-value', className)} data-tone={tone} {...props}>
      {content}
    </span>
  );
}

export interface PercentValueProps extends HTMLAttributes<HTMLSpanElement> {
  value?: number | null;
  fallback?: ReactNode;
  tone?: ValueTone;
  showSign?: boolean;
}

export function PercentValue({
  value,
  fallback = '—',
  tone = 'neutral',
  showSign = true,
  className,
  ...props
}: PercentValueProps) {
  const content =
    typeof value === 'number' && Number.isFinite(value)
      ? formatPercentValue(value, showSign)
      : fallback;

  return (
    <span className={joinClassNames('finance-value', 'percent-value', className)} data-tone={tone} {...props}>
      {content}
    </span>
  );
}

export interface QuantityValueProps extends HTMLAttributes<HTMLSpanElement> {
  value?: number | null;
  fallback?: ReactNode;
  precision?: number;
}

export function QuantityValue({
  value,
  fallback = '—',
  precision = 4,
  className,
  ...props
}: QuantityValueProps) {
  const content =
    typeof value === 'number' && Number.isFinite(value)
      ? formatQuantityValue(value, precision)
      : fallback;

  return (
    <span className={joinClassNames('finance-value', 'quantity-value', className)} {...props}>
      {content}
    </span>
  );
}

export interface DateTimeValueProps extends HTMLAttributes<HTMLSpanElement> {
  value?: string | Date | null;
  fallback?: ReactNode;
  options?: Intl.DateTimeFormatOptions;
}

export function DateTimeValue({
  value,
  fallback = '—',
  options,
  className,
  ...props
}: DateTimeValueProps) {
  const content = value ? formatDateTimeValue(value, options) : fallback;

  return (
    <span className={joinClassNames('finance-value', 'datetime-value', className)} {...props}>
      {content}
    </span>
  );
}

export interface ChangeValueProps extends HTMLAttributes<HTMLSpanElement> {
  amount?: number | null;
  currency?: DisplayCurrency | string;
  percentage?: number | null;
  fallback?: ReactNode;
  tone?: ValueTone;
}

export function ChangeValue({
  amount,
  currency = 'HKD',
  percentage,
  fallback = '—',
  tone = 'neutral',
  className,
  ...props
}: ChangeValueProps) {
  const hasAmount = typeof amount === 'number' && Number.isFinite(amount);
  const hasPercentage = typeof percentage === 'number' && Number.isFinite(percentage);

  if (!hasAmount && !hasPercentage) {
    return (
      <span className={joinClassNames('finance-value', 'change-value', className)} data-tone={tone} {...props}>
        {fallback}
      </span>
    );
  }

  return (
    <span className={joinClassNames('finance-value', 'change-value', className)} data-tone={tone} {...props}>
      {hasAmount ? (
        <strong className="change-value-amount">
          {formatCurrencyValue(amount as number, currency, true)}
        </strong>
      ) : null}
      {hasPercentage ? (
        <span className="change-value-percent">{formatPercentValue(percentage as number, true)}</span>
      ) : null}
    </span>
  );
}
