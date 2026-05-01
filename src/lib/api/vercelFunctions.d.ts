export type PortfolioFunctionKey = 'health' | 'extract-assets' | 'extract-transactions' | 'manual-monthly-analysis' | 'manual-quarterly-report' | 'manual-capture-snapshot' | 'parse-assets-command' | 'parse-transactions-command' | 'update-prices' | 'analyze';
export declare const portfolioFunctionConfig: Record<PortfolioFunctionKey, {
    path: string;
    method: 'GET' | 'POST';
}>;
export declare function callPortfolioFunction(key: PortfolioFunctionKey, payload?: unknown): Promise<unknown>;
export declare function triggerManualSnapshot(): Promise<unknown>;
