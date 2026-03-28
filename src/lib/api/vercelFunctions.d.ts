export type PortfolioFunctionKey = 'health' | 'extract-assets' | 'update-prices' | 'analyze';
export declare const portfolioFunctionConfig: Record<PortfolioFunctionKey, {
    path: string;
    method: 'GET' | 'POST';
}>;
export declare function callPortfolioFunction(key: PortfolioFunctionKey, payload?: unknown): Promise<unknown>;
