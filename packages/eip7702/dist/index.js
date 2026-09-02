import { createLogger } from '@ban/shared';
// Re-export all pure primitives + lifecycle helpers for API/UI/execution consumers.
export { EIP7702_AUTHORIZATION_TYPE, BAN_MAINNET_CHAIN_ID } from './authorization.js';
export { toAuthorizationTuple, fromAuthorizationTuple, eip7702Digest, computeAuthority, buildDelegationState, delegationStateFromPermission, } from './authorization.js';
export { toAuthorizationList, eip7702Chain, submitAuthorization, devTestingAccount, agentWalletAccount, } from './executor.js';
export { permissionConfigHash, withConfigHash, } from './permission-binding.js';
export { assertActivatable, delegationForPermission, assertAuthorityMatches, nextPermissionNonce, } from './delegation.js';
export { recoverAuthorizationSigner, verifyAuthorizationSigner, verifyAuthorizationForPermission, } from './verification.js';
// ---------------------------------------------------------------------------
// Logging + errors
// ---------------------------------------------------------------------------
const logger = createLogger('eip7702');
export const EIP7702ErrorCodes = {
    SIGNER_MISMATCH: 'ERR_EIP7702_SIGNER_MISMATCH',
    CHAIN_MISMATCH: 'ERR_EIP7702_CHAIN_MISMATCH',
    IMPL_MISMATCH: 'ERR_EIP7702_IMPL_MISMATCH',
    NOT_ACTIVE: 'ERR_EIP7702_NOT_ACTIVE',
    EXPIRED: 'ERR_EIP7702_EXPIRED',
    SPEND_LIMIT_EXCEEDED: 'ERR_EIP7702_SPEND_LIMIT_EXCEEDED',
    PERMISSION_NOT_FOUND: 'ERR_EIP7702_PERMISSION_NOT_FOUND',
    UNVERIFIED: 'ERR_EIP7702_UNVERIFIED',
};
export class EIP7702Error extends Error {
    code;
    retryable;
    constructor(code, message, opts = {}) {
        super(message);
        this.name = 'EIP7702Error';
        this.code = code;
        this.retryable = opts.retryable ?? false;
    }
}
export function isEIP7702Error(err) {
    return err instanceof EIP7702Error;
}
export class DelegationAuthorizationBuilder {
    signer;
    logger = createLogger('eip7702-builder');
    constructor(signer) {
        this.signer = signer;
    }
    /**
     * Build the one-time authorization tuple for a user EOA delegating to the
     * BAN permission account. `nonce` is the user EOA's current nonce (read at
     * signing time; the executor uses it to submit the activation transaction).
     */
    async build(input, nonce) {
        if (!input.address || !input.implAddress || !input.chainId) {
            throw new EIP7702Error(EIP7702ErrorCodes.UNVERIFIED, 'Authorization requires address, implAddress, and chainId', { retryable: false });
        }
        if (!this.signer) {
            throw new EIP7702Error(EIP7702ErrorCodes.UNVERIFIED, 'No authorization signer backend configured; refusing to fabricate a signature', { retryable: false });
        }
        const signed = await this.signer({ ...input, nonce });
        this.logger.info('delegation_authorization_built', {
            address: input.address,
            implAddress: input.implAddress,
            chainId: input.chainId,
        });
        return signed;
    }
}
export class DelegationAuthorizationVerifier {
    recover;
    logger = createLogger('eip7702-verifier');
    constructor(recover) {
        this.recover = recover;
    }
    async verify(input) {
        if (!this.recover) {
            throw new EIP7702Error(EIP7702ErrorCodes.UNVERIFIED, 'No signer-recovery backend configured; refusing to claim the tuple is valid', { retryable: false });
        }
        const auth = input.permission.delegation;
        if (!auth) {
            throw new EIP7702Error(EIP7702ErrorCodes.UNVERIFIED, `Permission ${input.permission.id} has no delegation authorization to verify`, { retryable: false });
        }
        if (Number(auth.chainId) !== input.chainId) {
            throw new EIP7702Error(EIP7702ErrorCodes.CHAIN_MISMATCH, `Authorization chainId ${auth.chainId} does not match expected chain ${input.chainId}`, { retryable: false });
        }
        if (!auth.address || !String(auth.address).toLowerCase().startsWith('0x')) {
            throw new EIP7702Error(EIP7702ErrorCodes.IMPL_MISMATCH, `Authorization impl address ${auth.address} is invalid`, { retryable: false });
        }
        if (String(auth.address).toLowerCase() !== String(input.implAddress).toLowerCase()) {
            throw new EIP7702Error(EIP7702ErrorCodes.IMPL_MISMATCH, `Authorization impl ${auth.address} does not match configured ${input.implAddress}`, { retryable: false });
        }
        const signer = await this.recover(auth);
        const signerMatchesUser = signer && String(signer).toLowerCase() === String(input.expectedUser).toLowerCase();
        if (!signerMatchesUser) {
            this.logger.warn('delegation_authorization_signer_mismatch', {
                signer,
                expectedUser: input.expectedUser,
            });
            throw new EIP7702Error(EIP7702ErrorCodes.SIGNER_MISMATCH, `Authorization signer ${signer} does not match expected user ${input.expectedUser}`, { retryable: false });
        }
        this.logger.info('delegation_authorization_verified', {
            signer,
            implAddress: input.implAddress,
            chainId: input.chainId,
            permissionId: input.permission.id,
        });
        return { signer, signerMatchesUser };
    }
}
/**
 * Resolves a policy-checked proposal to an ACTIVE permission and verifies the
 * proposal is within scope (protocol/contract/function/token/spend). Fails
 * closed — any missing/expired/revoked permission or out-of-scope field throws
 * an EIP7702Error.
 */
export class PermissionResolver {
    opts;
    logger = createLogger('eip7702-resolver');
    constructor(opts = {}) {
        this.opts = opts;
    }
    resolve(permission, scope) {
        if (!permission) {
            throw new EIP7702Error(EIP7702ErrorCodes.PERMISSION_NOT_FOUND, 'No permission bound to this proposal; refusing to allow', { retryable: false });
        }
        if (permission.status !== 'ACTIVE') {
            throw new EIP7702Error(EIP7702ErrorCodes.NOT_ACTIVE, `Permission ${permission.id} is ${permission.status}, not ACTIVE`, { retryable: false });
        }
        if (permission.validUntil && new Date(permission.validUntil).getTime() <= Date.now()) {
            throw new EIP7702Error(EIP7702ErrorCodes.EXPIRED, `Permission ${permission.id} expired at ${permission.validUntil}`, { retryable: false });
        }
        if (permission.validAfter && new Date(permission.validAfter).getTime() > Date.now()) {
            throw new EIP7702Error(EIP7702ErrorCodes.NOT_ACTIVE, `Permission ${permission.id} is not active until ${permission.validAfter}`, { retryable: false });
        }
        // Protocol / contract / function scope.
        if (permission.allowedProtocols.length > 0 &&
            !permission.allowedProtocols.includes(scope.protocol)) {
            throw new EIP7702Error(EIP7702ErrorCodes.PERMISSION_NOT_FOUND, `Protocol ${scope.protocol} is not allowed by permission ${permission.id}`, { retryable: false });
        }
        if (permission.allowedContracts.length > 0 &&
            !permission.allowedContracts.some((c) => String(c).toLowerCase() === scope.contract.toLowerCase())) {
            throw new EIP7702Error(EIP7702ErrorCodes.PERMISSION_NOT_FOUND, `Contract ${scope.contract} is not allowed by permission ${permission.id}`, { retryable: false });
        }
        if (permission.allowedFunctions.length > 0 &&
            !permission.allowedFunctions.includes(scope.functionName)) {
            throw new EIP7702Error(EIP7702ErrorCodes.PERMISSION_NOT_FOUND, `Function ${scope.functionName} is not allowed by permission ${permission.id}`, { retryable: false });
        }
        // Token scope.
        if (permission.allowedTokens.length > 0 &&
            !permission.allowedTokens.some((t) => String(t).toLowerCase() === scope.token.toLowerCase())) {
            throw new EIP7702Error(EIP7702ErrorCodes.PERMISSION_NOT_FOUND, `Token ${scope.token} is not allowed by permission ${permission.id}`, { retryable: false });
        }
        // Spend bounds: per-transaction cap + cumulative spend limit (spendLimit canonical).
        const amount = BigInt(scope.amount || '0');
        const perTxCap = BigInt(permission.spend.perTransactionCap || '0');
        if (amount > perTxCap) {
            throw new EIP7702Error(EIP7702ErrorCodes.SPEND_LIMIT_EXCEEDED, `Amount ${scope.amount} exceeds per-transaction cap ${permission.spend.perTransactionCap} of permission ${permission.id}`, { retryable: false });
        }
        const used = BigInt(permission.spend.used || '0');
        const spendLimit = BigInt(permission.spend.spendLimit || permission.spend.spendCap || '0');
        if (used + amount > spendLimit) {
            throw new EIP7702Error(EIP7702ErrorCodes.SPEND_LIMIT_EXCEEDED, `Proposed spend ${scope.amount} exceeds remaining limit ${spendLimit - used} of permission ${permission.id}`, { retryable: false });
        }
        // Registry fail-closed (when provided).
        if (this.opts.contracts && !this.opts.contracts.canExecute(scope.contract, scope.functionName)) {
            throw new EIP7702Error(EIP7702ErrorCodes.PERMISSION_NOT_FOUND, `Contract ${scope.contract} function ${scope.functionName} is not EXECUTE-capable in the registry`, { retryable: false });
        }
        if (this.opts.tokens && !this.opts.tokens.isEnabled(scope.token)) {
            throw new EIP7702Error(EIP7702ErrorCodes.PERMISSION_NOT_FOUND, `Token ${scope.token} is not verified+enabled in the registry`, { retryable: false });
        }
        this.logger.info('permission_resolved', {
            permissionId: permission.id,
            protocol: scope.protocol,
            contract: scope.contract,
            functionName: scope.functionName,
        });
        return permission;
    }
}
