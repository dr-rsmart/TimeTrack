#!/usr/bin/env node
/**
 * generate-static-legal-pages.mjs
 * --------------------------------
 * Build step (wired into `npm run build`, runs after `vite build`):
 * renders the public legal pages (/privacy, /support) as fully
 * self-contained static HTML files in dist/.
 *
 * The content comes from src/content/privacyPolicy.json and
 * src/content/supportPage.json — the SAME sources the React pages
 * (src/pages/Privacy.tsx, src/pages/Support.tsx) render from, so the
 * static pages can never drift from the in-app pages.
 *
 * The server (server/src/index.ts) serves dist/privacy.html at GET/HEAD
 * /privacy and dist/support.html at GET/HEAD /support, so store-review
 * crawlers read the complete policy text without executing JavaScript.
 *
 * Usage: node scripts/generate-static-legal-pages.mjs
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { renderLegalPage } from './lib/renderLegalPage.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

const PAGES = [
  { json: path.join(ROOT, 'src', 'content', 'privacyPolicy.json'), out: 'privacy.html' },
  { json: path.join(ROOT, 'src', 'content', 'supportPage.json'), out: 'support.html' },
];

if (!existsSync(DIST)) {
  console.error('[legal-pages] dist/ does not exist — run `vite build` first.');
  process.exit(1);
}

let wrote = 0;
for (const { json, out } of PAGES) {
  if (!existsSync(json)) {
    console.error(`[legal-pages] Missing content source: ${path.relative(ROOT, json)}`);
    process.exit(1);
  }
  const page = JSON.parse(readFileSync(json, 'utf8'));
  const html = renderLegalPage(page);
  const target = path.join(DIST, out);
  writeFileSync(target, html, 'utf8');
  wrote += 1;
  console.log(
    `[legal-pages] wrote ${path.relative(ROOT, target)} (${Buffer.byteLength(html)} bytes)`,
  );
}

console.log(`[legal-pages] ✅ ${wrote} static legal page(s) generated.`);
