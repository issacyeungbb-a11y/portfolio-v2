import type { ParseAssetsCommandResponse } from '../src/types/extractAssets';
export declare function getParseAssetsCommandErrorResponse(error: unknown): {
    status: number;
    body: {
        ok: boolean;
        route: "/api/parse-assets-command";
        message: string;
    };
};
export declare function parseAssetsFromCommand(payload: unknown): Promise<ParseAssetsCommandResponse>;
