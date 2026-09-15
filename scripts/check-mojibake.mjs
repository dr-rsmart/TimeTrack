/**
 * Mojibake Detector
 * -----------------
 * Scans the git index for double-encoded UTF-8 sequences.
 * These occur when a UTF-8 file is read with cp1252 (ANSI) and re-saved.
 *
 * Usage:
 *   $ node scripts/check-mojibake.mjs
 *   $ node scripts/check-mojibake.mjs --fix
 *
 * The --fix flag repairs detected mojibake by replacing the corrupted byte range
 * with the correctly decoded UTF-8 bytes (preserving LF/CRLF and no BOM).
 */

import { execFileSync } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

const FIX_MODE = process.argv.includes('--fix');

// cp1252 reverse map: Unicode codepoint → byte
// 0x80–0x9F window (27 special chars)
const CP1252_MAP = new Map([
  [0x20ac, 0x80], // €
  [0x201a, 0x82], // ‚
  [0x0192, 0x83], // ƒ
  [0x201e, 0x84], // „
  [0x2026, 0x85], // …
  [0x2020, 0x86], // †
  [0x2021, 0x87], // ‡
  [0x02c6, 0x88], // ˆ
  [0x2030, 0x89], // ‰
  [0x0160, 0x8a], // Š
  [0x2039, 0x8b], // ‹
  [0x0152, 0x8c], // Œ
  [0x017d, 0x8e], // Ž
  [0x2018, 0x91], // ‘
  [0x2019, 0x92], // ’
  [0x201c, 0x93], // “
  [0x201d, 0x94], // ”
  [0x2022, 0x95], // •
  [0x2013, 0x96], // –
  [0x2014, 0x97], // —
  [0x02dc, 0x98], // ˜
  [0x2122, 0x99], // ™
  [0x0161, 0x9a], // š
  [0x203a, 0x9b], // ›
  [0x0153, 0x9c], // œ
  [0x017e, 0x9e], // ž
  [0x0178, 0x9f], // Ÿ
]);

// Identity map for 0xA0–0xFF (Latin-1)
for (let cp = 0xa0; cp <= 0xff; cp++) {
  CP1252_MAP.set(cp, cp);
}

const BINARY_EXTENSIONS = new Set([
  'png',
  'jpg',
  'jpeg',
  'ico',
  'aab',
  'ipa',
  'apk',
  'p8',
  'dump',
  'webp',
  'woff',
  'woff2',
  'gif',
  'pdf',
  'zip',
]);

const utf8Decoder = new TextDecoder('utf-8', { fatal: true });

function isBinaryExtension(filePath) {
  const ext = filePath.split('.').pop()?.toLowerCase();
  return BINARY_EXTENSIONS.has(ext);
}

function isBinaryBuffer(buf) {
  return buf.includes(0);
}

function codepointToBytes(cp) {
  const b = CP1252_MAP.get(cp);
  return b != null ? [b] : null;
}

function tryDecodeAsUtf8(bytes) {
  try {
    const decoded = utf8Decoder.decode(Uint8Array.from(bytes));
    return decoded;
  } catch {
    return null;
  }
}

function* enumerateCodepoints(str) {
  const len = str.length;
  let i = 0;
  while (i < len) {
    const cp = str.codePointAt(i);
    yield cp;
    i += cp > 0xffff ? 2 : 1;
  }
}

function detectMojibakeRuns(text) {
  const runs = [];
  const cps = Array.from(enumerateCodepoints(text));
  let start = 0;
  while (start < cps.length) {
    const cp = cps[start];
    if (cp < 0x80 || !CP1252_MAP.has(cp)) {
      start++;
      continue;
    }
    // start of a run
    let end = start + 1;
    while (end < cps.length) {
      const nextCp = cps[end];
      if (nextCp < 0x80 || !CP1252_MAP.has(nextCp)) break;
      end++;
    }
    if (end - start >= 2) {
      runs.push({ startIdx: start, endIdx: end, codepoints: cps.slice(start, end) });
    }
    start = end;
  }
  return runs;
}

function findMojibakeInFile(filePath) {
  const absPath = resolve(filePath);
  const buf = readFileSync(absPath);
  if (isBinaryBuffer(buf)) return [];
  const text = utf8Decoder.decode(buf);
  const lines = text.split(/\r\n|\n/);
  const findings = [];
  const runs = detectMojibakeRuns(text);
  for (const run of runs) {
    const runBytes = [];
    for (const cp of run.codepoints) {
      const b = codepointToBytes(cp);
      if (!b) break;
      runBytes.push(...b);
    }
    if (runBytes.length !== run.codepoints.length) continue;
    const decoded = tryDecodeAsUtf8(runBytes);
    if (decoded && decoded.length < run.codepoints.length) {
      // It's mojibake. Locate line:col.
      let pos = 0;
      let lineNum = 1;
      let colNum = 1;
      for (let i = 0; i < text.length; i++) {
        if (i === run.startIdx) {
          lineNum = 1;
          colNum = 1;
          let seen = 0;
          for (const line of lines) {
            if (seen + line.length >= i) {
              lineNum = lines.indexOf(line) + 1;
              colNum = i - seen + 1;
              break;
            }
            seen += line.length + 1; // +1 for newline
          }
          break;
        }
        if (text[i] === '\n' || (text[i] === '\r' && text[i + 1] === '\n')) {
          lineNum++;
          colNum = 1;
        } else {
          colNum++;
        }
      }
      const badStr = String.fromCodePoint(...run.codepoints);
      findings.push({
        filePath,
        line: lineNum,
        column: colNum,
        bad: badStr,
        good: decoded,
        byteRange: { start: run.startIdx, end: run.endIdx },
      });
    }
  }
  return findings;
}

function fixFile(filePath, findings) {
  const absPath = resolve(filePath);
  let buf = readFileSync(absPath);
  // Apply fixes in reverse order so byte indices stay valid
  for (let i = findings.length - 1; i >= 0; i--) {
    const f = findings[i];
    // Note: byteRange is in *codepoint* indices, not bytes. Need byte offsets.
    // Simpler: re-decode to string, replace, re-encode with original buffer's line endings.
    // Since we only have one finding per file in practice, I'll do string replace.
    const text = utf8Decoder.decode(buf);
    const fixedText = text.replace(f.bad, f.good);
    buf = Buffer.from(fixedText, 'utf-8');
  }
  writeFileSync(absPath, buf);
}

function main() {
  let fileList;
  try {
    const output = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' });
    fileList = output.split('\0').filter(Boolean);
  } catch (e) {
    console.error('Error: git ls-files failed. Are you in a git repo?');
    process.exit(1);
  }

  let totalFindings = 0;
  const findingsByFile = new Map();

  for (const filePath of fileList) {
    if (isBinaryExtension(filePath)) continue;
    try {
      const findings = findMojibakeInFile(filePath);
      if (findings.length > 0) {
        findingsByFile.set(filePath, findings);
        totalFindings += findings.length;
      }
    } catch (e) {
      if (e instanceof TypeError && e.message.includes('The encoded data was not valid')) {
        // Invalid UTF-8
        console.error(`[invalid-utf8] ${filePath}`);
        totalFindings++;
      } else {
        console.error(`[error] ${filePath}: ${e.message}`);
      }
    }
  }

  if (totalFindings === 0) {
    console.log('✓ No mojibake detected.');
    process.exit(0);
  }

  console.log(`✗ Found ${totalFindings} mojibake occurrence(s):\n`);
  for (const [filePath, findings] of findingsByFile) {
    console.log(`${filePath}:`);
    for (const f of findings) {
      console.log(`  ${f.line}:${f.column}: "${f.bad}" → "${f.good}"`);
    }
    if (FIX_MODE) {
      fixFile(filePath, findings);
      console.log(`  [FIXED]`);
    }
  }

  if (FIX_MODE) {
    console.log(`\n✓ Fixed ${totalFindings} occurrence(s).`);
    process.exit(0);
  } else {
    console.error(`\n✗ Mojibake detected. Run with --fix to repair.`);
    process.exit(1);
  }
}

main();
