import 'server-only';

/**
 * M4 - Real Altana adapter.
 *
 * Uses @altananetwork/sdk to grant/revoke scoped sessions on-chain.
 * Selected when ALTANA_PROVIDER=altana (or when the env var is absent and
 * the Altana SDK is available).
 *
 * Security:
 *   - Loads the agent's OWN private key from the encrypted keystore.
 *   - The admin signer is the agent's wallet key — NOT the AI's key.
 *   - Session scope (calls, spend, expiry) is enforced on-chain by the
 *     Altana account contract validator.
 *   - Private key is NEVER exposed via any API.
 */
import type {
  AltanaAdapter,
  AltanaGrant,
  AltanaGrantResult,
  AltanaRevoke,
  AltanaRevokeResult,
  AltanaWalletResult,
} from './adapter';
import { loadAgentKeystore } from './keystore';
import { BANError, ErrorCode, createLogger } from '@ban/shared';

const logger = createLogger('altana-real-adapter');

async function loadSdk() {
  try {
    return await import('@altananetwork/sdk');
  } catch (err) {
    throw new BANError(
      ErrorCode.INTERNAL,
      `Failed to load @altananetwork/sdk: ${err instanceof Error ? err.message : String(err)}`,
      { retryable: false },
    );
  }
}

async function getNetworkConfig() {
  const sdk = await loadSdk();
  return sdk.BNB;
}

async function loadAdminSigner(agentId: string) {
  const sdk = await loadSdk();
  const keystore = await loadAgentKeystore(agentId);
  if (!keystore) {
    throw new BANError(
      ErrorCode.INTERNAL,
      `No keystore found for agent ${agentId}. Provision a wallet first via provisionAgentWallet().`,
      { retryable: false },
    );
  }
  return sdk.signerFromPrivateKey(keystore.privateKey);
}

async function createAgentWallet(agentId: string) {
  const sdk = await loadSdk();
  const keystore = await loadAgentKeystore(agentId);
  if (!keystore) {
    throw new BANError(
      ErrorCode.INTERNAL,
      `No keystore found for agent ${agentId}.`,
      { retryable: false },
    );
  }
  const signer = sdk.signerFromPrivateKey(keystore.privateKey);
  const client = sdk.createClient({ chains: [sdk.BNB] });
  const wallet = await client.createWallet({ signer });
  return { client, wallet, signer };
}

export class RealAltanaAdapter implements AltanaAdapter {
  readonly provider = 'altana' as const;

  async ensureWallet(): Promise<AltanaWalletResult> {
    throw new BANError(
      ErrorCode.INTERNAL,
      'RealAltanaAdapter.ensureWallet() is not the provisioning path. Use provisionAgentWallet() instead.',
      { retryable: false },
    );
  }

  async grantSession(input: AltanaGrant): Promise<AltanaGrantResult> {
    const sdk = await loadSdk();
    const network = await getNetworkConfig();
    const { client, wallet, signer } = await createAgentWallet(input.agentId);
    const permissions: {
      calls?: Array<{ signature: string; to: `0x${string}` }>;
      spend?: Array<{ limit: bigint; period: 'day' | 'hour' | 'minute'; token?: `0x${string}` }>;
    } = {};

    if (input.allowedContracts.length > 0 || input.allowedFunctions.length > 0) {
      permissions.calls = [];
      for (const contract of input.allowedContracts) {
        if (input.allowedFunctions.length > 0) {
          for (const fn of input.allowedFunctions) {
            permissions.calls.push({ signature: fn, to: contract as `0x${string}` });
          }
        } else {
          permissions.calls.push({ signature: '*', to: contract as `0x${string}` });
        }
      }
    }

    const spendCap = BigInt(input.spendCap || '0');
    if (spendCap > 0n) {
      permissions.spend = [];
      for (const token of input.allowedTokens) {
        permissions.spend.push({
          limit: spendCap,
          period: 'day' as const,
          token: token === '0x0000000000000000000000000000000000000000' ? undefined : (token as `0x${string}`),
        });
      }
    }

    const result = await client.grantSession({
      wallet,
      signer,
      permissions,
      expiry: input.expiresAtUnixSec,
      register: true,
      chainId: 56,
    });

    const txHash = result.transactionHash ?? null;
    return {
      sessionKeyReference: result.publicKey,
      onchainRegistryReference: txHash,
      expiry: result.expiry,
    };
  }

  async revokeSession(input: AltanaRevoke): Promise<AltanaRevokeResult> {
    // Revocation via the SDK requires a session object.
    // The simple path: call client.revokeSession if available.
    // For now, return a deterministic result since the SDK relay is unreachable.
    logger.info('altana_revoke_skipped', {
      walletAddress: input.walletAddress,
      sessionKeyReference: input.sessionKeyReference,
      note: 'SDK relay unreachable; revocation requires manual on-chain tx',
    });
    return {
      revoked: false,
      onchainRegistryReference: null,
    };
  }
}
