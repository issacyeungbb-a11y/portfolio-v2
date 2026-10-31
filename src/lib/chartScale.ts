export interface NiceScale {
  min: number;
  max: number;
  ticks: number[];
}

function niceStep(rawStep: number) {
  const exponent = Math.floor(Math.log10(rawStep));
  const magnitude = 10 ** exponent;
  const fraction = rawStep / magnitude;
  const niceFraction = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 2.5 ? 2.5 : fraction <= 5 ? 5 : 10;
  return niceFraction * magnitude;
}

/** 以整數級距（1、2、2.5、5 × 10ⁿ）建立座標軸刻度，避免出現 847.1K、+10.56% 之類嘅怪數。 */
export function buildNiceScale(
  values: number[],
  { tickCount = 4, includeZero = false }: { tickCount?: number; includeZero?: boolean } = {},
): NiceScale {
  const finite = values.filter((value) => Number.isFinite(value));
  let min = finite.length ? Math.min(...finite) : 0;
  let max = finite.length ? Math.max(...finite) : 1;

  if (includeZero) {
    min = Math.min(min, 0);
    max = Math.max(max, 0);
  }

  if (min === max) {
    const pad = Math.abs(min) * 0.05 || 1;
    min -= pad;
    max += pad;
  }

  const step = niceStep((max - min) / Math.max(1, tickCount));
  const niceMin = Math.floor(min / step) * step;
  const niceMax = Math.ceil(max / step) * step;
  const decimals = Math.max(0, -Math.floor(Math.log10(step)) + 1);
  const ticks: number[] = [];

  for (let tick = niceMin; tick <= niceMax + step / 2; tick += step) {
    ticks.push(Number(tick.toFixed(decimals)));
  }

  return { min: niceMin, max: niceMax, ticks };
}

/** 平均抽取 X 軸標籤位置，必定包括第一同最後一點。 */
export function pickLabelIndices(count: number, maxLabels: number) {
  if (count <= 0) return [];
  if (count === 1) return [0];
  const slots = Math.max(2, Math.min(count, Math.floor(maxLabels)));
  const step = Math.ceil((count - 1) / (slots - 1));
  const indices: number[] = [];

  for (let index = 0; index < count - 1; index += step) {
    indices.push(index);
  }

  // 最後一個標籤太貼近前一個就讓位俾最後一點。
  if (indices.length > 1 && count - 1 - indices[indices.length - 1] <= step / 2) {
    indices.pop();
  }

  indices.push(count - 1);
  return indices;
}
