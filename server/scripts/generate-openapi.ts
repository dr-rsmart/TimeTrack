/**
 * Generates docs/openapi.json from the server's Zod-derived OpenAPI registry
 * so the checked-in spec can be diffed in review and consumed by tooling.
 *
 * Usage: npm run openapi:generate   (from server/)
 */
import { writeFileSync, mkdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { buildOpenApiDocument } from '../src/openapi.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(__dirname, '..', 'docs');
mkdirSync(outDir, { recursive: true });
const target = path.join(outDir, 'openapi.json');
const doc = buildOpenApiDocument();
writeFileSync(target, JSON.stringify(doc, null, 2) + '\n', 'utf8');
console.log(`[openapi] Wrote ${Object.keys(doc.paths).length} paths to ${target}`);
