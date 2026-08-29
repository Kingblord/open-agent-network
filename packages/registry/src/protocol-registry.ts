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

import { BANError, ErrorCode } from '@ban/shared';
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

export class ProtocolRegistry {
  private readonly byId = new Map<string, ProtocolRecord>();

  constructor(
    private readonly opts: { chainId?: number; protocols?: ProtocolRecord[] } = {},
  ) {
    for (const p of opts.protocols ?? []) {
      this.register(p);
    }
  }

  get chainId(): number {
    return this.opts.chainId ?? 56;
  }

  register(protocol: ProtocolRecord): void {
    if (protocol.chainId !== this.chainId) {
      throw new BANError(
        ErrorCode.POLICY_DENIED,
        `Protocol ${protocol.id} chainId ${protocol.chainId} does not match registry chain ${this.chainId}`,
      );
    }
    this.byId.set(protocol.id.toLowerCase(), protocol);
  }

  getById(id: string): ProtocolRecord | null {
    return this.byId.get(id.toLowerCase()) ?? null;
  }

  list(): ProtocolRecord[] {
    return [...this.byId.values()];
  }

  isActive(id: string): boolean {
    const record = this.getById(id);
    return Boolean(record && record.status === 'ACTIVE' && record.chainId === this.chainId);
  }

  /** Fail-closed: unregistered / inactive / wrong-chain protocols are denied. */
  requireActive(id: string): ProtocolRecord {
    const record = this.getById(id);
    if (!record) {
      throw new BANError(ErrorCode.POLICY_DENIED, `Protocol not registered: ${id}`);
    }
    if (record.chainId !== this.chainId) {
      throw new BANError(ErrorCode.POLICY_DENIED, `Protocol ${id} is on chain ${record.chainId}, not ${this.chainId}`);
    }
    if (record.status !== 'ACTIVE') {
      throw new BANError(ErrorCode.POLICY_DENIED, `Protocol ${id} is not active (${record.status})`);
    }
    return record;
  }
}