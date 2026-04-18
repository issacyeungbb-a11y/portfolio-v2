import { FieldValue } from 'firebase-admin/firestore';
import {
  getFirebaseAdminDb,
  getSharedCoinGeckoCoinIdOverridesCollectionRef,
} from '../server/firebaseAdmin.js';

const overrides = [
  { ticker: 'ASTER', coinId: 'aster-2', coinSymbol: 'ASTER', coinName: 'ASTER' },
  { ticker: 'ATONE', coinId: 'atomone', coinSymbol: 'ATONE', coinName: 'ATONE' },
  { ticker: 'NIGHT', coinId: 'midnight-3', coinSymbol: 'NIGHT', coinName: 'Midnight' },
];

async function main() {
  const db = getFirebaseAdminDb();
  const collection = getSharedCoinGeckoCoinIdOverridesCollectionRef();
  const batch = db.batch();

  for (const override of overrides) {
    batch.set(
      collection.doc(override.ticker),
      {
        ticker: override.ticker,
        coinId: override.coinId,
        coinSymbol: override.coinSymbol,
        coinName: override.coinName,
        marketCapRank: null,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  }

  await batch.commit();
  console.info(`已寫入 ${overrides.length} 個 CoinGecko override 到 Firestore。`);
}

main().catch((error) => {
  console.error('seed-coin-id-overrides 失敗：', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
