// scripts/patch-schema-fixes.cjs — fix the verified typecheck breakers at the
// source of truth (packages/schemas) + the one permission-repo object shape.
// Exact-match replacements; fails loudly if any pattern is missing.
const fs = require('node:fs');

function patchFile(file, replacements) {
  let src = fs.readFileSync(file, 'utf8');
  const missing = [];
  for (const [from, to] of replacements) {
    if (!src.includes(from)) {
      missing.push(from);
      continue;
    }
    src = src.split(from).join(to);
  }
  if (missing.length > 0) {
    console.error(`MISSING PATTERNS in ${file}:\n  ${missing.join('\n  ')}`);
    process.exitCode = 1;
    return;
  }
  fs.writeFileSync(file, src);
  console.log(`patched OK: ${file}`);
}

// --- packages/schemas/src/index.ts ----------------------------------------
// 1) SessionSchema field typo: schema says `allowerContracts`; every consumer
//    (session-manager, tests, adapter) uses `allowedContracts`. Fix the schema.
// 2) PerforanceSchema/Perforance typo -> canonical PerformanceSchema/Performance,
//    keeping the old names as aliases so no existing package consumer breaks.
patchFile('packages/schemas/src/index.ts', [
  ['  allowerContracts: z.array(AddressSchema),', '  allowedContracts: z.array(AddressSchema),'],
  ['export const PerforanceSchema = z.object({', 'export const PerformanceSchema = z.object({'],
  [
    'export type Perforance = z.infer<typeof PerforanceSchema>;',
    'export type Performance = z.infer<typeof PerformanceSchema>;\n\n// Legacy alias (typo was exported historically; retained so existing consumers compile).\nexport const PerforanceSchema = PerformanceSchema;\nexport type Perforance = Performance;',
  ],
]);

// --- apps/web/lib/permissions/permission-repo.ts ---------------------------
// PermissionSpendSchema requires spendLimit/used/asset. The repo wrote only
// spendCap+perTransactionCap. Fill the full canonical shape (spendLimit is the
// documented alias of spendCap) and accept an optional asset in the input.
patchFile('apps/web/lib/permissions/permission-repo.ts', [
  [
    '  /** Per-transaction ceiling (wei decimal string). */\n  perTransactionCap: string;',
    '  /** Per-transaction ceiling (wei decimal string). */\n  perTransactionCap: string;\n  /** Asset the spend caps are denominated in (symbol; default BNB). */\n  asset?: string;',
  ],
  [
    '    spend: {\n      spendCap: input.spendCap,\n      perTransactionCap: input.perTransactionCap,\n    },',
    '    spend: {\n      spendLimit: input.spendCap, // canonical alias of spendCap (both spellings = same ceiling)\n      spendCap: input.spendCap,\n      perTransactionCap: input.perTransactionCap,\n      used: \'0\',\n      asset: input.asset ?? \'BNB\',\n    },',
  ],
]);

console.log('patch script complete');