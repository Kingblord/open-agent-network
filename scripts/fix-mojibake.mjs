#!/usr/bin/env node
/**
 * fix-mojibake.mjs
 * Replaces double-encoded UTF-8 mojibake sequences in app source files
 * with the real Unicode characters they were meant to be:
 *   '—'  ->  '—'   (em dash)
 *   '·'   ->  '·'   (middle dot)
 *   '→'  ->  '→'   (rightwards arrow)
 *   '"'  ->  '"'   (left double quote)
 *   '"'   ->  '"'   (right double quote)
 *   '"™'  ->  '’'   (right single quote)
 *   '"¦'  ->  '…'   (ellipsis)
 *   '§'   ->  '§'   (section sign)
 * Idempotent: running twice changes nothing (replacements don't contain the
 * corrupted sequences).
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const REPLACEMENTS = [
  ['—', '—'],
  ['·', '·'],
  ['→\'', '→'],
  ['→, '→'],
  ['"', '"'],
  ['"', '"'],
  ['"™', '’'],
  ['"˜', '‘'],
  ['"¦', '…'],
  ['§', '§'],
  ['©', '©'],
];

const SRC_DIRS = [
  'apps/web/app',
  'apps/web/components',
  'apps/web/lib',
  'apps/web/inngest',
  'apps/web/tests',
  'packages',
  'scripts',
  'docs',
];

const EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.md']);

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out; // missing dir -> skip
  }
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (EXTENSIONS.has(entry.name.slice(entry.name.lastIndexOf('.')))) out.push(full);
  }
  return out;
}

let changedFiles = 0;
let totalReplacements = 0;

for (const dir of SRC_DIRS) {
  for (const file of walk(dir)) {
    const original = readFileSync(file, 'utf8');
    let next = original;
    for (const [bad, good] of REPLACEMENTS) {
      if (next.includes(bad)) {
        const count = next.split(bad).length - 1;
        next = next.split(bad).join(good);
        totalReplacements += count;
      }
    }
    if (next !== original) {
      writeFileSync(file, next, 'utf8');
      changedFiles += 1;
      console.log(`fixed ${file}`);
    }
  }
}

console.log(`\nDone: ${changedFiles} file(s) changed, ${totalReplacements} replacement(s).`);