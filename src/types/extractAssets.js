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
