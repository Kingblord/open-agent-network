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
      `Failed to load @altananetwork/sdk — install it to enable real Altana sessions: ${err instanceof Error ? err.message : String(err)}`,
      { retryable: false },
    );
  }
}

/**
 * Resolve the Altana network config for BNB mainnet (chainId 56).
 * The SDK exports `BNB` as the network config constant.
 */
async function getNetworkConfig() {
  const sdk = await loadSdk();
  return sdk.BNB;
}

/**
 * Load the agent's admin signer from its encrypted keystore.
 * The admin signer is the agent's OWN key — used to authorize sessions.
 */
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

/**
 * Create an Altana client + wallet for the agent.
 */
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
    // Wallet provisioning is handled by provisionAgentWallet() in altana-signer.ts.
    // This adapter assumes the wallet already exists in the keystore.
    // If called without a keystore, it will throw — which is correct behavior.
    throw new BANError(
      ErrorCode.INTERNAL,
      'RealAltanaAdapter.ensureWallet() is not the provisioning path. Use provisionAgentWallet() instead.',
      { retryable: false },
    );
  }

  async grantSession(input: AltanaGrant): Promise<AltanaGrantResult> {
    const sdk = await loadSdk();
    const network = await getNetworkConfig();
    const { wallet, signer } = await createAgentWallet(input.agentId);

    // Build the session permissions from the grant input.
    const permissions: {
      calls?: Array<{ signature: string; to: `0x${string}` }>;
      spend?: Array<{ limit: bigint; period: 'day' | 'hour' | 'minute'; token?: `0x${string}` }>;
    } = {};

    // Map allowed contracts + functions to call permissions.
    if (input.allowedContracts.length > 0 || input.allowedFunctions.length > 0) {
      permissions.calls = [];
      for (const contract of input.allowedContracts) {
        if (input.allowedFunctions.length > 0) {
          for (const fn of input.allowedFunctions) {
            permissions.calls.push({
              signature: fn,
              to: contract as `0x${string}`,
            });
          }
        } else {
          // Allow all functions on this contract
          permissions.calls.push({
            signature: '*',
            to: contract as `0x${string}`,
          });
        }
      }
    }

    // Map spend cap to spend permissions.
    const spendCap = BigInt(input.spendCap || '0');
    if (spendCap > 0n) {
      permissions.spend = [];
      for (const token of input.allowedTokens) {
        permissions.spend.push({
          limit: spendCap,
          period: 'day',
          token: token === '0x0000000000000000000000000000000000000000' ? undefined : (token as `0x${string}`),
        });
      }
    }

    logger.info('altana_granting_session', {
      agentId: input.agentId,
      walletAddress: input.walletAddress,
      contractsCount: input.allowedContracts.length,
      functionsCount: input.allowedFunctions.length,
      tokensCount: input.allowedTokens.length,
      spendCap: input.spendCap,
      expiresAt: input.expiresAtUnixSec,
    });

    // Grant the session via the Altana SDK.
    const result = await sdk.grantSession(wallet, signer, {
      permissions,
      expiry: input.expiresAtUnixSec,
      register: true, // Register in KeyStore so third parties can verify
    }, { network });

    const txHash = result.transactionHash ?? null;

    logger.info('altana_session_granted', {
      agentId: input.agentId,
      walletAddress: input.walletAddress,
      publicKey: result.publicKey,
      transactionHash: txHash,
      expiry: result.expiry,
    });

    return {
      sessionKeyReference: result.publicKey,
      onchainRegistryReference: txHash,
      expiry: result.expiry,
    };
  }

  async revokeSession(input: AltanaRevoke): Promise<AltanaRevokeResult> {
    const sdk = await loadSdk();
    const network = await getNetworkConfig();
    const { wallet, signer } = await createAgentWallet(input.walletAddress);

    // For revocation, we need to find the session by its public key.
    // The Altana SDK's revokeSession takes a session object.
    // Since we only have the sessionKeyReference (public key), we construct
    // a minimal session object for revocation.
    logger.info('altana_revoking_session', {
      walletAddress: input.walletAddress,
      sessionKeyReference: input.sessionKeyReference,
    });

    // The SDK's revokeSession requires the full Session object.
    // For now, we use the client's execute to revoke via the account contract.
    // This is a simplified path — in production, you'd store the full Session object.
    try {
      const result = await wallet.revokeSession?.(signer, {
        publicKey: input.sessionKeyReference as `0x${string}`,
      });

      const txHash = (result as { transactionHash?: string })?.transactionHash ?? null;

      logger.info('altana_session_revoked', {
        walletAddress: input.walletAddress,
        sessionKeyReference: input.sessionKeyReference,
        transactionHash: txHash,
      });

      return {
        revoked: true,
        onchainRegistryReference: txHash,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('altana_revoke_failed', {
        walletAddress: input.walletAddress,
        sessionKeyReference: input.sessionKeyReference,
        error: message,
      });
      throw new BANError(
        ErrorCode.EXECUTION_FAILED,
        `Failed to revoke session ${input.sessionKeyReference}: ${message}`,
        { retryable: true },
      );
    }
  }
}
