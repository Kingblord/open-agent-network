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
export type ProtocolStatus = 'ACTIVE' | 'PAUSED' | 'DEPRECATED';
export interface ProtocolRecord {
    id: string;
    chainId: number;
    name: string;
    status: ProtocolStatus;
    /** Recognized as an official deployment (informational). */
    official?: boolean;
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