// Surgical fixes for the web typecheck failures (Option A permission wiring).
// Fails loudly if any anchor is missing — no silent no-ops, no partial writes.
const fs = require('node:fs');

const missing = [];
function patchFile(file, replacements) {
  let src = fs.readFileSync(file, 'utf8');
  for (const [from, to] of replacements) {
    if (!src.includes(from)) {
      missing.push(`${file} :: ${from.slice(0, 60)}`);
      continue;
    }
    src = src.split(from).join(to);
  }
  if (missing.length) return;
  fs.writeFileSync(file, src);
  console.log('patched OK:', file);
}

// 1) @ban/shared: add FORBIDDEN (403) next to UNAUTHENTICATED (401).
patchFile('packages/shared/src/index.ts', [
  [
    "  UNAUTHENTICATED = 'ERR_UNAUTHENTICATED',",
    "  UNAUTHENTICATED = 'ERR_UNAUTHENTICATED',\r\n  FORBIDDEN = 'ERR_FORBIDDEN',",
  ],
]);

// 2) activate route: UNAUTHORIZED -> FORBIDDEN; drop `?? null` on jobId.
patchFile('apps/web/app/api/permissions/[id]/activate/route.ts', [
  ['code: ErrorCode.UNAUTHORIZED,', 'code: ErrorCode.FORBIDDEN,'],
  ['jobId: permission.jobId ?? null,', 'jobId: permission.jobId,'],
]);

// 3) revoke route: same two fixes.
patchFile('apps/web/app/api/permissions/[id]/revoke/route.ts', [
  ['code: ErrorCode.UNAUTHORIZED,', 'code: ErrorCode.FORBIDDEN,'],
  ['jobId: permission.jobId ?? null,', 'jobId: permission.jobId,'],
]);

// 4) permission-repo: PENDING create must include schema-required nullable fields.
patchFile('apps/web/lib/permissions/permission-repo.ts', [
  [
    "    nonce: '0',",
    "    nonce: '0',\r\n    activationTxHash: null,\r\n    revokedAt: null,",
  ],
]);

if (missing.length) {
  console.error('MISSING ANCHORS (nothing written for those files):');
  for (const m of missing) console.error('  -', m);
  process.exit(1);
}
console.log('patch-permission-fixes complete');