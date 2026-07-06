#!/usr/bin/env node
/**
 * Regenerates the committed ESM `.js` runtime artifacts from their `.ts` sources.
 *
 * Run:  node scripts/build-shared-js.mjs
 * Auto: Runs as `prebuild`（npm run build 前）及 `pretest`（npm test 前）。
 *
 * 背景：Vercel functions、node 測試同 scripts 直接 import 呢啲 `.js` 檔，
 * 而唔係 `.ts` 源碼。呢個腳本確保兩邊永遠一致，避免部署到過時邏輯。
 *
 * 涵蓋範圍：
 *   - server/*.ts（唔包括 *.test.ts / *.d.ts）
 *   - server 端共用嘅 src 模組（見 SHARED_SRC_MODULES）
 *   - server/priceFreshness.js 由 scripts/gen-price-freshness.mjs 另行生成
 */

import { readdirSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { buildSync } from 'esbuild';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');

// server 端 runtime 會 import 嘅 src 共用模組（有 committed .js 產物）
const SHARED_SRC_MODULES = [
  'src/lib/currency.ts',
  'src/lib/holdings.ts',
  'src/lib/portfolio/reportAllocationSummary.ts',
];

const serverEntries = readdirSync(join(rootDir, 'server'))
  .filter(
    (name) =>
      name.endsWith('.ts') && !name.endsWith('.test.ts') && !name.endsWith('.d.ts'),
  )
  .map((name) => join('server', name));

const entries = [...serverEntries, ...SHARED_SRC_MODULES];

// node ESM 需要 relative import 帶 .js 副檔名；esbuild transform 會保留
// 源碼寫法（例如 './analysisIntent'），所以出檔前補返 .js。
function ensureJsExtensions(code) {
  return code.replace(
    /(from\s*|import\()\s*"(\.{1,2}\/[^"]+)"/g,
    (match, prefix, specifier) => {
      if (/\.(js|mjs|cjs|json)$/.test(specifier)) {
        return match;
      }
      return `${prefix}"${specifier}.js"`;
    },
  );
}

let generated = 0;
for (const entry of entries) {
  const tsPath = join(rootDir, entry);
  if (!existsSync(tsPath)) {
    console.error(`[build-shared-js] missing source: ${entry}`);
    process.exitCode = 1;
    continue;
  }

  // build API（非 transform）先會讀 tsconfig 設定，輸出先同舊有產物一致
  const result = buildSync({
    entryPoints: [tsPath],
    format: 'esm',
    bundle: false,
    write: false,
    outfile: tsPath.replace(/\.ts$/, '.js'),
  });

  const [output] = result.outputFiles;
  writeFileSync(output.path, ensureJsExtensions(output.text), 'utf8');
  generated += 1;
}

console.log(`[build-shared-js] regenerated ${generated} runtime .js files from .ts sources`);
