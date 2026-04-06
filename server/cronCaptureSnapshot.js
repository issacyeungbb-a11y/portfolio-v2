import { captureAdminPortfolioSnapshot } from './portfolioSnapshotAdmin.js';
import { verifyCronRequest } from './cronUpdatePrices.js';

const CRON_ROUTE = '/api/cron-capture-snapshot';

class CronSnapshotError extends Error {
    constructor(message, status = 500) {
        super(message);
        this.name = 'CronSnapshotError';
        this.status = status;
    }
}

function buildDailySnapshotId(date = new Date()) {
    const hkDate = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Hong_Kong',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(date);
    return `daily-${hkDate}`;
}

export function verifySnapshotCronRequest(authorizationHeader) {
    try {
        verifyCronRequest(authorizationHeader);
    }
    catch (error) {
        if (error instanceof Error) {
            throw new CronSnapshotError(error.message, error.status ?? 401);
        }
        throw error;
    }
}

export async function runScheduledDailySnapshot() {
    const snapshotId = buildDailySnapshotId();
    const result = await captureAdminPortfolioSnapshot({
        snapshotId,
        reason: 'daily_snapshot',
    });
    return {
        ok: true,
        route: CRON_ROUTE,
        message: `已建立每日資產快照，覆蓋 ${result.assetCount} 項資產。`,
        assetCount: result.assetCount,
        totalValueHKD: result.totalValueHKD,
        snapshotId,
        triggeredAt: new Date().toISOString(),
    };
}

export function getCronSnapshotErrorResponse(error) {
    if (error instanceof CronSnapshotError) {
        return {
            status: error.status,
            body: {
                ok: false,
                route: CRON_ROUTE,
                message: error.message,
            },
        };
    }
    if (error instanceof Error) {
        return {
            status: 500,
            body: {
                ok: false,
                route: CRON_ROUTE,
                message: error.message,
            },
        };
    }
    return {
        status: 500,
        body: {
            ok: false,
            route: CRON_ROUTE,
            message: '每日資產快照失敗，請稍後再試。',
        },
    };
}
