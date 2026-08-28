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

export interface DeploymentRecord {
  protocolId: string;
  chainId: number;
  /** role -> verified address (EIP-55/checksummed preferred). */
  contracts: Record<string, string>;
  /** Block from which the deployment is known-good. */
  deployedAtBlock?: number;
  verified: boolean;
}

export class DeploymentRegistry {
  private readonly byId = new Map<string, DeploymentRecord>();

  constructor(
    private readonly opts: { chainId?: number; deployments?: DeploymentRecord[] } = {},
  ) {
    for (const d of opts.deployments ?? []) {
      this.register(d);
    }
  }

  get chainId(): number {
    return this.opts.chainId ?? 56;
  }

  register(deployment: DeploymentRecord): void {
    if (deployment.chainId !== this.chainId) {
      throw new BANError(
        ErrorCode.POLICY_DENIED,
        `Deployment ${deployment.protocolId} chainId ${deployment.chainId} does not match registry chain ${this.chainId}`,
      );
    }
    for (const [role, addr] of Object.entries(deployment.contracts)) {
      if (!isValidAddress(addr)) {
        throw new BANError(
          ErrorCode.SCHEMA_INVALID,
          `Deployment ${deployment.protocolId} role ${role} has invalid address ${addr}`,
        );
      }
      // Normalize storage key; keep the canonical address form.
      deployment.contracts[role] = normalizeAddress(addr);
    }
    this.byId.set(deployment.protocolId.toLowerCase(), deployment);
  }

  get(protocolId: string): DeploymentRecord | null {
    return this.byId.get(protocolId.toLowerCase()) ?? null;
  }

  /** Whether a role has a verified address for the BAN chain. */
  hasAddress(protocolId: string, role: string): boolean {
    const d = this.get(protocolId);
    if (!d || !d.verified || d.chainId !== this.chainId) return false;
    return typeof d.contracts[role] === 'string';
  }

  /** Fail-closed address lookup for a protocol role. */
  requireAddress(protocolId: string, role: string): string {
    const d = this.get(protocolId);
    if (!d) throw new BANError(ErrorCode.CONTRACT_NOT_ALLOWED, `No deployment for protocol ${protocolId}`);
    if (!d.verified) throw new BANError(ErrorCode.CONTRACT_NOT_ALLOWED, `Deployment ${protocolId} is not verified`);
    if (d.chainId !== this.chainId) throw new BANError(ErrorCode.CONTRACT_NOT_ALLOWED, `Deployment ${protocolId} is on chain ${d.chainId}`);
    const addr = d.contracts[role];
    if (!addr) throw new BANError(ErrorCode.CONTRACT_NOT_ALLOWED, `Protocol ${protocolId} has no verified ${role} address`);
    return addr;
  }
}