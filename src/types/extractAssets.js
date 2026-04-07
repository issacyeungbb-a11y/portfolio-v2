export function createEditableExtractedAsset(asset, index) {
    return {
        id: `extracted-${index}-${asset.ticker ?? 'asset'}`,
        name: asset.name ?? '',
        ticker: asset.ticker ?? '',
        type: asset.type ?? '',
        quantity: asset.quantity == null ? '' : String(asset.quantity),
        currency: asset.currency ?? '',
        costBasis: asset.costBasis == null ? '' : String(asset.costBasis),
        currentPrice: asset.currentPrice == null ? '' : String(asset.currentPrice),
    };
}
export function createEditableExtractedTransaction(entry, index) {
    return {
        id: `extracted-transaction-${index}-${entry.ticker ?? 'transaction'}`,
        name: entry.name ?? '',
        ticker: entry.ticker ?? '',
        type: entry.type ?? '',
        transactionType: entry.transactionType ?? '',
        quantity: entry.quantity == null ? '' : String(entry.quantity),
        currency: entry.currency ?? '',
        price: entry.price == null ? '' : String(entry.price),
        fees: entry.fees == null ? '0' : String(entry.fees),
        date: entry.date ?? new Date().toISOString().slice(0, 10),
        note: entry.note ?? '',
    };
}
export function getMissingExtractedAssetFields(asset) {
    const missing = [];
    if (!asset.name.trim()) {
        missing.push('name');
    }
    if (!asset.ticker.trim()) {
        missing.push('ticker');
    }
    if (!asset.type) {
        missing.push('type');
    }
    if (!asset.quantity.trim()) {
        missing.push('quantity');
    }
    if (!asset.currency.trim()) {
        missing.push('currency');
    }
    if (!asset.costBasis.trim()) {
        missing.push('costBasis');
    }
    return missing;
}
export function getMissingExtractedTransactionFields(entry) {
    const missing = [];
    if (!entry.ticker.trim()) {
        missing.push('ticker');
    }
    if (!entry.transactionType) {
        missing.push('transactionType');
    }
    if (!entry.quantity.trim()) {
        missing.push('quantity');
    }
    if (!entry.currency.trim()) {
        missing.push('currency');
    }
    if (!entry.price.trim()) {
        missing.push('price');
    }
    if (!entry.date.trim()) {
        missing.push('date');
    }
    return missing;
}
export function buildPortfolioAssetInputFromExtractedAsset(asset, accountSource) {
    const normalizedCurrency = asset.currency.trim().toUpperCase();
    const normalizedCostBasis = Number(asset.costBasis);
    const normalizedCurrentPrice = asset.currentPrice.trim()
        ? Number(asset.currentPrice)
        : asset.type === 'cash'
            ? normalizedCostBasis
            : 0;
    return {
        name: asset.name.trim(),
        symbol: asset.ticker.trim().toUpperCase(),
        assetType: asset.type,
        accountSource,
        currency: normalizedCurrency,
        quantity: Number(asset.quantity),
        averageCost: normalizedCostBasis,
        currentPrice: normalizedCurrentPrice,
    };
}
