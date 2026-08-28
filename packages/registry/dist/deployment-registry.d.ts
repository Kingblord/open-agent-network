/**
 * DeploymentRegistry — protocol-address deployment maps (mustflow §13).
 *
 * Stores the canonical, verified contract address per protocol role
 * (router / factory / quoter / pool / etc.) for a given chain. Addresses must
 * be verified before being registered (see AddressVerifier); the registry
 * itself refuses to register structurally-invalid or wrong-chain addresses.
 */
export interface DeploymentRecord {
    protocolId: string;
    chainId: number;
    /** role -> verified address (EIP-55/checksummed preferred). */
    contracts: Record<string, string>;
    /** Block from which the deployment is known-good. */
    deployedAtBlock?: number;
    verified: boolean;
}
export declare class DeploymentRegistry {
    private readonly opts;
    private readonly byId;
    constructor(opts?: {
        chainId?: number;
        deployments?: DeploymentRecord[];
    });
    get chainId(): number;
    register(deployment: DeploymentRecord): void;
    get(protocolId: string): DeploymentRecord | null;
    /** Whether a role has a verified address for the BAN chain. */
    hasAddress(protocolId: string, role: string): boolean;
    /** Fail-closed address lookup for a protocol role. */
    requireAddress(protocolId: string, role: string): string;
}
//# sourceMappingURL=deployment-registry.d.ts.map