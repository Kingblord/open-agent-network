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
 */

import { BANError, ErrorCode } from '@ban/shared';
import { isValidAddress, normalizeAddress, assertSameAddress } from './address-verifier.js';

export type ContractCapability = 'READ_ONLY' | 'EXECUTE';

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
}

export class ContractRegistry {
  private readonly byId = new Map<string, ContractRecord>();
  private readonly byAddress = new Map<string, ContractRecord>();

  constructor(
    private readonly opts: { chainId?: number; contracts?: ContractRecord[] } = {},
  ) {
    for (const c of opts.contracts ?? []) {
      this.register(c);
    }
  }

  get chainId(): number {
    return this.opts.chainId ?? 56;
  }

  register(contract: ContractRecord): void {
    if (contract.chainId !== this.chainId) {
      throw new BANError(
        ErrorCode.CONTRACT_NOT_ALLOWED,
        `Contract ${contract.id} chainId ${contract.chainId} does not match registry chain ${this.chainId}`,
      );
    }
    if (!isValidAddress(contract.address)) {
      throw new BANError(ErrorCode.SCHEMA_INVALID, `Contract ${contract.id} has invalid address ${contract.address}`);
    }
    if (!contract.functions || contract.functions.length === 0) {
      throw new BANError(ErrorCode.SCHEMA_INVALID, `Contract ${contract.id} requires at least one declared function`);
    }
    for (const fn of contract.functions) {
      if (!fn.name || !fn.signature) {
        throw new BANError(ErrorCode.SCHEMA_INVALID, `Contract ${contract.id} has an incomplete function spec (name + signature required)`);
      }
      if (fn.capability !== 'READ_ONLY' && fn.capability !== 'EXECUTE') {
        throw new BANError(ErrorCode.SCHEMA_INVALID, `Contract ${contract.id} function ${fn.name} has invalid capability ${String(fn.capability)}`);
      }
    }
    this.byId.set(contract.id.toLowerCase(), contract);
    this.byAddress.set(normalizeAddress(contract.address), contract);
  }

  getById(id: string): ContractRecord | null {
    return this.byId.get(id.toLowerCase()) ?? null;
  }

  getByAddress(address: string): ContractRecord | null {
    return this.byAddress.get(normalizeAddress(address)) ?? null;
  }

  list(): ContractRecord[] {
    return [...this.byId.values()];
  }

  /** Whether a contract address is registered on the BAN chain at all. */
  isRegistered(address: string): boolean {
    const record = this.getByAddress(address);
    return Boolean(record);
  }

  /**
   * Whether a (contract, function) pair may be read (state/quotes/preflight).
   * Fail-closed: unregistered / disabled / wrong-chain / undeclared fn → false.
   */
  canRead(address: string, functionName: string): boolean {
    const record = this.getByAddress(address);
    if (!record || !record.verified || !record.enabled || record.chainId !== this.chainId) return false;
    return record.functions.some((fn) => fn.name === functionName);
  }

  /**
   * Whether a (contract, function) pair may be EXECUTED autonomously.
   * Fail-closed: requires registered + verified + enabled + on-chain +
   * function declared with `EXECUTE`.
   */
  canExecute(address: string, functionName: string): boolean {
    const record = this.getByAddress(address);
    if (!record || !record.verified || !record.enabled || record.chainId !== this.chainId) return false;
    return record.functions.some((fn) => fn.name === functionName && fn.capability === 'EXECUTE');
  }

  /** Fail-closed authority check for read access. */
  requireRead(address: string, functionName: string): ContractRecord {
    this.requireRegistered(address);
    const record = this.getByAddress(address)!;
    if (!record.functions.some((fn) => fn.name === functionName)) {
      throw new BANError(ErrorCode.FUNCTION_NOT_ALLOWED, `Read of undeclared function ${functionName} on ${record.name} is not allowed`);
    }
    return record;
  }

  /** Fail-closed authority check for EXECUTE. */
  requireExecute(address: string, functionName: string): ContractRecord {
    this.requireRegistered(address);
    const record = this.getByAddress(address)!;
    if (!record.functions.some((fn) => fn.name === functionName)) {
      throw new BANError(ErrorCode.FUNCTION_NOT_ALLOWED, `Function ${functionName} is not declared on ${record.name}`);
    }
    if (!record.functions.some((fn) => fn.name === functionName && fn.capability === 'EXECUTE')) {
      throw new BANError(ErrorCode.FUNCTION_NOT_ALLOWED, `Function ${functionName} on ${record.name} is READ_ONLY, not an executable entry point`);
    }
    return record;
  }

  /** Equivalence via constant-time address comparison. */
  matchesAddress(a: string, b: string): boolean {
    return assertSameAddress(a, b);
  }

  private requireRegistered(address: string): void {
    const record = this.getByAddress(address);
    if (!record) throw new BANError(ErrorCode.CONTRACT_NOT_ALLOWED, `Contract ${address} is not registered`);
    if (!record.verified) throw new BANError(ErrorCode.CONTRACT_NOT_ALLOWED, `Contract ${record.name} is not verified`);
    if (!record.enabled) throw new BANError(ErrorCode.CONTRACT_NOT_ALLOWED, `Contract ${record.name} is verified but not enabled for autonomous execution`);
    if (record.chainId !== this.chainId) throw new BANError(ErrorCode.CONTRACT_NOT_ALLOWED, `Contract ${record.name} is on chain ${record.chainId}, not ${this.chainId}`);
  }
}