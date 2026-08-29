/**
 * Registry snapshot — the combined, admin-facing view of BAN's protocol set
 * (mustflow §13.5: admin/settings page shows supported protocols, verification
 * status, contracts, capabilities, and whether an integration is
 * DISCOVERY_ONLY / READ_ONLY / SIMULATION / EXECUTION_ENABLED).
 *
 * IMPORTANT: the snapshot is DERIVED from the fail-closed registries. It
 * contains NO authority of its own — it exists purely so the control plane
 * (and a human) can SEE exactly why a protocol/contract sits where it does on
 * the integration ladder. The ladder is computed by
 * `deriveContractIntegrationStatus` from the same booleans the
 * ContractRegistry gates use (verified / enabled / has EXECUTE capability),
 * so the displayed status can never diverge from the actual authority
 * decision (mustflow §12, §14).
 */

import { BNB_CHAIN_ID } from './bnb-mainnet.js';
import { createBnbRegistries } from './bnb-mainnet.js';
import { BNB_MAINNET_CONTRACTS } from './bnb-contracts.js';
import { ContractRegistry } from './contract-registry.js';
import { deriveProtocolIntegrationStatus, INTEGRATION_LADDER, type IntegrationStatus } from './integration-status.js';

export interface ContractSnapshotEntry {
  id: string;
  address: string;
  protocolId: string;
  name: string;
  verified: boolean;
  enabled: boolean;
  /** Declared per-function capabilities (e.g. SWAP, LENDING). */
  capabilities: string[];
  /** Derived integration status (never independent authority). */
  integrationStatus: IntegrationStatus;
  reason: string;
  /** Allowed function names + capability (READ_ONLY vs EXECUTE). */
  functions: Array<{ name: string; capability: string }>;
}

export interface ProtocolSnapshotEntry {
  id: string;
  name: string;
  status: string;
  official: boolean;
  priority?: string;
  /** Derived integration ladder (best of its contracts; DISCOVERY_ONLY if none). */
  integrationStatus: IntegrationStatus;
  reason: string;
  contracts: ContractSnapshotEntry[];
}

export interface RegistrySnapshot {
  chainId: number;
  generatedAt: string;
  tokens: Array<{
    id: string;
    symbol: string;
    name: string;
    address: string;
    decimals: number;
    verified: boolean;
    enabled: boolean;
    native?: boolean;
  }>;
  protocols: ProtocolSnapshotEntry[];
}

/**
 * Build the admin-facing snapshot for the BAN execution chain. Never throws on
 * missing pieces: any protocol/contract that can't be derived shows its
 * fail-closed state (DISCOVERY_ONLY + reason) rather than hiding.
 */
export function buildBnbRegistrySnapshot(chainId: number = BNB_CHAIN_ID): RegistrySnapshot {
  const { tokens, protocols } = createBnbRegistries(chainId);
  const contractRegistry = new ContractRegistry({ chainId, contracts: BNB_MAINNET_CONTRACTS });

  const contractsByProtocol = new Map<string, ContractSnapshotEntry[]>();
  for (const c of contractRegistry.list()) {
    const info = contractRegistry.getIntegrationStatus(c.address);
    const entry: ContractSnapshotEntry = {
      id: c.id,
      address: c.address,
      protocolId: c.protocolId,
      name: c.name,
      verified: c.verified,
      enabled: c.enabled,
      capabilities: c.capabilities ?? [],
      integrationStatus: info.status,
      reason: info.reason,
      functions: c.functions.map((f) => ({ name: f.name, capability: f.capability })),
    };
    const list = contractsByProtocol.get(c.protocolId) ?? [];
    list.push(entry);
    contractsByProtocol.set(c.protocolId, list);
  }

  const protocolSnapshot: ProtocolSnapshotEntry[] = protocols
    .list()
    .map((p) => {
      const records = contractsByProtocol.get(p.id) ?? [];
      const ladder = deriveProtocolIntegrationStatus(
        records.map((r) => ({
          verified: r.verified,
          enabled: r.enabled,
          hasExecuteCapability: r.functions.some((f) => f.capability === 'EXECUTE'),
          hasReadCapability: r.functions.some((f) => f.capability === 'READ_ONLY'),
        })),
      );
      return {
        id: p.id,
        name: p.name,
        status: p.status,
        official: Boolean(p.official),
        priority: p.priority,
        integrationStatus: ladder.status,
        reason: ladder.reason,
        contracts: records,
      };
    })
    .sort((a, b) => {
      // Sort by priority (P0 first), then by integration ladder (descending).
      const pOrder = { P0: 0, P1: 1, P2: 2, P3: 3 } as const;
      const pa = pOrder[(a.priority ?? 'P3') as keyof typeof pOrder] ?? 3;
      const pb = pOrder[(b.priority ?? 'P3') as keyof typeof pOrder] ?? 3;
      if (pa !== pb) return pa - pb;
      return INTEGRATION_LADDER.indexOf(b.integrationStatus) - INTEGRATION_LADDER.indexOf(a.integrationStatus);
    });

  return {
    chainId,
    generatedAt: new Date().toISOString(),
    tokens: tokens.list().map((t) => ({
      id: t.id,
      symbol: t.symbol,
      name: t.name,
      address: t.address,
      decimals: t.decimals,
      verified: t.verified,
      enabled: t.enabled,
      native: t.native,
    })),
    protocols: protocolSnapshot,
  };
}