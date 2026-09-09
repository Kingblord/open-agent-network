import 'server-only';
import type { ActionProposal } from '@ban/schemas';
import { BANError, ErrorCode, createLogger } from '@ban/shared';
import type { SignedTransaction, SigningBackend, SignRequest } from '@ban/signers';
import type { Address } from 'viem';
import { buildPancakeV3SwapCalls, resolveBestFeeTier, type ExecutableCall } from './execution/pancake-v3';
import { buildVenusCalls, buildAaveCalls } from './execution/lending';
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

/** BSC chain descriptor for viem clients (mirrors the withdraw route). */
export const BSC_CHAIN = {
  id: 56,
  name: 'BNB Smart Chain',
  nativeCurrency: { name: 'BNB', symbol: 'BNB', decimals: 18 },
  rpcUrls: {
    default: { http: [process.env.BAN_RPC_URL ?? 'https://bsc-dataseed.binance.org/'] },
  },
} as const;

export interface ProvisionedWallet {
  agentId: string;
  walletAddress: string;
  createdAt: string;
  generatedKey: boolean;
}

const logger = createLogger('altana-signer');

/**
 * Map a lending proposal's strategy vocabulary to the builder intent.
 * Health proposals carry params.healthAction (mint/repayBorrow live in the
 * canonical proposal's `function`); yield proposals carry params.yieldAction
 * (DEPOSIT/WITHDRAW). Withdrawals redeem; deposits and repays fund.
 */
function lendingIntentOf(proposal: ActionProposal): 'DEPOSIT' | 'WITHDRAW' | 'REPAY' {
  const params = (proposal.params ?? {}) as Record<string, unknown>;
  const yieldAction = typeof params.yieldAction === 'string' ? params.yieldAction.toUpperCase() : '';
  if (yieldAction === 'WITHDRAW') return 'WITHDRAW';
  const healthAction = typeof params.healthAction === 'string' ? params.healthAction.toUpperCase() : '';
  if (healthAction === 'REPAY' || proposal.function === 'repayBorrow') return 'REPAY';
  return 'DEPOSIT';
}

/** BSC mainnet stablecoin constants (18 decimals each). */
const STABLECOINS: Record<string, { address: Address; symbol: string }> = {
  '0x55d398326f99059ff775485246999027b3197955': { address: '0x55d398326f99059fF775485246999027B3197955', symbol: 'USDT' },
  '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d': { address: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', symbol: 'USDC' },
};
const PANCAKE_V3_ROUTER = '0x13f4EA83D0bd40E75C8222255bc855a974568Dd4' as Address;
const ERC20_BAL_ABI: readonly unknown[] = [
  { name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] },
];

/**
 * AUTONOMOUS FUEL REBALANCE — a health REPAY spends the DEBT token (e.g. the
 * user owes USDC), but the agent wallet may hold a DIFFERENT stablecoin (e.g.
 * USDT from a user deposit). Before broadcasting the repayment, verify the
 * wallet actually holds the debt token; if not, swap from whatever stablecoin
 * it DOES hold through PancakeSwap V3 (USDT↔USDC pools are deep and ~0.05%).
 *
 * SWAP SIZING: exact need + 1% buffer, rounded up to whole cents, never more
 * than the held source balance. Returns the SWAP call list (approve+swap) to
 * broadcast BEFORE the repay, or [] when no rebalance is needed.
 */
async function buildFuelRebalanceCalls(
  publicClient: { readContract: (p: { address: string; abi: readonly unknown[]; functionName: string; args: string[] }) => Promise<bigint> },
  walletAddress: `0x${string}`,
  underlying: Address,
  repayAmountWei: bigint,
): Promise<ExecutableCall[]> {
  try {
    // 1) Does the wallet hold enough of the debt token already?
    const held = await publicClient.readContract({
      address: underlying,
      abi: ERC20_BAL_ABI,
      functionName: 'balanceOf',
      args: [walletAddress],
    });
    if (held >= repayAmountWei) return []; // already funded — no swap needed

    // 2) Find a different stablecoin the wallet actually holds.
    const needWei = repayAmountWei - held;
    const shortfallUsd = Number(needWei) / 1e18;
    const swapFromKey = Object.keys(STABLECOINS).find((k) => k !== underlying.toLowerCase());
    if (!swapFromKey) return [];
    const swapFrom = STABLECOINS[swapFromKey];
    const srcBalance = await publicClient.readContract({
      address: swapFrom.address,
      abi: ERC20_BAL_ABI,
      functionName: 'balanceOf',
      args: [walletAddress],
    });
    if (srcBalance <= 0n) return []; // no source fuel — honest no-op

    // 3) Size: exact need + 1% buffer, capped by what we hold.
    const buffer = (needWei * 101n) / 100n;
    const amountIn = buffer < srcBalance ? buffer : srcBalance;
    // Round up to whole cents so the swap is never dust-sized.
    const amountInCents = ((amountIn + 99999999999999999n) / 100000000000000000n) * 100000000000000000n;
    const sized = amountInCents > srcBalance ? srcBalance : amountInCents;
    if (sized <= 0n) return [];

    // 4) Build the V3 swap: source → debt token, at the $1 stablecoin peg.
    const feeTier = await resolveBestFeeTier(swapFrom.address, underlying);
    const calls = buildPancakeV3SwapCalls(
      {
        side: 'BUY',
        tokenIn: swapFrom.address,
        tokenOut: underlying,
        amountIn: sized,
        levelPriceUsd: 1.0, // stablecoin peg
        slippageBps: 300,
        feeTier,
      },
      walletAddress,
      PANCAKE_V3_ROUTER,
    );
    logger.info('fuel_rebalance_planned', {
      swapFrom: swapFrom.symbol,
      swapTo: underlying,
      usd: (Number(sized) / 1e18).toFixed(2),
      reason: `need ${shortfallUsd.toFixed(2)} ${underlying.slice(0, 8)} for repay`,
    });
    return calls;
  } catch (err) {
    // NEVER fabricate a swap on a read failure — the repay will just fail
    // on-chain (honest) rather than invent a swap.
    logger.warn('fuel_rebalance_check_failed', {
      message: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

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

    // Build the executable call list. Strategy-authored `execKind` params
    // produce DETERMINISTIC protocol calls (approve+swap) — a real-funds guard:
    // the signer never broadcasts a transaction it cannot fully construct, and
    // a proposal with neither calldata nor a recognized execKind FAILS CLOSED
    // instead of broadcasting an empty/garbage call to a contract.
    let calls: ExecutableCall[];
    const execKind = (proposal.params?.execKind as string | undefined) ?? '';
    const trimmedCalldata = typeof calldata === 'string' ? calldata.trim() : '';

    if (execKind === 'PANCAKE_V3_SWAP') {
      const p = (proposal.params ?? {}) as Record<string, unknown>;
      const amountIn = BigInt(String(p.amountIn ?? proposal.amount ?? '0'));
      // FEE TIER AUTO-DETECT: resolve the best on-chain pool tier for the pair
      // (deepest liquidity) unless the proposal carries an explicit override.
      // A wrong tier would revert the swap on-chain — safe, but the fill is
      // lost — so the signer resolves it live before building the calldata.
      const requestedTier = Number(p.feeTier);
      const feeTier =
        Number.isFinite(requestedTier) && [100, 500, 2500, 10000].includes(requestedTier)
          ? requestedTier
          : await resolveBestFeeTier(p.tokenIn as Address, p.tokenOut as Address);
      calls = buildPancakeV3SwapCalls(
        {
          side: p.side === 'SELL' ? 'SELL' : 'BUY',
          tokenIn: p.tokenIn as Address,
          tokenOut: p.tokenOut as Address,
          amountIn,
          levelPriceUsd: Number(p.levelPriceUsd),
          slippageBps: Number(p.slippageBps ?? undefined),
          feeTier,
        },
        wallet.address as Address,
        to as Address,
      );
    } else if (execKind === 'VENUS_LENDING') {
      const intent = lendingIntentOf(proposal);
      calls = buildVenusCalls({
        target: to as Address,
        underlying: (proposal.params?.underlying ?? proposal.token) as Address,
        amount: BigInt(proposal.amount),
        wallet: wallet.address as Address,
        // When the health strategy repays the USER's debt (watchAddress/user
        // wallet), the repayment must target the USER's position — NOT the
        // agent's own (which has no debt). The user's wallet is threaded
        // through params.userWalletAddress (stamped by run-cycle from the
        // owner record). Without it the agent can only act on its own
        // position.
        beneficiary: (proposal.params?.userWalletAddress as Address | undefined) ?? undefined,
        intent,
      });
    } else if (execKind === 'AAVE_V3') {
      const intent = lendingIntentOf(proposal);
      calls = buildAaveCalls({
        target: to as Address,
        underlying: proposal.token as Address,
        amount: BigInt(proposal.amount),
        wallet: wallet.address as Address,
        beneficiary: (proposal.params?.userWalletAddress as Address | undefined) ?? undefined,
        intent,
      });
    } else if (trimmedCalldata) {
      calls = [
        {
          to: to as `0x${string}`,
          data: trimmedCalldata as `0x${string}`,
          value: typeof value === 'bigint' ? value : BigInt(value),
        },
      ];
    } else {
      throw new BANError(
        ErrorCode.EXECUTION_FAILED,
        `Refusing to broadcast: proposal ${proposal.proposalId} has no calldata and no recognized execKind (params.execKind). The strategy must build executable call data before a real transaction can be sent. Nothing was broadcast.`,
        { retryable: false },
      );
    }

    try {
      // DIRECT-VIEM EXECUTION (primary): the agent keystore holds a plain
      // secp256k1 private key — the same kind the WITHDRAW route already uses
      // to broadcast ERC-20/native txs directly to the BSC RPC with viem
      // (proven working). Each built call is a standard contract call:
      //   approve(USDC) → repayBorrowBehalf(owner, 2.8e18) → vUSDC
      // We sign + broadcast each call as a normal EOA transaction — NO Altana
      // relay, NO ERC-7702 userOp, NO wallet_prepareCalls. This avoids the
      // relay's tracer bug entirely.
      //
      // The Altana relay path remains available behind BAN_USE_ALTANA_RELAY=1
      // for environments that require the smart-account userOp stack; it is
      // NOT the default because relay.altana.network currently rejects
      // prepareCalls with "please assign a tracer, such as callTracer".
      if (process.env.BAN_USE_ALTANA_RELAY !== '1') {
        // Direct EOA broadcast REQUIRES the actual private key (a generated
        // in-memory signer has no self-custodied key to sign the EOA tx).
        if (!privateKey) {
          throw new BANError(
            ErrorCode.EXECUTION_FAILED,
            `Direct execution requires the agent's own keystore key (agent ${agentId} has none). No transaction was broadcast.`,
            { retryable: false },
          );
        }
        const { createPublicClient, createWalletClient, http } = await import('viem');
        const { privateKeyToAccount } = await import('viem/accounts');
        const rpcUrl = process.env.BAN_RPC_URL ?? 'https://bsc-dataseed.binance.org/';
        const account = privateKeyToAccount(privateKey);
        const chain = {
          id: 56,
          name: 'BNB Smart Chain',
          nativeCurrency: { name: 'BNB', symbol: 'BNB', decimals: 18 },
          rpcUrls: { default: { http: [rpcUrl] } },
        } as const;
        const walletClient = createWalletClient({
          chain,
          transport: http(rpcUrl),
          account,
        });
        const publicClient = createPublicClient({
          chain,
          transport: http(rpcUrl),
        });

        // Fail-closed preflight: the wallet must have BNB for gas. No balance
        // claim is ever assumed — read the real chain state.
        const bnb = await publicClient.getBalance({ address: account.address });
        const GAS_FLOOR = BigInt('1500000000000000'); // 0.0015 BNB (~$1 at $670)
        if (bnb < GAS_FLOOR) {
          throw new BANError(
            ErrorCode.POLICY_DENIED,
            `Agent wallet ${account.address} has ${(Number(bnb) / 1e18).toFixed(6)} BNB — below the ${(Number(GAS_FLOOR) / 1e18).toFixed(4)} BNB gas floor. Top up BNB (native) to broadcast the ${proposal.function} call. No transaction was broadcast.`,
            { retryable: true },
          );
        }

        // AUTONOMOUS FUEL REBALANCE: a REPAY spends the DEBT token. If the agent
        // wallet holds a different stablecoin (user deposited USDT, debt is
        // USDC), swap first so the repay can complete — the agent rebalances
        // its own fuel, never the user's. Broadcast the swap calls FIRST,
        // then the approve+repay (order matters on-chain).
        let lastTxHash: `0x${string}` | null = null;
        // Every dependent tx (approve → swap → approve → repay) MUST be mined
        // before the next is sent — a "fast" send with a reused nonce or an
        // un-landed allowance is what makes the swap revert with STF.
        const sendAndWait = async (callItem: ExecutableCall): Promise<`0x${string}`> => {
          const hash = await walletClient.sendTransaction({
            to: callItem.to,
            value: callItem.value,
            data: callItem.data,
            chain,
          });
          try {
            await (publicClient as unknown as {
              waitForTransactionReceipt: (p: { hash: `0x${string}`; timeout: number; confirmations: number }) => Promise<{ status: string }>;
            }).waitForTransactionReceipt({
              hash,
              timeout: 60_000,
              confirmations: 1,
            });
            logger.info('direct_tx_mined', { agentId, proposalId: proposal.proposalId, txHash: hash });
          } catch (waitErr) {
            // A receipt wait timeout is NOT a revert proof; surface the tx hash
            // and let the confirm-watcher reconcile (honest).
            logger.warn('direct_tx_wait_timeout', {
              agentId,
              proposalId: proposal.proposalId,
              txHash: hash,
              message: waitErr instanceof Error ? waitErr.message : String(waitErr),
            });
          }
          return hash;
        };

        if (proposal.function === 'repayBorrowBehalf' || proposal.function === 'repayBorrow') {
          const underlying = (proposal.params?.underlying ?? proposal.token) as Address | undefined;
          if (underlying && /^0x[a-fA-F0-9]{40}$/.test(String(underlying))) {
            const rebalanceCalls = await buildFuelRebalanceCalls(
              publicClient as never,
              account.address,
              underlying,
              BigInt(proposal.amount ?? '0'),
            );
            for (const swapCall of rebalanceCalls) {
              lastTxHash = await sendAndWait(swapCall);
              logger.info('fuel_rebalance_swapped', {
                agentId,
                proposalId: proposal.proposalId,
                to: swapCall.to.slice(0, 10),
                txHash: lastTxHash,
              });
            }
          }
        }

        // Broadcast each built call sequentially as a normal EOA tx. The
        // approve MUST land before the protocol call (same as the relay
        // batch), so we send in order and wait for each to mine first.
        // The strategy builders ALREADY ABI-encoded `call.data`, so every
        // call (native or ERC-20) is broadcast as a raw tx with that data.
        for (const callItem of calls) {
          lastTxHash = await sendAndWait(callItem);
          logger.info('direct_tx_sent', {
            agentId,
            proposalId: proposal.proposalId,
            to: callItem.to,
            value: callItem.value.toString(),
            txHash: lastTxHash,
          });
        }

        if (!lastTxHash) {
          throw new BANError(ErrorCode.EXECUTION_FAILED, 'No transaction hash produced by direct execution', { retryable: true });
        }

        logger.info('altana_execution_submitted', {
          agentId,
          proposalId: proposal.proposalId,
          contract: to,
          function: proposal.function,
          transactionHash: lastTxHash,
          status: 'BROADCAST_DIRECT',
          engine: 'viem-eoa',
        });

        return {
          signature: lastTxHash,
          backend: 'altana-viem-direct',
          signedAt: new Date().toISOString(),
        } as SignedTransaction;
      }

      // ALTANA RELAY WORKAROUND (BAN_RELAY_DUST_TAIL=1): some Altana relay/BSC
      // node pairs reject batches where EVERY call has value 0 (their fee
      // simulation needs debug_traceCall+callTracer, which the node may not
      // expose). Appending a 1-wei native self-send makes the batch
      // value-bearing so the relay can quote fees WITHOUT the tracer path.
      // Costs literally 1 wei + the extra userOp gas for one extra internal
      // transfer; does not change the transaction's economic effect.
      //
      // Off by default: it is a relay-compat shim, not a protocol requirement,
      // and it costs a small amount of gas on every broadcast. Enable only
      // when the relay rejects zero-value batches.
      const relayCalls =
        process.env.BAN_RELAY_DUST_TAIL === '1' && calls.length > 0
          ? [...calls, { to: wallet.address as Address, value: 1n, data: '0x' as const }]
          : calls;

      const result = await client.execute({
        wallet,
        signer,
        chainId,
        calls: relayCalls,
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