/**
 * DeploymentRegistry — protocol-address deployment maps (mustflow §13).
 *
 * Stores the canonical, verified contract address per protocol role
 * (router / factory / quoter / pool / etc.) for a given chain. Addresses must
 * be verified before being registered (see AddressVerifier); the registry
 * itself refuses to register structurally-invalid or wrong-chain addresses.
 */
import { BANError, ErrorCode } from '@ban/shared';
import { isValidAddress, normalizeAddress } from './address-verifier.js';
export class DeploymentRegistry {
    opts;
    byId = new Map();
    constructor(opts = {}) {
        this.opts = opts;
        for (const d of opts.deployments ?? []) {
            this.register(d);
        }
    }
    get chainId() {
        return this.opts.chainId ?? 56;
    }
    register(deployment) {
        if (deployment.chainId !== this.chainId) {
            throw new BANError(ErrorCode.POLICY_DENIED, `Deployment ${deployment.protocolId} chainId ${deployment.chainId} does not match registry chain ${this.chainId}`);
        }
        for (const [role, addr] of Object.entries(deployment.contracts)) {
            if (!isValidAddress(addr)) {
                throw new BANError(ErrorCode.SCHEMA_INVALID, `Deployment ${deployment.protocolId} role ${role} has invalid address ${addr}`);
            }
            // Normalize storage key; keep the canonical address form.
            deployment.contracts[role] = normalizeAddress(addr);
        }
        this.byId.set(deployment.protocolId.toLowerCase(), deployment);
    }
    get(protocolId) {
        return this.byId.get(protocolId.toLowerCase()) ?? null;
    }
    /** Whether a role has a verified address for the BAN chain. */
    hasAddress(protocolId, role) {
        const d = this.get(protocolId);
        if (!d || !d.verified || d.chainId !== this.chainId)
            return false;
        return typeof d.contracts[role] === 'string';
    }
    /** Fail-closed address lookup for a protocol role. */
    requireAddress(protocolId, role) {
        const d = this.get(protocolId);
        if (!d)
            throw new BANError(ErrorCode.CONTRACT_NOT_ALLOWED, `No deployment for protocol ${protocolId}`);
        if (!d.verified)
            throw new BANError(ErrorCode.CONTRACT_NOT_ALLOWED, `Deployment ${protocolId} is not verified`);
        if (d.chainId !== this.chainId)
            throw new BANError(ErrorCode.CONTRACT_NOT_ALLOWED, `Deployment ${protocolId} is on chain ${d.chainId}`);
        const addr = d.contracts[role];
        if (!addr)
            throw new BANError(ErrorCode.CONTRACT_NOT_ALLOWED, `Protocol ${protocolId} has no verified ${role} address`);
        return addr;
    }
}
