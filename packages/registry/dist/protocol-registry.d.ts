/**
 * ProtocolRegistry — BAN internal source of truth for executable protocols.
 *
 * Mustflow §13:
 *   { "id": "pancakeswap", "chainId": 56, "name": "PancakeSwap",
 *     "status": "ACTIVE", "official": true }
 *
 * A protocol is only executable when:
 *   - id is registered,
 *   - status === "ACTIVE",
 *   - chainId matches the BAN execution chain (56 mainnet by default).
 *
 * `official` is informational; `status` is the authority gate. Fail-closed:
 * unknown/inactive/wrong-chain protocols are denied.
 *
 * Statuses:
 *   - ACTIVE          — registered + enabled for SELECTION (and executable iff
 *                       deployment + contract gates also pass).
 *   - DISCOVERY_ONLY  — recognized/discovered candidate (e.g. Stargate, P3
 *                       cross-chain, before a BAN strategy exists). Never
 *                       executable; informational for the admin page only.
 *   - PAUSED          — previously active, temporarily disabled.
 *   - DEPRECATED      — removed from supported set.
 *
 * Integration metadata (mustflow §13.5, see integration-status.ts):
 *   - `priority` (P0…P3) is a DISCOVERY/ROADMAP hint only — it never grants
 *     execution authority. Execution authority comes from status + the
 *     deployment/contract registries (verified + enabled + EXECUTE).
 *   - `integrationStatus` is a DERIVED, informational view of the same gates
 *     (kept in sync by callers that aggregate deployment/contract state) —
 *     it is never a separate authority source.
 */
import type { IntegrationStatus, ProtocolPriority } from './integration-status.js';
export type ProtocolStatus = 'ACTIVE' | 'DISCOVERY_ONLY' | 'PAUSED' | 'DEPRECATED';
export interface ProtocolRecord {
    id: string;
    chainId: number;
    name: string;
    status: ProtocolStatus;
    /** Recognized as an official deployment (informational). */
    official?: boolean;
    /** Roadmap/discovery priority (informational — does not grant authority). */
    priority?: ProtocolPriority;
    /** Derived integration ladder view (informational). */
    integrationStatus?: IntegrationStatus;
}
export declare class ProtocolRegistry {
    private readonly opts;
    private readonly byId;
    constructor(opts?: {
        chainId?: number;
        protocols?: ProtocolRecord[];
    });
    get chainId(): number;
    register(protocol: ProtocolRecord): void;
    getById(id: string): ProtocolRecord | null;
    list(): ProtocolRecord[];
    isActive(id: string): boolean;
    /** Fail-closed: unregistered / inactive / wrong-chain protocols are denied. */
    requireActive(id: string): ProtocolRecord;
}
//# sourceMappingURL=protocol-registry.d.ts.map