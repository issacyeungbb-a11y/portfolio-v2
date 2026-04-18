/**
 * One-off migration：清理 priceUpdateReviews 集合入面遺留嘅 needsReview 欄位。
 * 原因：全 repo 冇任何代碼寫或讀呢個欄位（已用 grep 確認），但 Firestore 文件上
 * 仲保留咗，容易令人誤以為有 review 未處理。只保留 status 作為事實來源。
 *
 * 用法：npx tsx scripts/cleanup-needs-review-flag.ts
 */
import { FieldValue } from 'firebase-admin/firestore';
import { getFirebaseAdminDb } from '../server/firebaseAdmin.js';

async function main() {
  const db = getFirebaseAdminDb();
  const portfolioRef = db.collection('portfolio').doc('app');
  const reviewsRef = portfolioRef.collection('priceUpdateReviews');

  const snapshot = await reviewsRef.get();
  console.info(`掃描 ${snapshot.size} 份 priceUpdateReviews 文件…`);

  let cleaned = 0;
  const batch = db.batch();

  for (const doc of snapshot.docs) {
    const data = doc.data() as Record<string, unknown>;
    if ('needsReview' in data) {
      batch.update(doc.ref, { needsReview: FieldValue.delete() });
      cleaned += 1;
      console.info(`  - 清理 ${doc.id} (ticker=${data.ticker ?? '?'})`);
    }
  }

  if (cleaned === 0) {
    console.info('✅ 冇任何文件需要清理。');
    return;
  }

  await batch.commit();
  console.info(`✅ 已清理 ${cleaned} 份文件嘅 needsReview 欄位。`);
}

main().catch((err) => {
  console.error('❌ 清理失敗：', err);
  process.exit(1);
});
