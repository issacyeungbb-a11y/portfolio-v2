import { convertCurrency } from '../currency.js';
import { allocationBucketOrder, getAllocationBucketMeta, } from '../holdings.js';
function isAllocationBucketKey(value) {
    return (value === 'stock' ||
        value === 'etf' ||
        value === 'bond' ||
        value === 'crypto' ||
        value === 'cash');
}
function toFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}
function normalizeDateKey(value) {
    const trimmed = value.trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
        return trimmed.slice(0, 10);
    }
    const parsed = new Date(trimmed);
    return Number.isNaN(parsed.getTime()) ? trimmed : parsed.toISOString().slice(0, 10);
}
function getInputValueHKD(holding) {
    const explicitHKD = toFiniteNumber(holding.marketValueHKD);
    if (explicitHKD > 0) {
        return explicitHKD;
    }
    const totalValueHKD = toFiniteNumber(holding.totalValueHKD);
    if (totalValueHKD > 0) {
        return totalValueHKD;
    }
    const currency = holding.currency?.trim() || 'HKD';
    const marketValue = toFiniteNumber(holding.marketValue);
    if (marketValue > 0) {
        return convertCurrency(marketValue, currency, 'HKD');
    }
    const quantity = toFiniteNumber(holding.quantity);
    const currentPrice = toFiniteNumber(holding.currentPrice);
    return convertCurrency(quantity * currentPrice, currency, 'HKD');
}
function getSlicePercentage(slices, key) {
    return slices.find((slice) => slice.key === key)?.percentage ?? 0;
}
function buildReportAllocationSlices(holdings) {
    const buckets = new Map();
    for (const holding of holdings) {
        if (!isAllocationBucketKey(holding.assetType)) {
            continue;
        }
        const valueHKD = getInputValueHKD(holding);
        if (valueHKD <= 0) {
            continue;
        }
        buckets.set(holding.assetType, (buckets.get(holding.assetType) ?? 0) + valueHKD);
    }
    const totalValueHKD = [...buckets.values()].reduce((sum, value) => sum + value, 0);
    return allocationBucketOrder
        .map((key) => {
        const totalValueHKDForBucket = buckets.get(key) ?? 0;
        const meta = getAllocationBucketMeta(key);
        return {
            key,
            label: meta.label,
            color: meta.color,
            percentage: totalValueHKD === 0 ? 0 : (totalValueHKDForBucket / totalValueHKD) * 100,
            totalValueHKD: totalValueHKDForBucket,
            totalValueUSD: convertCurrency(totalValueHKDForBucket, 'HKD', 'USD'),
        };
    })
        .filter((slice) => slice.totalValueHKD > 0)
        .sort((left, right) => right.totalValueHKD - left.totalValueHKD);
}
export function buildAllocationDeltas(currentSlices, previousSlices) {
    const keys = allocationBucketOrder.filter((key) => currentSlices.some((slice) => slice.key === key) ||
        previousSlices.some((slice) => slice.key === key));
    return keys.map((key) => ({
        key,
        deltaPercentagePoints: getSlicePercentage(currentSlices, key) - getSlicePercentage(previousSlices, key),
    }));
}
export function deriveAllocationStyleTag(slices) {
    const sorted = [...slices].sort((left, right) => right.percentage - left.percentage);
    const largest = sorted[0]?.percentage ?? 0;
    const secondLargest = sorted[1]?.percentage ?? 0;
    const stockAndEtf = getSlicePercentage(slices, 'stock') + getSlicePercentage(slices, 'etf');
    const cash = getSlicePercentage(slices, 'cash');
    const bondAndCash = getSlicePercentage(slices, 'bond') + cash;
    const crypto = getSlicePercentage(slices, 'crypto');
    if (largest > 55 || largest - secondLargest > 20) {
        return '高集中型';
    }
    if (cash >= 35 || bondAndCash >= 45) {
        return '防守型';
    }
    if ((stockAndEtf >= 75 && cash < 15) || crypto > 20) {
        return '進攻型';
    }
    if (largest <= 50 && cash >= 5 && cash <= 35 && crypto <= 20) {
        return '平衡型';
    }
    if (cash < 5 || stockAndEtf > 65) {
        return '進攻型';
    }
    return '平衡型';
}
export function deriveAllocationWarningTags(slices) {
    const sorted = [...slices].sort((left, right) => right.percentage - left.percentage);
    const largest = sorted[0]?.percentage ?? 0;
    const stockAndEtf = getSlicePercentage(slices, 'stock') + getSlicePercentage(slices, 'etf');
    const cash = getSlicePercentage(slices, 'cash');
    const crypto = getSlicePercentage(slices, 'crypto');
    const tags = [];
    if (largest > 50)
        tags.push('單一類別集中');
    if (cash < 5)
        tags.push('現金偏低');
    if (cash > 35)
        tags.push('現金偏高');
    if (crypto > 20)
        tags.push('加密資產偏高');
    if (stockAndEtf > 80)
        tags.push('股票偏高');
    if (tags.length < 2 && largest <= 50) {
        tags.push('類別較分散');
    }
    if (tags.length < 2 && cash >= 5 && cash <= 35) {
        tags.push('現金緩衝適中');
    }
    if (tags.length < 2 && crypto <= 20) {
        tags.push('加密資產可控');
    }
    if (tags.length < 2 && stockAndEtf <= 80) {
        tags.push('股票曝險可控');
    }
    return tags.slice(0, 4);
}
function getStylePhrase(styleTag) {
    if (styleTag === '進攻型')
        return '偏進攻配置';
    if (styleTag === '防守型')
        return '偏防守配置';
    if (styleTag === '高集中型')
        return '高集中配置';
    return '相對平衡配置';
}
function buildSummarySentence(slices, styleTag, warningTags, deltas) {
    const dominantSlice = slices[0];
    const leadingPhrase = dominantSlice
        ? `目前組合以${dominantSlice.label}為主`
        : '目前組合未有有效資產分佈';
    const warningPhrase = warningTags.find((tag) => tag.includes('現金')) ??
        warningTags.find((tag) => tag.includes('集中')) ??
        warningTags[0] ??
        '未見明顯分佈告警';
    const notableDelta = deltas
        ?.filter((delta) => Math.abs(delta.deltaPercentagePoints) >= 3)
        .sort((left, right) => Math.abs(right.deltaPercentagePoints) - Math.abs(left.deltaPercentagePoints))[0];
    if (notableDelta) {
        const meta = getAllocationBucketMeta(notableDelta.key);
        const direction = notableDelta.deltaPercentagePoints > 0 ? '上升' : '下降';
        return `${leadingPhrase}，${warningPhrase}，整體屬${getStylePhrase(styleTag)}；較上期${meta.label}${direction}${Math.round(Math.abs(notableDelta.deltaPercentagePoints))}pp。`;
    }
    return `${leadingPhrase}，${warningPhrase}，整體屬${getStylePhrase(styleTag)}。`;
}
export function buildReportAllocationSummaryFromHoldings(params) {
    const slices = buildReportAllocationSlices(params.holdings);
    const previousSlices = params.comparisonHoldings && params.comparisonHoldings.length > 0
        ? buildReportAllocationSlices(params.comparisonHoldings)
        : [];
    const deltas = previousSlices.length > 0 ? buildAllocationDeltas(slices, previousSlices) : undefined;
    const styleTag = deriveAllocationStyleTag(slices);
    const warningTags = deriveAllocationWarningTags(slices);
    const dominantBucketKey = slices[0]?.key;
    const totalValueHKD = slices.reduce((sum, slice) => sum + slice.totalValueHKD, 0);
    const summary = {
        asOfDate: normalizeDateKey(params.asOfDate),
        basis: params.basis,
        styleTag,
        warningTags,
        slices,
        totalValueHKD,
        summarySentence: buildSummarySentence(slices, styleTag, warningTags, deltas),
    };
    if (dominantBucketKey) {
        summary.dominantBucketKey = dominantBucketKey;
    }
    if (deltas?.length) {
        summary.deltas = deltas;
    }
    if (deltas?.length && params.comparisonLabel) {
        summary.comparisonLabel = params.comparisonLabel;
    }
    return summary;
}
function normalizeSliceSummary(value) {
    if (typeof value !== 'object' || value === null) {
        return null;
    }
    const raw = value;
    if (!isAllocationBucketKey(raw.key)) {
        return null;
    }
    const meta = getAllocationBucketMeta(raw.key);
    return {
        key: raw.key,
        label: typeof raw.label === 'string' && raw.label.trim() ? raw.label.trim() : meta.label,
        color: typeof raw.color === 'string' && raw.color.trim() ? raw.color.trim() : meta.color,
        percentage: toFiniteNumber(raw.percentage),
        totalValueHKD: toFiniteNumber(raw.totalValueHKD),
        totalValueUSD: toFiniteNumber(raw.totalValueUSD),
    };
}
function normalizeDeltaSummary(value) {
    if (typeof value !== 'object' || value === null) {
        return null;
    }
    const raw = value;
    if (!isAllocationBucketKey(raw.key)) {
        return null;
    }
    return {
        key: raw.key,
        deltaPercentagePoints: toFiniteNumber(raw.deltaPercentagePoints),
    };
}
function isReportAllocationStyleTag(value) {
    return (value === '平衡型' ||
        value === '進攻型' ||
        value === '防守型' ||
        value === '高集中型');
}
function isReportAllocationBasis(value) {
    return value === 'monthly' || value === 'quarterly';
}
export function normalizeReportAllocationSummary(value) {
    if (typeof value !== 'object' || value === null) {
        return undefined;
    }
    const raw = value;
    const slices = Array.isArray(raw.slices)
        ? raw.slices.map(normalizeSliceSummary).filter((slice) => slice !== null)
        : [];
    if (!isReportAllocationBasis(raw.basis) || !isReportAllocationStyleTag(raw.styleTag)) {
        return undefined;
    }
    const deltas = Array.isArray(raw.deltas)
        ? raw.deltas.map(normalizeDeltaSummary).filter((delta) => delta !== null)
        : undefined;
    return {
        asOfDate: typeof raw.asOfDate === 'string' ? normalizeDateKey(raw.asOfDate) : '',
        basis: raw.basis,
        comparisonLabel: typeof raw.comparisonLabel === 'string' && raw.comparisonLabel.trim()
            ? raw.comparisonLabel.trim()
            : undefined,
        styleTag: raw.styleTag,
        warningTags: Array.isArray(raw.warningTags)
            ? raw.warningTags
                .filter((tag) => typeof tag === 'string' && tag.trim().length > 0)
                .slice(0, 4)
            : [],
        dominantBucketKey: isAllocationBucketKey(raw.dominantBucketKey)
            ? raw.dominantBucketKey
            : slices[0]?.key,
        slices,
        deltas: deltas && deltas.length > 0 ? deltas : undefined,
        totalValueHKD: toFiniteNumber(raw.totalValueHKD),
        summarySentence: typeof raw.summarySentence === 'string' && raw.summarySentence.trim()
            ? raw.summarySentence.trim()
            : undefined,
    };
}
