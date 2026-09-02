/**
 * Surgical patch — EIP-7702 user-funds gate in run-cycle + web dependency.
 *
 * 1) apps/web/lib/agent-runtime/run-cycle.ts
 *    - imports `findActivePermissionForJob` + `PermissionResolver`
 *    - RunCycleOptions gains optional `jobId` + `requiresUserFunds`
 *    - fail-closed gate inserted before the execution step: user-funds jobs
 *      require an ACTIVE, in-scope EIP-7702 permission; otherwise DENY with
 *      an audited AGENT_POLICY_DENIED (never a fabricated execution).
 * 2) apps/web/package.json — adds "@ban/eip7702": "workspace:*" (the existing
 *    permission activate route already imports it).
 *
 * Fails loudly if any anchor is missing — nothing is written unless every
 * pattern matches exactly once. No silent no-ops.
 */
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const runCycleFile = path.join(root, 'apps/web/lib/agent-runtime/run-cycle.ts');
const pkgFile = path.join(root, 'apps/web/package.json');

const missing = [];
function patch(file, label, replacements) {
  let src = fs.readFileSync(file, 'utf8');
  const before = src.length;
  for (const [from, to] of replacements) {
    const count = src.split(from).length - 1;
    if (count !== 1) {
      missing.push(`${label}: anchor found ${count}x -> ${from.slice(0, 60)}`);
      continue;
    }
    src = src.split(from).join(to);
  }
  if (missing.length) return false;
  fs.writeFileSync(file, src);
  console.log(`patched OK: ${label} (${before} -> ${src.length} bytes)`);
  return true;
}

// --- 1) run-cycle gate -----------------------------------------------------
const runCycleOk = patch(
  runCycleFile,
  'run-cycle.ts',
  [
    // imports
    [
      "import { createAgentExecutionBackend, loadAgentKeystore } from '@/lib/altana-signer';",
      "import { createAgentExecutionBackend, loadAgentKeystore } from '@/lib/altana-signer';\nimport { findActivePermissionForJob } from '@/lib/permissions/permission-repo';\nimport { PermissionResolver } from '@ban/eip7702';",
    ],
    // options
    [
      '  onDecision?: (decision: { status: string; reasoning: string; decisionId?: string }) => void;',
      '  onDecision?: (decision: { status: string; reasoning: string; decisionId?: string }) => void;\n  /** Job this cycle belongs to (user-funds permission scoping). */\n  jobId?: string;\n  /** TRUE only for jobs that move the USER\u2019s own funds \u2014 requires an ACTIVE EIP-7702 permission before any execution. */\n  requiresUserFunds?: boolean;',
    ],
    // gate block
    [
      '    // 5) Execution \u2014 only when a real backend is available AND session ACTIVE.',
      `    // 4b) User-funds gate (update-v3 \u00a78\u2013\u00a711): jobs that move the USER's own funds
    // (\`requiresUserFunds\`) require an ACTIVE EIP-7702-backed permission BEFORE any
    // execution. Operational (Altana) jobs skip this gate. Fails closed: a missing,
    // expired, revoked, or out-of-scope permission DENIES the proposal \u2014 the agent can
    // never spend user funds without one. No permission \u21d2 no execution \u21d2 no fabricate.
    if (opts.requiresUserFunds) {
      const permission = await findActivePermissionForJob(agent.id, opts.jobId ?? '');
      let permissionError: unknown = null;
      if (!permission) {
        permissionError = new Error('No ACTIVE user-funds permission bound to this agent+job');
      } else {
        try {
          new PermissionResolver().resolve(permission, {
            protocol: proposal.protocol ?? '',
            contract: proposal.contract ?? '',
            functionName: proposal.function ?? '',
            token: proposal.asset ?? '',
            amount: proposal.amount ?? '0',
          });
        } catch (err) {
          permissionError = err;
        }
      }
      if (permissionError) {
        const reason = permissionError instanceof Error ? permissionError.message : String(permissionError);
        await persistAuditEvent({
          type: 'AGENT_POLICY_DENIED',
          correlationId,
          agentId,
          userId,
          proposalId: proposal.proposalId,
          sessionId: proposal.sessionId,
          severity: 'WARN',
          detail: { deniedCheck: 'user_funds_permission', reason },
        });
        return {
          ok: false,
          reason: \`user_funds_job_no_active_permission: \${reason}\`,
          code: ErrorCode.POLICY_DENIED,
        };
      }
    }

    // 5) Execution \u2014 only when a real backend is available AND session ACTIVE.`,
    ],
  ],
);

// --- 2) web dep ------------------------------------------------------------
const pkgOk = patch(
  pkgFile,
  'apps/web/package.json',
  [
    [
      '"@ban/blockchain": "workspace:*",',
      '"@ban/blockchain": "workspace:*",\n    "@ban/eip7702": "workspace:*",',
    ],
  ],
);

if (missing.length || !runCycleOk || !pkgOk) {
  console.error('ABORTED — missing anchors (nothing written):');
  for (const m of missing) console.error('  -', m);
  process.exit(1);
}

// Post-write verification (belt + braces, no silent no-ops).
const check = (file, needle, label) => {
  const src = fs.readFileSync(file, 'utf8');
  if (!src.includes(needle)) {
    console.error(`VERIFY-FAIL: ${label} missing after patch in ${file}`);
    process.exit(1);
  }
  console.log(`verify OK: ${label}`);
};
check(runCycleFile, 'user_funds_job_no_active_permission', 'gate code present');
check(runCycleFile, 'jobId?: string;', 'RunCycleOptions.jobId present');
check(runCycleFile, "from '@ban/eip7702'", 'eip7702 import present');
check(pkgFile, '"@ban/eip7702": "workspace:*",', 'web dep present');

console.log('patch script complete — all verified.');