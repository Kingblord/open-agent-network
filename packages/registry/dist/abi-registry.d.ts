/**
 * AbiRegistry — BAN internal source of truth for verified ABI entries
 * (mustflow §10).
 *
 * A contract's ABI is not the authority — the ContractRegistry record is.
 * AbiRegistry only stores the canonical ABI fragment per (contract, function)
 * so the signer/execution path can look up encodings WITHOUT accepting an
 * arbitrary AI/frontend-supplied ABI. Fail-closed:
 *   - unknown contract → deny,
 *   - known contract but undeclared function → deny,
 *   - declared function with no ABI fragment → deny (never guess an encoding).
 */
export interface AbiFunctionFragment {
    type: 'function';
    name: string;
    stateMutability: 'view' | 'nonpayable' | 'payable';
    inputs: Array<{
        name: string;
        type: string;
    }>;
    outputs: Array<{
        name: string;
        type: string;
    }>;
}
export interface ContractAbiRecord {
    address: string;
    chainId: number;
    /** All declared functions for the contract. */
    functions: AbiFunctionFragment[];
}
export declare class AbiRegistry {
    private readonly opts;
    private readonly byAddress;
    constructor(opts?: {
        chainId?: number;
        abis?: ContractAbiRecord[];
    });
    get chainId(): number;
    register(abi: ContractAbiRecord): void;
    get(address: string): ContractAbiRecord | null;
    /** Fail-closed: returns the verified ABI function fragment for (contract, fn). */
    requireFunction(address: string, functionName: string): AbiFunctionFragment;
    hasFunction(address: string, functionName: string): boolean;
}
//# sourceMappingURL=abi-registry.d.ts.map