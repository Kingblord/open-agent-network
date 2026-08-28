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
 */
import { BANError, ErrorCode } from '@ban/shared';
export class ProtocolRegistry {
    opts;
    byId = new Map();
    constructor(opts = {}) {
        this.opts = opts;
        for (const p of opts.protocols ?? []) {
            this.register(p);
        }
    }
    get chainId() {
        return this.opts.chainId ?? 56;
    }
    register(protocol) {
        if (protocol.chainId !== this.chainId) {
            throw new BANError(ErrorCode.POLICY_DENIED, `Protocol ${protocol.id} chainId ${protocol.chainId} does not match registry chain ${this.chainId}`);
        }
        this.byId.set(protocol.id.toLowerCase(), protocol);
    }
    getById(id) {
        return this.byId.get(id.toLowerCase()) ?? null;
    }
    list() {
        return [...this.byId.values()];
    }
    isActive(id) {
        const record = this.getById(id);
        return Boolean(record && record.status === 'ACTIVE' && record.chainId === this.chainId);
    }
    /** Fail-closed: unregistered / inactive / wrong-chain protocols are denied. */
    requireActive(id) {
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
