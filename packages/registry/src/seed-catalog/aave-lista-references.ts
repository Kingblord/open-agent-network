/**
 * Aave V3 (BNB Chain) + Lista DAO — role references (mustflow §10–§14).
 *
 * REVIEW-ONLY REFERENCES — NOT SEEDS.
 *
 * These are the OFFICIAL role names / identifiers published by each protocol
 * for BNB Chain (chain 56), exactly as used by the live adapters
 * (live-provider.ts: `requireDeploy('aave', 'v3Pool', ...)` and
 * `requireDeploy('lista', 'core', ...)`).
 *
 * They exist so that:
 *   1. The @ban/registry DeploymentRegistry roles stay in sync with the
 *      protocol's published deployment JSON (no invented role names).
 *   2. The verification pipeline (verify-seeds.ts) has the exact role→source
 *      mapping to check once the protocol's deployment JSON is imported.
 *
 * These references contain **NO addresses** — every entry is
 * `status: 'pending-on-chain-verification'`. An entry without an address
 * cannot be `verified: true` and therefore can never become `enabled`.
 * Autonomous execution for these protocols stays DENIED (fail-closed)
 * until a real address is added to the seed catalog via the verification
 * pipeline and separately enabled in ContractRegistry (verified ≠ enabled,
 * mustflow §12).
 *
 * Sources: aave/v3-deployments `output/bnb/` (role naming), Lista DAO
 * documentation + deployment JSON (lista-dao). See VERIFY-SOURCES.md.
 */

export interface ProtocolRoleReference {
  protocolId: string;
  chainId: number;
  /** Official role name published by the protocol for BNB Chain. */
  role: string;
  /** How the live adapter consumes this role (DeploymentRegistry key). */
  usedByAdapterAs: string;
  /** Published by the protocol for this chain? (reference, not on-chain proof) */
  published: boolean;
  /**
   * Never an address — this reference intentionally cannot be executed.
   * The verified address (when the pipeline confirms it) belongs only in the
   * seed catalog / DeploymentRegistry.
   */
  status: 'pending-on-chain-verification';
  /** Provenance tokens (see VERIFY-SOURCES.md). */
  sources: string[];
}

export const AAVE_V3_BNB_ROLES: ProtocolRoleReference[] = [
  {
    protocolId: 'aave',
    chainId: 56,
    role: 'Pool',
    usedByAdapterAs: 'v3Pool',
    published: true,
    status: 'pending-on-chain-verification',
    sources: ['aave-v3-deployments-output/bnb'],
  },
  {
    protocolId: 'aave',
    chainId: 56,
    role: 'PoolAddressesProvider',
    usedByAdapterAs: 'addressesProvider',
    published: true,
    status: 'pending-on-chain-verification',
    sources: ['aave-v3-deployments-output/bnb'],
  },
  {
    protocolId: 'aave',
    chainId: 56,
    role: 'AaveOracle',
    usedByAdapterAs: 'oracle',
    published: true,
    status: 'pending-on-chain-verification',
    sources: ['aave-v3-deployments-output/bnb'],
  },
];

export const LISTA_DAO_BNB_ROLES: ProtocolRoleReference[] = [
  {
    protocolId: 'lista',
    chainId: 56,
    role: 'ListaCore',
    usedByAdapterAs: 'core',
    published: true,
    status: 'pending-on-chain-verification',
    sources: ['lista-dao-docs', 'lista-dao-deployments-json'],
  },
  {
    protocolId: 'lista',
    chainId: 56,
    role: 'BnbStaking',
    usedByAdapterAs: 'bnbStaking',
    published: true,
    status: 'pending-on-chain-verification',
    sources: ['lista-dao-docs', 'lista-dao-deployments-json'],
  },
  {
    protocolId: 'lista',
    chainId: 56,
    role: 'slisBNB',
    usedByAdapterAs: 'slisBnb',
    published: true,
    status: 'pending-on-chain-verification',
    sources: ['lista-dao-docs', 'lista-dao-deployments-json'],
  },
  {
    protocolId: 'lista',
    chainId: 56,
    role: 'wBETH',
    usedByAdapterAs: 'wbeth',
    published: true,
    status: 'pending-on-chain-verification',
    sources: ['lista-dao-docs', 'lista-dao-deployments-json'],
  },
  {
    protocolId: 'lista',
    chainId: 56,
    role: 'bLISB',
    usedByAdapterAs: 'blisb',
    published: true,
    status: 'pending-on-chain-verification',
    sources: ['lista-dao-docs', 'lista-dao-deployments-json'],
  },
];

/** All documented BNB role references (review-only; no addresses included). */
export const BNB_PROTOCOL_ROLE_REFERENCES: ProtocolRoleReference[] = [
  ...AAVE_V3_BNB_ROLES,
  ...LISTA_DAO_BNB_ROLES,
];