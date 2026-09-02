import { type WalletClient, type Chain, type Address } from 'viem';
import type { Eip7702Authorization, Eip7702AuthorizationTuple } from '@ban/schemas';
export interface Eip7702ExecutorEnv {
    DEV_PRIVATE_KEY?: string;
    BAN_RPC_URL?: string;
    BAN_CHAIN_ID?: string;
    BAN_AGENT_PRIVATE_KEY?: string;
}
export type Eip7702EnvLike = Eip7702ExecutorEnv | NodeJS.ProcessEnv;
/** The canonical BNB mainnet chain (chainId 56). */
export declare function eip7702Chain(env?: Eip7702EnvLike): Chain;
/** Build the viem `AuthorizationList` for a single auth (raw tuple form). */
export declare function toAuthorizationList(auth: Eip7702Authorization): Eip7702AuthorizationTuple[];
/**
 * Read the DEV_PRIVATE_KEY as a wallet account — DEV/TEST ONLY.
 * Throws outside non-production so it can never be used by production
 * execution. Because this project has no BAN_ENV flag by design, we guard at
 * the single call site using NODE_ENV, and document that this must only ever
 * be invoked by dev/test/deploy/revocation tooling.
 */
export declare function devTestingAccount(): {
    address: Address;
    walletClient: WalletClient;
} | null;
/** Read the agent-wallet private key as a wallet account (primary executor). */
export declare function agentWalletAccount(env?: Eip7702EnvLike): {
    address: Address;
    walletClient: WalletClient;
} | null;
/**
 * Submit an EIP-7702 activation transaction from a signing account using an
 * injected viem submit backend. The broadcast step (RPC) is intentionally a
 * separate concern so hermetic tests can prove the transaction is built
 * without touching a network, and this never fabricates a tx hash.
 */
export declare function submitAuthorization(input: {
    auth: Eip7702Authorization;
    /** 0x… hex calldata for the delegated permission-account (e.g. setAuthority) */
    data?: string;
    /** injected submit — e.g. sendRawTransaction / broadcastAuthorization */
    submit?: (request: {
        authList: Eip7702AuthorizationTuple[];
        data?: string;
        from?: Address;
    }) => Promise<{
        hash: string;
    }>;
}): Promise<{
    hash: string;
}>;
//# sourceMappingURL=executor.d.ts.map