import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

test('public portfolio reads protected documents through Firebase Admin', async () => {
  const source = await readFile(new URL('../api/health.ts', import.meta.url), 'utf8');

  assert.match(source, /import \{ getFirebaseAdminDb \} from '\.\.\/server\/firebaseAdmin\.js'/);
  assert.match(source, /\.collection\('portfolio'\)[\s\S]*?\.doc\('app'\)[\s\S]*?\.collection\('assets'\)[\s\S]*?\.get\(\)/);
  assert.match(
    source,
    /\.collection\('accountValuationOverrides'\)[\s\S]*?\.doc\('Crypto'\)[\s\S]*?\.get\(\)/,
  );
  assert.doesNotMatch(source, /firestore\.googleapis\.com/);
  assert.match(source, /requestCode !== configuredCode/);
  assert.match(source, /sendJson\(response, 200, \{\s*ok: true,\s*assets,/);
});
