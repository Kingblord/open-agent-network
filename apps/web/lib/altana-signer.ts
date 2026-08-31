import 'server-only';
import type { ActionProposal } from '@ban/schemas';
import { BANError, ErrorCode, createLogger } from '@ban/shared';
import type { SignedTransaction, SigningBackend, SignRequest } from '@ban/signers';
import {
  getAltanaStoreDir,
  hasAgentKeystore,
  loadAgentKeystore,
  saveAgentKeystore,
} from './altana/keystore';

/**
 * AltanaAgentSigningBackend — real per-agent Altana Agent Wallet signer.
 *
 * Each deployed BAN agent owns a DEDICATED wallet whose private-key signer is
 * stored in its own keystore (<ALTANA_SDK_STORE_DIR>/<agentId>/key.json).
 * This implements the mustflow §27–28 signer boundary + the "one agent, one
 * wallet, one key" model.
 *
 * Keyless Altana (no relayer / no Altana API key):
 *   - SDK talks to BNB directly; the signer (private key) is what matters.
 *   - The first execute() activates the wallet and registers its admin key in
 *     Altana's KeyStore — so the wallet must be funded with BNB first.
 *
 * Security invariants:
 *   - This is the AGENT's key (per-agent keystore; env BAN_BNB_PRIVATE_KEY is
 *     only an operator fallback) — NEVER the AI's key.
 *   - Only signs policy-approved, session-scoped proposals.
 *   - Never fabricates a hash: throws on FAILED or missing hash/callsId.
 */

export interface AltanaSignerConfig {
  /** Operator fallback key (BAN_BNB_PRIVATE_KEY). Ignored when the agent has its own keystore. */
  privateKey?: string;
  chainId?: number;
}

export interface ProvisionedWallet {
  agentId: string;
  walletAddress: string;
  createdAt: string;
  generatedKey: boolean;
}

const logger = createLogger('altana-signer');

export function getAltanaSignerConfig(): AltanaSignerConfig {
  return {
    privateKey: process.env.BAN_BNB_PRIVATE_KEY,
    chainId: Number(process.env.BAN_CHAIN_ID || 56),
  };
}

function validateChain(chainId: number): void {
  if (chainId !== 56) {
    throw new BANError(
      ErrorCode.INTERNAL,
      `Altana signer is scoped to BNB mainnet (56), got ${chainId}. Testnet (97) requires an explicit non-production config.`,
      { retryable: false },
    );
  }
}

function validateAgentId(agentId: string): void {
  if (!agentId || !/^ag_/.test(agentId)) {
    throw new BANError(ErrorCode.VALIDATION_FAILED, `Invalid agent id for keystore: '${agentId}'`, {
      retryable: false,
    });
  }
}

async function loadSdk() {
  try {
    return await import('@altananetwork/sdk');
  } catch (err) {
    throw new BANError(
      ErrorCode.INTERNAL,
      `Failed to load @altananetwork/sdk — install it to enable onchain execution: ${err instanceof Error ? err.message : String(err)}`,
      { retryable: false },
    );
  }
}

export function altanaStoreDir(): string {
  return getAltanaStoreDir();
}

/**
 * Provision (idempotently) the dedicated wallet for a deployed agent.
 * Generates + persists the agent's private-key signer if none exists yet, then
 * creates its smart-contract wallet. Returns the derived address — NEVER the key.
 */
export async function provisionAgentWallet(agentId: string): Promise<ProvisionedWallet> {
  validateAgentId(agentId);
  const sdk = await loadSdk();

  const existing = await loadAgentKeystore(agentId);
  if (existing) {
    logger.info('altana_wallet_existing', { agentId, address: existing.walletAddress });
    return {
      agentId,
      walletAddress: existing.walletAddress,
      createdAt: existing.createdAt,
      generatedKey: false,
    };
  }

  // Generate the agent's dedicated private-key signer. Never the AI's key.
  const signer = sdk.createPrivateKeySigner();
  const client = sdk.createClient({ chains: [sdk.BNB] });
  const wallet = await client.createWallet({ signer });
  const derivedAddress = wallet.address;

  const maybeKey =
    (signer as unknown as { _privateKey?: `0x${string}` })._privateKey ??
    (signer as unknown as { privateKey?: `0x${string}` }).privateKey;

  if (!maybeKey) {
    throw new BANError(
      ErrorCode.INTERNAL,
      `Altana signer did not expose a private key to persist for agent ${agentId}; refusing to provision without a stored key`,
      { retryable: true },
    );
  }

  const keystore = {
    agentId,
    privateKey: maybeKey,
    walletAddress: derivedAddress,
    createdAt: new Date().toISOString(),
  };
  await saveAgentKeystore(keystore);

  logger.info('altana_wallet_provisioned', {
    agentId,
    address: derivedAddress,
    keySource: 'generated-per-agent',
  });

  return {
    agentId,
    walletAddress: derivedAddress,
    createdAt: keystore.createdAt,
    generatedKey: true,
  };
}

/**
 * Build a per-agent SigningBackend (exact @ban/signers SigningBackend shape:
 * SignRequest { proposal, calldata, to, chainId }). Loads the AGENT'S OWN key
 * from its keystore; falls back to the operator env key only if no agent
 * keystore exists.
 */
export async function createAltanaSigningBackend(
  agentId: string,
  config: AltanaSignerConfig = getAltanaSignerConfig(),
): Promise<SigningBackend> {
  validateChain(config.chainId ?? 56);
  const sdk = await loadSdk();

  const agentKey = await loadAgentKeystore(agentId);
  const privateKey =
    agentKey?.privateKey ??
    (config.privateKey && config.privateKey !== 'your_agent_private_key_here'
      ? (config.privateKey as `0x${string}`)
      : undefined);

  const signer = privateKey ? sdk.signerFromPrivateKey(privateKey) : sdk.createPrivateKeySigner();
  const client = sdk.createClient({ chains: [sdk.BNB] });
  const wallet = await client.createWallet({ signer });

  logger.info('altana_wallet_ready', {
    agentId,
    address: wallet.address,
    chainId: config.chainId ?? 56,
    keySource: agentKey ? 'agent-keystore' : privateKey ? 'operator-fallback' : 'generated',
  });

  return async (request: SignRequest): Promise<SignedTransaction> => {
    const { proposal, calldata, to, chainId } = request;
    if (!proposal || !to || !proposal.function) {
      throw new BANError(ErrorCode.EXECUTION_FAILED, 'Altana signer requires a complete policy-approved proposal', { retryable: false });
    }

    const value = (proposal.params?.value as string | bigint | undefined) ?? 0n;

    try {
      const result = await client.execute({
        wallet,
        signer,
        chainId,
        calls: [
          {
            to: to as `0x${string}`,
            data: (calldata || undefined) as `0x${string}` | undefined,
            value: typeof value === 'bigint' ? value : BigInt(value),
          },
        ],
      });

      if (result.status === 'FAILED') {
        throw new BANError(ErrorCode.EXECUTION_FAILED, `Altana execute() reported FAILED for proposal ${proposal.proposalId}`, { retryable: true });
      }

      const txHash = result.transactionHash ?? result.callsId;
      if (!txHash) {
        throw new BANError(
          ErrorCode.EXECUTION_FAILED,
          `Altana execute() returned no transaction hash / calls id for proposal ${proposal.proposalId}; refusing to report success`,
          { retryable: true },
        );
      }

      logger.info('altana_execution_submitted', {
        agentId,
        proposalId: proposal.proposalId,
        contract: to,
        function: proposal.function,
        transactionHash: txHash,
        status: result.status,
      });

      return {
        signature: txHash,
        backend: 'altana',
        signedAt: new Date().toISOString(),
      } as SignedTransaction;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('altana_execution_rejected', { agentId, proposalId: proposal.proposalId, message });
      throw new BANError(
        ErrorCode.EXECUTION_FAILED,
        `Altana execution failed for proposal ${proposal.proposalId}: ${message}`,
        { retryable: true },
      );
    }
  };
}

/**
 * Dedicated per-agent execution backend shaped for run-cycle:
 * returns { transactionHash } or null when no agent keystore exists (honest
 * "awaiting execution" — nothing is fabricated or broadcast without a key).
 */
export async function createAgentExecutionBackend(agentId: string): Promise<((input: {
  proposal: ActionProposal;
  session: unknown;
}) => Promise<{ transactionHash: string }>) | null> {
  const agentKey = await loadAgentKeystore(agentId);
  if (!agentKey) {
    return null;
  }
  const sign = await createAltanaSigningBackend(agentId);
  return async (input) => {
    const proposal = input.proposal;
    const signed = await sign({
      proposal,
      calldata: (proposal.params?.calldata as string | undefined) ?? '',
      to: proposal.contract,
      chainId: Number(proposal.params?.chainId ?? 56),
    });
    if (!signed.signature) {
      throw new BANError(ErrorCode.EXECUTION_FAILED, 'Altana signer returned no signature', { retryable: true });
    }
    return { transactionHash: signed.signature };
  };
}

export { hasAgentKeystore, loadAgentKeystore };