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
export class ContractRegistry {
    opts;
    byId = new Map();
    byAddress = new Map();
    constructor(opts = {}) {
        this.opts = opts;
        for (const c of opts.contracts ?? []) {
            this.register(c);
        }
    }
    get chainId() {
        return this.opts.chainId ?? 56;
    }
    register(contract) {
        if (contract.chainId !== this.chainId) {
            throw new BANError(ErrorCode.CONTRACT_NOT_ALLOWED, `Contract ${contract.id} chainId ${contract.chainId} does not match registry chain ${this.chainId}`);
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
    getById(id) {
        return this.byId.get(id.toLowerCase()) ?? null;
    }
    getByAddress(address) {
        return this.byAddress.get(normalizeAddress(address)) ?? null;
    }
    list() {
        return [...this.byId.values()];
    }
    /** Whether a contract address is registered on the BAN chain at all. */
    isRegistered(address) {
        const record = this.getByAddress(address);
        return Boolean(record);
    }
    /**
     * Whether a (contract, function) pair may be read (state/quotes/preflight).
     * Fail-closed: unregistered / disabled / wrong-chain / undeclared fn → false.
     */
    canRead(address, functionName) {
        const record = this.getByAddress(address);
        if (!record || !record.verified || !record.enabled || record.chainId !== this.chainId)
            return false;
        return record.functions.some((fn) => fn.name === functionName);
    }
    /**
     * Whether a (contract, function) pair may be EXECUTED autonomously.
     * Fail-closed: requires registered + verified + enabled + on-chain +
     * function declared with `EXECUTE`.
     */
    canExecute(address, functionName) {
        const record = this.getByAddress(address);
        if (!record || !record.verified || !record.enabled || record.chainId !== this.chainId)
            return false;
        return record.functions.some((fn) => fn.name === functionName && fn.capability === 'EXECUTE');
    }
    /** Fail-closed authority check for read access. */
    requireRead(address, functionName) {
        this.requireRegistered(address);
        const record = this.getByAddress(address);
        if (!record.functions.some((fn) => fn.name === functionName)) {
            throw new BANError(ErrorCode.FUNCTION_NOT_ALLOWED, `Read of undeclared function ${functionName} on ${record.name} is not allowed`);
        }
        return record;
    }
    /** Fail-closed authority check for EXECUTE. */
    requireExecute(address, functionName) {
        this.requireRegistered(address);
        const record = this.getByAddress(address);
        if (!record.functions.some((fn) => fn.name === functionName)) {
            throw new BANError(ErrorCode.FUNCTION_NOT_ALLOWED, `Function ${functionName} is not declared on ${record.name}`);
        }
        if (!record.functions.some((fn) => fn.name === functionName && fn.capability === 'EXECUTE')) {
            throw new BANError(ErrorCode.FUNCTION_NOT_ALLOWED, `Function ${functionName} on ${record.name} is READ_ONLY, not an executable entry point`);
        }
        return record;
    }
    /** Equivalence via constant-time address comparison. */
    matchesAddress(a, b) {
        return assertSameAddress(a, b);
    }
    requireRegistered(address) {
        const record = this.getByAddress(address);
        if (!record)
            throw new BANError(ErrorCode.CONTRACT_NOT_ALLOWED, `Contract ${address} is not registered`);
        if (!record.verified)
            throw new BANError(ErrorCode.CONTRACT_NOT_ALLOWED, `Contract ${record.name} is not verified`);
        if (!record.enabled)
            throw new BANError(ErrorCode.CONTRACT_NOT_ALLOWED, `Contract ${record.name} is verified but not enabled for autonomous execution`);
        if (record.chainId !== this.chainId)
            throw new BANError(ErrorCode.CONTRACT_NOT_ALLOWED, `Contract ${record.name} is on chain ${record.chainId}, not ${this.chainId}`);
    }
}
