import 'server-only';

/**
 * App-side registry glue (mustflow §10–13).
 *
 * One shared instance of the BAN Token / Protocol / Deployment registries for
 * the execution chain (BNB mainnet 56). Used by the control plane to resolve
 * user-selected tokens/protocols into registry entries and to fail closed on
 * anything unregistered / unverified.
 *
 * Execution authority is deliberately NOT seeded: no ContractRegistry entries
 * exist yet, so autonomous execution of any contract is DENIED by default
 * until deployments are verified on-chain (verified ≠ enabled).
 */

import { createBnbRegistries } from '@ban/registry';

const registries = createBnbRegistries();

export const banTokens = registries.tokens;
export const banProtocols = registries.protocols;
export const banDeployments = registries.deployments;