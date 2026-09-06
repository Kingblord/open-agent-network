import { NextRequest, NextResponse } from 'next/server';
import { getTokenFromRequest } from '@/lib/api-middleware';
import { verifyToken } from '@/lib/auth';
import { handleError, errorResponse } from '@/lib/core/errors';
import { createStructuredLogger } from '@/lib/core/logger';
import { getCorrelationId } from '@/lib/core/request-context';
import { agentRegistry } from '@/lib/agent-registry';
import { loadAgentKeystore } from '@/lib/altana/keystore';
import { createWalletClient, createPublicClient, http, parseEther, parseUnits, type Hex, type Address } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { ErrorCode } from '@ban/shared';

const logger = createStructuredLogger('api.agents.withdraw');

const BSC_CHAIN = {
  id: 56,
  name: 'BNB Smart Chain',
  nativeCurrency: { name: 'BNB', symbol: 'BNB', decimals: 18 },
  rpcUrls: {
    default: { http: [process.env.BAN_RPC_URL ?? 'https://bsc-dataseed.binance.org/'] },
  },
} as const;

/** Minimum BNB balance the agent must retain for gas ($0.50 worth). */
const MIN_GAS_USD = 0.50;

// Minimal ERC-20 ABI for transfer
const ERC20_ABI = [
  {
    name: 'transfer',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

const TOKEN_ADDRESSES: Record<string, Address> = {
  BNB: '0x0000000000000000000000000000000000000000' as Address,
  USDT: '0x55d398326f99059fF775485246999027B3197955' as Address,
  USDC: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d' as Address,
};

/**
 * POST /api/agents/[id]/withdraw
 *
 * Withdraws funds FROM the agent's wallet TO the user's wallet.
 * The agent pays gas from its own BNB balance.
 *
 * Body: { to: string, amount: string, token?: string }
 *   - to: user's destination wallet address
 *   - amount: amount to withdraw (in token units, e.g. "0.1" BNB or "10" USDT)
 *   - token: "BNB" (default), "USDT", or "USDC"
 *
 * Returns the transaction hash on success.
 */
export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const token = getTokenFromRequest(request);
    const user = token ? verifyToken(token) : null;
    if (!user) {
      return errorResponse(401, 'Unauthorized: missing or invalid token', {
        code: ErrorCode.UNAUTHENTICATED,
        correlationId: getCorrelationId(),
      });
    }

    const { id: agentId } = await ctx.params;
    const agent = await agentRegistry.getById(agentId);
    if (!agent) {
      return errorResponse(404, 'Agent not found', {
        code: ErrorCode.VALIDATION_FAILED,
        correlationId: getCorrelationId(),
      });
    }
    if (agent.ownerId !== user.developerId) {
      return errorResponse(403, 'Not your agent', {
        code: ErrorCode.FORBIDDEN,
        correlationId: getCorrelationId(),
      });
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return errorResponse(400, 'Invalid JSON body', {
        code: ErrorCode.SCHEMA_INVALID,
        correlationId: getCorrelationId(),
      });
    }

    const to = typeof body.to === 'string' && /^0x[a-fA-F0-9]{40}$/.test(body.to)
      ? (body.to as Address)
      : null;
    if (!to) {
      return errorResponse(422, 'Valid to address (0x...) is required', {
        code: ErrorCode.VALIDATION_FAILED,
        correlationId: getCorrelationId(),
      });
    }

    const rawAmount = typeof body.amount === 'string' ? body.amount : String(body.amount ?? '');
    const amountNum = Number(rawAmount);
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      return errorResponse(422, 'amount must be a positive number', {
        code: ErrorCode.VALIDATION_FAILED,
        correlationId: getCorrelationId(),
      });
    }

    const withdrawToken = typeof body.token === 'string' ? body.token.toUpperCase() : 'BNB';
    if (withdrawToken !== 'BNB' && withdrawToken !== 'USDT' && withdrawToken !== 'USDC') {
      return errorResponse(422, 'token must be BNB, USDT, or USDC', {
        code: ErrorCode.VALIDATION_FAILED,
        correlationId: getCorrelationId(),
      });
    }

    // Load the agent's private key from its encrypted keystore
    const keystore = await loadAgentKeystore(agentId);
    if (!keystore) {
      return errorResponse(409, 'Agent has no signing key — cannot sign withdrawal', {
        code: ErrorCode.PROVIDER_UNAVAILABLE,
        correlationId: getCorrelationId(),
      });
    }

    // Create viem clients from agent's private key
    const account = privateKeyToAccount(keystore.privateKey);
    const walletClient = createWalletClient({
      chain: BSC_CHAIN,
      transport: http(BSC_CHAIN.rpcUrls.default.http[0]),
      account,
    });
    const publicClient = createPublicClient({
      chain: BSC_CHAIN,
      transport: http(BSC_CHAIN.rpcUrls.default.http[0]),
    });
    let txHash: string;

    if (withdrawToken === 'BNB') {
      // Simple BNB transfer
      const value = parseEther(rawAmount as `${number}`);

      // Check agent wallet has enough BNB for the transfer + gas
      const balance = await publicClient.getBalance({ address: account.address });
      let bnbPriceUsd = 600;
      try {
        const priceRes = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=binancecoin&vs_currencies=usd');
        const priceJson = await priceRes.json() as { binancecoin?: { usd?: number } };
        if (priceJson?.binancecoin?.usd) bnbPriceUsd = priceJson.binancecoin.usd;
      } catch { /* use fallback price */ }
      const minReserveWei = BigInt(Math.floor((MIN_GAS_USD / bnbPriceUsd) * 1e18));
      const estimatedGas = 21000n * 3_000_000_000n; // 3 gwei
      const totalCost = value + estimatedGas + minReserveWei;
      if (balance < totalCost) {
        const available = Number(balance - estimatedGas - minReserveWei) / 1e18;
        const bnbAvailable = Number(balance) / 1e18;
        const totalCostBnb = Number(totalCost) / 1e18;
        return errorResponse(409, `Insufficient BNB for withdrawal. You have ${bnbAvailable.toFixed(6)} BNB. Withdrawing ${rawAmount} BNB requires ~${totalCostBnb.toFixed(6)} BNB (including ~$0.50 gas reserve). Maximum withdrawable: ${available > 0 ? available.toFixed(6) : '0'} BNB.`, {
          code: ErrorCode.POLICY_DENIED,
          correlationId: getCorrelationId(),
        });
      }

      txHash = await walletClient.sendTransaction({
        to,
        value,
        chain: BSC_CHAIN,
      });
    } else {
      // ERC-20 transfer (USDT/USDC)
      const tokenAddr = TOKEN_ADDRESSES[withdrawToken];
      const decimals = 18;
      const amountWei = parseUnits(rawAmount as `${number}`, decimals);

      // Validate the token balance before attempting to sign. This is required
      // for deposits made after the page was opened and prevents a generic
      // contract revert when the UI has stale balance data.
      const tokenBalance = await publicClient.readContract({
        address: tokenAddr,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [account.address],
      });
      if (tokenBalance < amountWei) {
        return errorResponse(409, `Insufficient ${withdrawToken} balance. Available: ${Number(tokenBalance) / 10 ** decimals} ${withdrawToken}.`, {
          code: ErrorCode.POLICY_DENIED,
          correlationId: getCorrelationId(),
        });
      }

      // Check agent wallet has enough BNB for gas (no minimum reserve for token withdrawals)
      const bnbBalance = await publicClient.getBalance({ address: account.address });
      const estimatedGas = 60000n * 3_000_000_000n; // ~$0.18 at 3 gwei
      if (bnbBalance < estimatedGas) {
        const bnbAvailable = Number(bnbBalance) / 1e18;
        const bnbNeeded = Number(estimatedGas) / 1e18;
        return errorResponse(409, `Agent wallet has ${bnbAvailable.toFixed(6)} BNB — needs at least ${bnbNeeded.toFixed(6)} BNB (~$0.18) for gas to send ${withdrawToken}. Top up BNB first.`, {
          code: ErrorCode.PROVIDER_UNAVAILABLE,
          correlationId: getCorrelationId(),
        });
      }

      txHash = await walletClient.writeContract({
        address: tokenAddr,
        abi: ERC20_ABI,
        functionName: 'transfer',
        args: [to, amountWei],
        chain: BSC_CHAIN,
      });
    }

    logger.info('withdraw_submitted', {
      agentId,
      to,
      amount: rawAmount,
      token: withdrawToken,
      txHash,
      correlationId: getCorrelationId(),
    });

    return NextResponse.json({
      ok: true,
      txHash,
      agentId,
      to,
      amount: rawAmount,
      token: withdrawToken,
      chainId: 56,
      note: `Withdrawal of ${rawAmount} ${withdrawToken} submitted. Check BscScan for confirmation.`,
    });
  } catch (err) {
    logger.error('withdraw_failed', {}, err);
    return handleError(err);
  }
}