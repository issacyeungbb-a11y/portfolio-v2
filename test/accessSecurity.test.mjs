import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';

async function listSourceFiles(dir) {
  const entries = await readdir(new URL(`../${dir}/`, import.meta.url), { withFileTypes: true, recursive: true });
  return entries
    .filter((entry) => entry.isFile() && /\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.d.ts'))
    .map((entry) => `${entry.parentPath ?? entry.path}/${entry.name}`);
}

test('Firestore rules never grant unconditional access', async () => {
  const rules = await readFile(new URL('../firebase/firestore.rules', import.meta.url), 'utf8');

  assert.doesNotMatch(rules, /if true\s*;/);
  assert.match(rules, /request\.auth\.token\.portfolioAccess == true/);
  for (const [, condition] of rules.matchAll(/allow [a-z, ]+: if ([\s\S]*?);/g)) {
    assert.ok(
      condition.trim() === 'false' || condition.trim().startsWith('hasPortfolioAccess()'),
      `Rule condition must require portfolio access: ${condition.trim().slice(0, 80)}`,
    );
  }
});

test('the shared access code is never read by frontend code', async () => {
  const files = await listSourceFiles('src');

  for (const file of files) {
    const source = await readFile(file, 'utf8');
    assert.doesNotMatch(source, /VITE_PORTFOLIO_ACCESS_CODE/, `${file} must not read the access code`);
    // import.meta.env[key] makes Vite inline every VITE_* variable, including the access code.
    assert.doesNotMatch(source, /import\.meta\.env\[/, `${file} must read env vars by name`);
  }
});

test('unlock is served by the existing health function', async () => {
  const health = await readFile(new URL('../api/health.ts', import.meta.url), 'utf8');
  const unlock = await readFile(new URL('../server/portfolioUnlock.ts', import.meta.url), 'utf8');

  assert.match(health, /mode === 'unlock'[\s\S]*requirePortfolioAccess\(request, '\/api\/health'\)[\s\S]*createPortfolioAccessToken\(\)/);
  assert.match(unlock, /createCustomToken\(PORTFOLIO_SHARED_UID, \{\s*\[PORTFOLIO_ACCESS_CLAIM\]: true/);
});
