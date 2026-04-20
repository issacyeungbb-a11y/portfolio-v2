#!/usr/bin/env node
/**
 * Generates server/priceFreshness.js from src/config/priceFreshness.ts.
 *
 * Run:  node scripts/gen-price-freshness.mjs
 * Auto: Runs as `prebuild` before `npm run build`.
 *
 * Transformation rules:
 *   1. Remove the `export interface AssetFreshnessWindows { ... }` block
 *   2. Remove `: AssetFreshnessWindows` type annotations from const declarations
 *   3. Replace the file header with an auto-generated notice
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const tsPath = resolve(__dirname, '../src/config/priceFreshness.ts');
const jsPath = resolve(__dirname, '../server/priceFreshness.js');
const clientJsPath = resolve(__dirname, '../src/config/priceFreshness.js');

const tsSource = readFileSync(tsPath, 'utf8');

// 1. Remove the leading JSDoc block (everything up to and including the first */ )
//    then start from the first `export` declaration
let js = tsSource;

// Remove `export interface AssetFreshnessWindows { ... }` (multi-line)
js = js.replace(/^export interface AssetFreshnessWindows \{[\s\S]*?\n\}\n/m, '');

// Remove TypeScript type annotation `: AssetFreshnessWindows` from const declarations
js = js.replace(/: AssetFreshnessWindows/g, '');

// Remove `readonly ` modifiers (inside interface already removed, but just in case)
js = js.replace(/\breadonly\s+/g, '');

// Replace the file's leading JSDoc comment with auto-generated header
js = js.replace(
  /\/\*\*[\s\S]*?\*\/\n\n/,
  `/**
 * 價格新鮮度集中配置 — server runtime (ESM JS)
 *
 * AUTO-GENERATED — 請勿直接修改此檔案。
 * 來源：src/config/priceFreshness.ts
 * 產生方式：node scripts/gen-price-freshness.mjs（或 npm run prebuild）
 */\n\n`,
);

writeFileSync(jsPath, js, 'utf8');
writeFileSync(clientJsPath, js, 'utf8');
console.log(`[gen-price-freshness] server/priceFreshness.js and src/config/priceFreshness.js regenerated from src/config/priceFreshness.ts`);
