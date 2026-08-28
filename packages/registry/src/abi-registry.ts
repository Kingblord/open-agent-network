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

import { BANError, ErrorCode } from '@ban/shared';
import { normalizeAddress } from './address-verifier.js';

export interface AbiFunctionFragment {
  type: 'function';
  name: string;
  stateMutability: 'view' | 'nonpayable' | 'payable';
  inputs: Array<{ name: string; type: string }>;
  outputs: Array<{ name: string; type: string }>;
}

export interface ContractAbiRecord {
  address: string;
  chainId: number;
  /** All declared functions for the contract. */
  functions: AbiFunctionFragment[];
}

export class AbiRegistry {
  private readonly byAddress = new Map<string, ContractAbiRecord>();

  constructor(
    private readonly opts: { chainId?: number; abis?: ContractAbiRecord[] } = {},
  ) {
    for (const a of opts.abis ?? []) {
      this.register(a);
    }
  }

  get chainId(): number {
    return this.opts.chainId ?? 56;
  }

  register(abi: ContractAbiRecord): void {
    if (abi.chainId !== this.chainId) {
      throw new BANError(ErrorCode.SCHEMA_INVALID, `ABI for ${abi.address} is on chain ${abi.chainId}, not ${this.chainId}`);
    }
    if (abi.functions.length === 0) {
      throw new BANError(ErrorCode.SCHEMA_INVALID, `ABI for ${abi.address} must declare at least one function`);
    }
    this.byAddress.set(normalizeAddress(abi.address), abi);
  }

  get(address: string): ContractAbiRecord | null {
    return this.byAddress.get(normalizeAddress(address)) ?? null;
  }

  /** Fail-closed: returns the verified ABI function fragment for (contract, fn). */
  requireFunction(address: string, functionName: string): AbiFunctionFragment {
    const abi = this.get(address);
    if (!abi) throw new BANError(ErrorCode.CONTRACT_NOT_ALLOWED, `No ABI registered for contract ${address}`);
    const fn = abi.functions.find((f) => f.name === functionName);
    if (!fn) throw new BANError(ErrorCode.FUNCTION_NOT_ALLOWED, `Function ${functionName} is not declared in the verified ABI of ${address}`);
    return fn;
  }

  hasFunction(address: string, functionName: string): boolean {
    const abi = this.get(address);
    if (!abi) return false;
    return abi.functions.some((f) => f.name === functionName);
  }
}