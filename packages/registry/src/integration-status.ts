/**
 * IntegrationStatus — BAN integration ladder (mustflow §13.5).
 *
 * Every registered protocol/contract sits on a 4-step ladder:
 *
 *   DISCOVERY_ONLY  recognized/discovered candidate — no live reads, no execution
 *   READ_ONLY       verified deployment, live read-only access (quotes, balances,
 *                   pool state, health factors) — NO autonomous execution
 *   SIMULATION      read-only + simulation/preflight supported — still NO execution
 *   EXECUTION_ENABLED  verified + enabled + at least one declared EXECUTE
 *                   capability — autonomous execution allowed
 *
 * The ladder is DERIVED from the registry's own fail-closed booleans
 * (verified / enabled / per-function capability) so there is exactly one
 * source of truth: no separate "status" flag can ever diverge from the
 * security gates (mustflow §12 verified ≠ executable; §14 capability model).
 *
 * Convention used by this package:
 *   - ProtocolRecord: exposed via `.integrationStatus` (derived from
 *     DeploymentRegistry + ContractRegistry state) and `.priority` (P0…P3).
 *   - ContractRecord: exposed via `ContractRegistry.getIntegrationStatus()`.
 */

export type IntegrationStatus =
  | 'DISCOVERY_ONLY'
  | 'READ_ONLY'
  | 'SIMULATION'
  | 'EXECUTION_ENABLED';

export type ProtocolPriority = 'P0' | 'P1' | 'P2' | 'P3';

export interface IntegrationStatusInfo {
  status: IntegrationStatus;
  /**
   * Human description of exactly why this status applies. Always references
   * the real gate state (verified/enabled/EXECUTE capability) — never a guess.
   */
  reason: string;
}

/** Ordered ladder for comparison (later index = more permissive). */
export const INTEGRATION_LADDER: readonly IntegrationStatus[] = [
  'DISCOVERY_ONLY',
  'READ_ONLY',
  'SIMULATION',
  'EXECUTION_ENABLED',
];

export function isAtLeast(
  current: IntegrationStatus,
  threshold: IntegrationStatus,
): boolean {
  return INTEGRATION_LADDER.indexOf(current) >= INTEGRATION_LADDER.indexOf(threshold);
}

/**
 * Derive a contract's integration status purely from the registry record.
 * Fail-closed defaults: any missing/invalid gate state → DISCOVERY_ONLY.
 */
export function deriveContractIntegrationStatus(input: {
  verified: boolean;
  enabled: boolean;
  hasExecuteCapability: boolean;
  hasReadCapability: boolean;
}): IntegrationStatusInfo {
  const { verified, enabled, hasExecuteCapability, hasReadCapability } = input;
  if (!verified) {
    return {
      status: 'DISCOVERY_ONLY',
      reason: 'Not verified on-chain — recognized candidate only (verified ≠ executable).',
    };
  }
  if (!enabled) {
    return {
      status: hasReadCapability ? 'READ_ONLY' : 'DISCOVERY_ONLY',
      reason: hasReadCapability
        ? 'Verified but not enabled — read-only access allowed; execution denied (verified ≠ enabled).'
        : 'Verified but has no declared read capability and is not enabled.',
    };
  }
  if (!hasExecuteCapability) {
    return {
      status: hasReadCapability ? 'SIMULATION' : 'READ_ONLY',
      reason: 'Enabled but declares no EXECUTE capability — read/simulation only, no autonomous execution.',
    };
  }
  return {
    status: 'EXECUTION_ENABLED',
    reason: 'Verified + enabled + declared EXECUTE capability — autonomous execution allowed.',
  };
}

/**
 * Derive a protocol's integration status from the contracts actually
 * registered for it (fail-closed: no registered contracts → DISCOVERY_ONLY).
 */
export function deriveProtocolIntegrationStatus(records: Array<{
  verified: boolean;
  enabled: boolean;
  hasExecuteCapability: boolean;
  hasReadCapability: boolean;
}>): IntegrationStatusInfo {
  if (records.length === 0) {
    return {
      status: 'DISCOVERY_ONLY',
      reason: 'No registered contracts for this protocol on the BAN chain.',
    };
  }
  // Highest status wins (any verified+enabled+EXECUTE contract ⇒ executable).
  let best: IntegrationStatusInfo = {
    status: 'DISCOVERY_ONLY',
    reason: 'No verified contracts for this protocol.',
  };
  for (const r of records) {
    const info = deriveContractIntegrationStatus(r);
    if (INTEGRATION_LADDER.indexOf(info.status) > INTEGRATION_LADDER.indexOf(best.status)) {
      best = info;
    }
  }
  return best;
}