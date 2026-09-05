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

      // Check agent wallet has enough BNB (balance + gas)
      const balance = await publicClient.getBalance({ address: account.address });
      const estimatedGas = 21000n;
      const totalCost = value + estimatedGas * 3_000_000_000n; // 3 gwei
      if (balance < totalCost) {
        return errorResponse(409, `Agent wallet only has ${Number(balance) / 1e18} BNB — insufficient for ${rawAmount} BNB + gas. Top up the agent wallet first.`, {
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

      // Check agent wallet has enough BNB for gas
      const bnbBalance = await publicClient.getBalance({ address: account.address });
      const estimatedGas = 60000n;
      const gasCost = estimatedGas * 3_000_000_000n;
      if (bnbBalance < gasCost) {
        return errorResponse(409, `Agent wallet only has ${Number(bnbBalance) / 1e18} BNB — insufficient for gas. Top up the agent wallet with BNB first.`, {
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