/**
 * ContractRegistry — BAN internal source of truth for executable contracts
 * (mustflow §10, §12–14).
 *
 * Capability model (§14):
 *   - Each registered contract has a per-function capability:
 *     `READ_ONLY` (quotes, balances, state reads) vs `EXECUTE` (state-changing
 *     autonomous actions).
 *   - A contract is executable only when registered AND verified AND enabled
 *     AND on the BAN execution chain AND the requested function is declared
 *     with `EXECUTE` capability.
 *   - A contract that is not registered is DENIED (fail-closed). Registered but
 *     not-enabled contracts are recognized but never executable — the same
 *     verified ≠ enabled split as TokenRegistry (§12).
 *
 * The registry never enables arbitrary calldata (§13): every executable path
 * must resolve through a registered function with a declared capability.
 *
 * Provenance fields (mustflow §13.5):
 *   - `capabilities` — high-level capabilities this contract participates in
 *     (e.g. SWAP / LP / LENDING / YIELD / CROSS_CHAIN). Informational.
 *   - `abiVersion` — which ABI/interface version the registered ABI fragment
 *     corresponds to (e.g. "v3", "comptroller-v2"). Informational.
 *   - `source` — where the recognized address/candidate came from
 *     (e.g. "bgd-labs/aave-address-book", "pancakeswap-smart-router-sdk").
 *     Informational; never grants authority.
 *   - `lastVerifiedAt` — ISO timestamp of the last successful on-chain
 *     verification (set by the seed-catalog verification pipeline). Never
 *     set by hand.
 *
 * `getIntegrationStatus()` derives the 4-step ladder from the SAME fail-closed
 * gates (verified/enabled/EXECUTE), so the displayed status can never diverge
 * from the actual authority decision.
 */
import { type IntegrationStatusInfo } from './integration-status.js';
export type ContractCapability = 'READ_ONLY' | 'EXECUTE';
/** High-level capability tags a contract participates in (informational). */
export type ContractCapabilityTag = 'SWAP' | 'LP' | 'LENDING' | 'YIELD' | 'BRIDGE' | 'CROSS_CHAIN' | 'STAKING' | 'PRICE' | 'GOVERNANCE';
/** Per-function declaration inside a contract record. */
export interface ContractFunctionSpec {
    /** Canonical function signature, e.g. "swapExactTokensForTokens(uint256,uint256,address[],address,uint256)". */
    signature: string;
    /** Short selector/name for lookup, e.g. "swapExactTokensForTokens". */
    name: string;
    capability: ContractCapability;
    /** Entry points whose addresses are read at execution time (routers, factories). */
    reads?: string[];
}
export interface ContractRecord {
    id: string;
    chainId: number;
    address: string;
    protocolId: string;
    name: string;
    /** Recognized as a real/verified deployment. */
    verified: boolean;
    /** Allowed for autonomous execution. verified ≠ enabled. */
    enabled: boolean;
    /** Per-function capability declarations. */
    functions: ContractFunctionSpec[];
    /** Informational provenance/roadmap (never authority). */
    capabilities?: ContractCapabilityTag[];
    /** Informational ABI/interface version tag. */
    abiVersion?: string;
    /** Provenance token for where this candidate came from (e.g. official SDK). */
    source?: string[];
    /** ISO timestamp set by the verification pipeline when last verified on-chain. */
    lastVerifiedAt?: string;
}
export declare class ContractRegistry {
    private readonly opts;
    private readonly byId;
    private readonly byAddress;
    constructor(opts?: {
        chainId?: number;
        contracts?: ContractRecord[];
    });
    get chainId(): number;
    register(contract: ContractRecord): void;
    getById(id: string): ContractRecord | null;
    getByAddress(address: string): ContractRecord | null;
    list(): ContractRecord[];
    /** Whether a contract address is registered on the BAN chain at all. */
    isRegistered(address: string): boolean;
    /**
     * Whether a (contract, function) pair may be read (state/quotes/preflight).
     * Fail-closed: unregistered / disabled / wrong-chain / undeclared fn → false.
     */
    canRead(address: string, functionName: string): boolean;
    /**
     * Whether a (contract, function) pair may be EXECUTED autonomously.
     * Fail-closed: requires registered + verified + enabled + on-chain +
     * function declared with `EXECUTE`.
     */
    canExecute(address: string, functionName: string): boolean;
    /** Fail-closed authority check for read access. */
    requireRead(address: string, functionName: string): ContractRecord;
    /** Fail-closed authority check for EXECUTE. */
    requireExecute(address: string, functionName: string): ContractRecord;
    /**
     * Derived integration ladder status for a registered contract.
     * Fail-closed: unknown address → DISCOVERY_ONLY.
     */
    getIntegrationStatus(address: string): IntegrationStatusInfo;
    /** Convenience: integration status by record id. */
    getIntegrationStatusById(id: string): IntegrationStatusInfo;
    /** Equivalence via constant-time address comparison. */
    matchesAddress(a: string, b: string): boolean;
    private requireRegistered;
}
//# sourceMappingURL=contract-registry.d.ts.map