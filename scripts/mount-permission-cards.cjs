// scripts/mount-permission-cards.cjs
// Surgical mount of <PermissionCards> into /my-agents/[id] — NO full-file rewrite.
// Line-ending tolerant: anchors are single-line strings (no newlines); insertions
// use the file's dominant EOL (\r\n vs \n) so we never corrupt mixed endings.
// Each anchor must occur EXACTLY once, else the script fails loudly, writes nothing.
const fs = require('node:fs');
const file = 'apps/web/app/my-agents/[id]/page.tsx';
let src = fs.readFileSync(file, 'utf8');
const before = src.length;
const missing = [];

const eol = (src.match(/\r\n/g) || []).length >= (src.match(/(?<!\r)\n/g) || []).length ? '\r\n' : '\n';

const apply = (anchor, replacement, label, { count = 1 } = {}) => {
  const occurrences = src.split(anchor).length - 1;
  if (occurrences !== count) {
    missing.push(`${label} (found ${occurrences}, expected ${count})`);
    return;
  }
  src = src.split(anchor).join(replacement);
};

// 1) Import — one line, appears once (line-ending agnostic).
apply(
  "import { LiveRuntimeTerminal } from '@/components/live-runtime-terminal';",
  "import { LiveRuntimeTerminal } from '@/components/live-runtime-terminal';" +
    eol +
    "import { PermissionCards } from '@/components/permission-cards';",
  'import-LiveRuntimeTerminal',
);

// 2) JSX — permission-records card inserted immediately BEFORE the LIVE ACTIVITY
//    card. Anchor is a single unique comment line; the inserted block uses the
//    detected dominant EOL.
const permissionCardBlock = [
  '        {/* EIP-7702 PERMISSIONS (USER FUNDS) — one-time bounded authorization records */}',
  '        <div className="bg-[#111] rounded-xl p-5 border border-[#222]">',
  '          <PermissionCards agentId={agent.id} />',
  '        </div>',
  '',
  '        {/* LIVE ACTIVITY */}',
].join(eol);

apply('        {/* LIVE ACTIVITY */}', permissionCardBlock, 'anchor-LIVE-ACTIVITY');

if (missing.length) {
  console.error('MISSING ANCHORS (nothing written):', missing.join(', '));
  process.exit(1);
}

fs.writeFileSync(file, src);
console.log('patched OK:', file, `bytes ${before} -> ${src.length} (eol=${JSON.stringify(eol)})`);