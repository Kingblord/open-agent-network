import 'server-only';

import { createWalletClient, createPublicClient, http, type Hex, type Address, type WalletClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { BANError, ErrorCode, createLogger } from '@ban/shared';

const logger = createLogger('eip7702-contract-client');

/**
 * BANPermissionAccount ABI — minimal ABI for activate() and revoke() calls.
 * Full ABI is at contracts/BANPermissionAccount.sol.
 */
const BAN_PERMISSION_ACCOUNT_ABI = [
  {
    name: 'activate',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'authority', type: 'bytes32' },
      { name: 'user', type: 'address' },
      { name: 'agentExecutor', type: 'address' },
      { name: 'spendLimit', type: 'uint192' },
      { name: 'perTxCap', type: 'uint64' },
      { name: 'validAfter', type: 'uint48' },
      { name: 'validUntil', type: 'uint48' },
      { name: 'calls', type: 'tuple(address target, bytes4 selector)[]' },
      { name: 'tokens', type: 'tuple(address token)[]' },
    ],
    outputs: [],
  },
  {
    name: 'revoke',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'authority', type: 'bytes32' }],
    outputs: [],
  },
  {
    name: 'permissions',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'authority', type: 'bytes32' }],
    outputs: [
      { name: 'authority', type: 'bytes32' },
      { name: 'user', type: 'address' },
      { name: 'agentExecutor', type: 'address' },
      { name: 'spendLimit', type: 'uint192' },
      { name: 'perTxCap', type: 'uint64' },
      { name: 'validAfter', type: 'uint48' },
      { name: 'validUntil', type: 'uint48' },
      { name: 'revokedAt', type: 'uint48' },
      { name: 'spent', type: 'uint192' },
      { name: 'active', type: 'bool' },
    ],
  },
] as const;

/** Get the EIP-7702 implementation address from env. */
export function getImplAddress(): Address | null {
  const addr = process.env.NEXT_PUBLIC_BAN_EIP7702_IMPL_ADDRESS?.trim();
  if (!addr || !/^0x[a-fA-F0-9]{40}$/.test(addr)) return null;
  return addr as Address;
}

/** Get BSC mainnet chain config. */
function bscChain() {
  return {
    id: 56,
    name: 'BNB Smart Chain',
    nativeCurrency: { name: 'BNB', symbol: 'BNB', decimals: 18 },
    rpcUrls: {
      default: { http: [process.env.BAN_RPC_URL ?? 'https://bsc-dataseed.binance.org/'] },
      public: { http: [process.env.BAN_RPC_URL ?? 'https://bsc-dataseed.binance.org/'] },
    },
  } as const;
}

const BAN_CHAIN = bscChain();

/**
 * Create a viem wallet client from the agent executor private key.
 * Falls back to DEV_PRIVATE_KEY when BAN_AGENT_PRIVATE_KEY is not set
 * (dev/test only). Returns null if no key is configured.
 */
function getExecutorWalletClient(): { address: Address; walletClient: WalletClient } | null {
  const key =
    process.env.BAN_AGENT_PRIVATE_KEY?.trim() ??
    process.env.DEV_PRIVATE_KEY?.trim();

  if (!key) {
    logger.warn('no_executor_key', {
      note: 'BAN_AGENT_PRIVATE_KEY or DEV_PRIVATE_KEY must be set for on-chain EIP-7702 calls',
    });
    return null;
  }

  // Guard: never use DEV_PRIVATE_KEY in production for on-chain calls.
  const isDevKey = !process.env.BAN_AGENT_PRIVATE_KEY?.trim();
  if (isDevKey && process.env.NODE_ENV === 'production') {
    logger.warn('dev_key_in_production', {
      note: 'DEV_PRIVATE_KEY cannot be used for on-chain calls in production; set BAN_AGENT_PRIVATE_KEY',
    });
    return null;
  }

  try {
    const normalized = key.startsWith('0x') ? (key as Hex) : (`0x${key}` as Hex);
    const account = privateKeyToAccount(normalized);
    const walletClient = createWalletClient({
      chain: BAN_CHAIN,
      transport: http(BAN_CHAIN.rpcUrls.default.http[0]),
      account,
    });
    return { address: account.address, walletClient };
  } catch (err) {
    logger.error('executor_key_invalid', {
      message: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Call contract.activate() — creates an on-chain permission record.
 *
 * This is a REGULAR transaction (not EIP-7702 type-4). It stores the
 * permission scope on-chain so the contract state matches Firestore.
 * When BSC activates EIP-7702 delegation, the on-chain record is ready.
 *
 * Falls back gracefully: if no executor key or RPC is configured, or the
 * call fails, the Firestore record is still created (degraded mode).
 */
export async function contractActivate(params: {
  authority: Hex;
  user: Address;
  agentExecutor: Address;
  spendLimit: bigint;
  perTxCap: bigint;
  validAfter: number;
  validUntil: number;
  calls: { target: Address; selector: Hex }[];
  tokens: { token: Address }[];
}): Promise<{ txHash: string } | null> {
  const impl = getImplAddress();
  if (!impl) {
    logger.warn('contract_activate_skipped', { reason: 'NEXT_PUBLIC_BAN_EIP7702_IMPL_ADDRESS not set' });
    return null;
  }

  const executor = getExecutorWalletClient();
  if (!executor) {
    logger.warn('contract_activate_skipped', { reason: 'no executor key configured' });
    return null;
  }

  try {
    const txHash = await executor.walletClient.writeContract({
      address: impl,
      chain: BAN_CHAIN,
      abi: BAN_PERMISSION_ACCOUNT_ABI,
      functionName: 'activate',
      args: [
        params.authority,
        params.user,
        params.agentExecutor,
        params.spendLimit,
        params.perTxCap,
        params.validAfter,
        params.validUntil,
        params.calls,
        params.tokens,
      ],
    } as any);
    logger.info('contract_activate_submitted', {
      authority: params.authority,
      user: params.user,
      txHash,
    });
    return { txHash };
  } catch (err) {
    // Non-critical: Firestore record is the source of truth. On-chain is
    // best-effort. Log and return null.
    logger.warn('contract_activate_failed', {
      authority: params.authority,
      message: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Call contract.revoke() — marks a permission as revoked on-chain.
 *
 * Same degraded-mode fallback as contractActivate(): Firestore is the
 * source of truth; on-chain is best-effort.
 */
export async function contractRevoke(
  authority: Hex,
): Promise<{ txHash: string } | null> {
  const impl = getImplAddress();
  if (!impl) {
    logger.warn('contract_revoke_skipped', { reason: 'NEXT_PUBLIC_BAN_EIP7702_IMPL_ADDRESS not set' });
    return null;
  }

  const executor = getExecutorWalletClient();
  if (!executor) {
    logger.warn('contract_revoke_skipped', { reason: 'no executor key configured' });
    return null;
  }

  try {
    const txHash = await executor.walletClient.writeContract({
      address: impl,
      chain: BAN_CHAIN,
      account: executor.address,
      abi: BAN_PERMISSION_ACCOUNT_ABI,
      functionName: 'revoke',
      args: [authority],
    });
    logger.info('contract_revoke_submitted', { authority, txHash });
    return { txHash };
  } catch (err) {
    logger.warn('contract_revoke_failed', {
      authority,
      message: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Read contract state — check if a permission exists on-chain.
 */
export async function contractGetPermission(
  authority: Hex,
): Promise<{
  user: Address;
  active: boolean;
  spent: bigint;
} | null> {
  const impl = getImplAddress();
  if (!impl) return null;

  try {
    const publicClient = createPublicClient({
      chain: BAN_CHAIN,
      transport: http(BAN_CHAIN.rpcUrls.default.http[0]),
    });

    const result = await publicClient.readContract({
      address: impl,
      abi: BAN_PERMISSION_ACCOUNT_ABI,
      functionName: 'permissions',
      args: [authority],
    });

    return {
      user: result[1],
      active: result[9],
      spent: result[8],
    };
  } catch (err) {
    logger.warn('contract_get_permission_failed', {
      authority,
      message: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}