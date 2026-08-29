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
import { type IntegrationStatus } from './integration-status.js';
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
    functions: Array<{
        name: string;
        capability: string;
    }>;
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
export declare function buildBnbRegistrySnapshot(chainId?: number): RegistrySnapshot;
//# sourceMappingURL=snapshot.d.ts.map