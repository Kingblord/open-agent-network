/**
 * Surgical patch for the two live-test findings (run once, idempotent):
 *   A) live-provider.ts — venusVTokens() now filters empty/invalid role
 *      addresses and falls back to the verified VENUS_VTOKENS seed set.
 *   B) strategy-lp/src/lp-strategy.ts — pool address must be a real address;
 *      a protocol name is never treated as a pool (fail-closed, clear error).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));

function read(rel) {
  return readFileSync(ROOT + rel, 'utf8');
}
function write(rel, text) {
  writeFileSync(ROOT + rel, text, 'utf8');
}
function replaceOne(rel, text, anchor, replacement, label) {
  if (!text.includes(anchor)) {
    throw new Error(`ANCHOR NOT FOUND in ${rel}: ${label}`);
  }
  return text.replace(anchor, replacement);
}

let changed = 0;

// ---------------------------------------------------------------------------
// A) live-provider.ts
// ---------------------------------------------------------------------------
const lpRel = 'packages/blockchain/src/live-provider.ts';
let lp = read(lpRel);

const importAnchor = `import {
  BNB_MAINNET_CONTRACTS,
  ContractRegistry,
  TokenRegistry,
  DeploymentRegistry,
  createBnbRegistries,
  type TokenRecord,
} from '@ban/registry';`;
const importReplacement = `import {
  BNB_MAINNET_CONTRACTS,
  VENUS_VTOKENS,
  isValidAddress,
  ContractRegistry,
  TokenRegistry,
  DeploymentRegistry,
  createBnbRegistries,
  type TokenRecord,
} from '@ban/registry';`;
lp = replaceOne(lpRel, lp, importAnchor, importReplacement, 'import block');

const venusAnchor = `  private venusVTokens(): Array<{ address: string; symbol: string; decimals: number }> {
    const dep = this.deployments.get('venus');
    if (!dep || !dep.verified) return [];
    const out: Array<{ address: string; symbol: string; decimals: number }> = [];
    for (const [role, addr] of Object.entries(dep.contracts)) {
      const base = role.startsWith('vToken.') ? role.slice('vToken.'.length) : role;
      // Only vToken roles (vBNB / vUSDT / vUSDC / vETH / vBTC …) are pooled
      // for Venus reads; roles like \`comptroller\` / \`oracle\` are excluded.
      if (!/^v[A-Z][A-Z0-9]*$/.test(base)) continue;
      out.push({ address: addr, symbol: base.replace(/^v/, ''), decimals: 18 });
    }
    return out;
  }`;
const venusReplacement = `  private venusVTokens(): Array<{ address: string; symbol: string; decimals: number }> {
    const out: Array<{ address: string; symbol: string; decimals: number }> = [];
    const seen = new Set<string>();
    const dep = this.deployments.get('venus');
    // 1) Registered deployment roles (vBNB / vUSDT / …). Any structurally
    //    invalid or empty role address is SKIPPED (never read as garbage) —
    //    this is what previously produced "Address \\"\\" is invalid".
    if (dep && dep.verified) {
      for (const [role, addr] of Object.entries(dep.contracts)) {
        const base = role.startsWith('vToken.') ? role.slice('vToken.'.length) : role;
        // Only vToken roles (vBNB / vUSDT / vUSDC / vETH / vBTC …) are pooled
        // for Venus reads; roles like \`comptroller\` / \`oracle\` are excluded.
        if (!/^v[A-Z][A-Z0-9]*$/.test(base)) continue;
        if (!isValidAddress(addr)) continue; // empty/placeholder → never read
        const key = addr.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ address: addr, symbol: base.replace(/^v/, ''), decimals: 18 });
      }
    }
    // 2) Fallback to the verified VENUS_VTOKENS seed set whenever a market
    //    isn't already covered — so live reads ALWAYS resolve to the real,
    //    verified vToken addresses even when the control-plane deployment
    //    registry carries only a subset or placeholder roles.
    for (const [symbol, addr] of Object.entries(VENUS_VTOKENS)) {
      const vSymbol = symbol.replace(/^v/, '');
      if (out.some((o) => o.symbol === vSymbol)) continue;
      const key = addr.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ address: addr, symbol: vSymbol, decimals: 18 });
    }
    return out;
  }`;
lp = replaceOne(lpRel, lp, venusAnchor, venusReplacement, 'venusVTokens method');
write(lpRel, lp);
changed++;

// ---------------------------------------------------------------------------
// B) strategy-lp/src/lp-strategy.ts
// ---------------------------------------------------------------------------
const spRel = 'packages/strategy-lp/src/lp-strategy.ts';
let sp = read(spRel);

const spImportAnchor = `import type { StrategyEngine } from '@ban/agent-core';
import type { BrainAdapter } from '@ban/ai';`;
const spImportReplacement = `import type { StrategyEngine } from '@ban/agent-core';
import type { BrainAdapter } from '@ban/ai';
import { isValidAddress } from '@ban/registry';`;
sp = replaceOne(spRel, sp, spImportAnchor, spImportReplacement, 'import block');

const spPoolAnchor = `    // Task-config threading: allow an explicit pool address from the task row;
    // fall back to the agent's first protocol. Fail-closed (never fabricates).
    const poolAddress =
      typeof this.config?.poolAddress === 'string' && this.config!.poolAddress
        ? (this.config!.poolAddress as string)
        : (agent.protocols[0] ?? '');`;
const spPoolReplacement = `    // Task-config threading: a pool address is REQUIRED to observe (a real
    // PancakeSwap V3 pool). We accept only a structurally-valid address from
    // config.poolAddress (task row). We NEVER treat a protocol name like
    // "pancakeswap" as an address — that would throw a viem address error.
    // If no valid pool address is configured, fail closed with a clear,
    // actionable PROVIDER_UNAVAILABLE instead of contacting a guessed address.
    const rawPool =
      typeof this.config?.poolAddress === 'string' && this.config!.poolAddress
        ? (this.config!.poolAddress as string)
        : '';
    if (!isValidAddress(rawPool)) {
      throw new BANError(
        ErrorCode.PROVIDER_UNAVAILABLE,
        'LP strategy requires a real PancakeSwap V3 pool address in task config (config.poolAddress); none provided. Refusing to guess an address or read a protocol name as a pool.',
        { retryable: true },
      );
    }
    const poolAddress = rawPool;`;
sp = replaceOne(spRel, sp, spPoolAnchor, spPoolReplacement, 'pool resolution block');
write(spRel, sp);
changed++;

console.log(`patch-live-fixes: applied ${changed} file(s) successfully.`);