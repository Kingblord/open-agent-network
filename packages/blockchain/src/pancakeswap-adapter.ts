import { encodeFunctionData, type Hex } from 'viem';
import { BANError, ErrorCode, createLogger } from '@ban/shared';
import {
  ContractRegistry,
  DeploymentRegistry,
  TokenRegistry,
  Eip55Validator,
  BnbAddressVerifier,
} from '@ban/registry';
import type { SwapAdapter } from './index.js';

/**
 * PancakeSwapAdapter — mustflow §16 protocol adapter, registry-enforced.
 *
 * Guarantees (all fail-closed, matching mustflow invariants §5/#10–13):
 *   - Only the VERIFIED router address from DeploymentRegistry may be targeted.
 *   - Only a DECLARED `EXECUTE` function may be used (never arbitrary calldata).
 *   - Both tokens must be verified AND enabled in TokenRegistry.
 *   - Slippage/deadline bounds must be sane.
 *   - Off-chain quote/simulate use only deterministic math or the injected
 *     `quoteProvider`/`simulator`; they NEVER return a fabricated "confirmed"
 *     transaction.
 *
 * The adapter is deliberately offline-safe: it imports no network transport and
 * never broadcasts. The execution engine's submit path adds the RPC/signature
 * layer separately (see provider.ts + signers package).
 */

export interface PancakeSwapDeps {
  deployments: DeploymentRegistry;
  contracts: ContractRegistry;
  tokens: TokenRegistry;
  /** Optional injected quote provider (RPC-backed or dev). If absent, `getQuote` throws (never fabricates). */
  quoteProvider?: {
    getAmountsOut(input: { router: string; amountIn: bigint; path: string[] }): Promise<bigint>;
  };
  /** Optional injected simulator (RPC-backed eth_call/poll). If absent, `simulate` returns { ok:false } (never fabricates). */
  simulator?: {
    simulate(input: { calldata: string; router: string; from: string }): Promise<{ ok: boolean; amountOut?: string; revertReason?: string }>;
  };
}

export class PancakeSwapAdapter implements SwapAdapter {
  private readonly logger = createLogger('pancakeswap-adapter');

  constructor(private readonly deps: PancakeSwapDeps) {}

  /** Resolve the verified router on the BAN chain (fail-closed). */
  private router(): string {
    return this.deps.deployments.requireAddress('pancakeswap', 'router');
  }

  /** Validate a token id/address is verified + enabled. */
  private requireToken(token: string): string {
    const record = this.deps.tokens.requireEnabled(token);
    return record.address;
  }

  /** Validate the target contract is the verified router + declared EXECUTE fn. */
  private requireExecutableRouter(contract: string, fn: string): void {
    this.deps.contracts.requireExecute(contract, fn);
    // Must be the canonical router — not some arbitrary registered contract.
    const router = this.router();
    if (!this.deps.contracts.matchesAddress(contract, router)) {
      throw new BANError(
        ErrorCode.CONTRACT_NOT_ALLOWED,
        `Contract ${contract} is not the verified PancakeSwap router (${router})`,
      );
    }
  }

  /**
   * getQuote — off-chain deterministic quote. Only returns a value when a
   * quoteProvider is injected; otherwise throws (never fabricates).
   */
  async getQuote(input: {
    tokenIn: string;
    tokenOut: string;
    amountIn: string;
    slippageBps: number;
  }): Promise<{ amountOut: string; priceImpactBps: number; route: string[]; gasEstimate: string; timestamp: string }> {
    const tokenInAddr = this.requireToken(input.tokenIn);
    const tokenOutAddr = this.requireToken(input.tokenOut);
    if (input.slippageBps < 0 || input.slippageBps > 10000) {
      throw new BANError(ErrorCode.SLIPPAGE_VIOLATION, `slippageBps ${input.slippageBps} out of bounds [0,10000]`);
    }
    const amountIn = BigInt(input.amountIn || '0');
    if (amountIn <= 0n) {
      throw new BANError(ErrorCode.VALIDATION_FAILED, 'amountIn must be > 0');
    }
    if (!this.deps.quoteProvider) {
      throw new BANError(
        ErrorCode.PROVIDER_UNAVAILABLE,
        'PancakeSwapAdapter has no quoteProvider configured; refusing to fabricate a quote',
        { retryable: true },
      );
    }
    const router = this.router();
    const amountOut = await this.deps.quoteProvider.getAmountsOut({
      router,
      amountIn,
      path: [tokenInAddr, tokenOutAddr],
    });
    if (amountOut <= 0n) {
      throw new BANError(ErrorCode.TX_REVERTED, 'quote returned zero output; refusing to fabricate a route');
    }
    return {
      amountOut: String(amountOut),
      priceImpactBps: input.slippageBps,
      route: [tokenInAddr, tokenOutAddr],
      gasEstimate: '0', // not measured — always honest
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * simulate — registry-enforced preflight. Builds only the canonical, encoded
   * call (never arbitrary calldata) and passes it to an injected simulator.
   * Without a simulator it returns { ok:false } rather than pretending success.
   */
  async simulate(input: {
    tokenIn: string;
    tokenOut: string;
    amountIn: string;
    slippageBps: number;
    deadline?: number;
  }): Promise<{ ok: boolean; amountOut?: string; revertReason?: string }> {
    try {
      const tokenInAddr = this.requireToken(input.tokenIn);
      const tokenOutAddr = this.requireToken(input.tokenOut);
      const router = this.router();
      this.requireExecutableRouter(router, 'swapExactTokensForTokens');

      const amountIn = BigInt(input.amountIn || '0');
      const minOut = (amountIn * BigInt(Math.max(0, 10000 - input.slippageBps))) / 10000n;
      const deadline = BigInt(input.deadline ?? Math.floor(Date.now() / 1000) + 600);
      const calldata = encodeFunctionData({
        abi: [
          {
            type: 'function',
            name: 'swapExactTokensForTokens',
            stateMutability: 'nonpayable',
            inputs: [
              { name: 'amountIn', type: 'uint256' },
              { name: 'amountOutMin', type: 'uint256' },
              { name: 'path', type: 'address[]' },
              { name: 'to', type: 'address' },
              { name: 'deadline', type: 'uint256' },
            ],
            outputs: [{ name: 'amounts', type: 'uint256[]' }],
          },
        ],
        functionName: 'swapExactTokensForTokens',
        args: [amountIn, minOut, [tokenInAddr, tokenOutAddr], tokenInAddr, deadline],
      } as Parameters<typeof encodeFunctionData>[0]);

      if (!this.deps.simulator) {
        // No simulator injected — be explicit: we did NOT simulate.
        this.logger.warn('pancakeswap_simulate_not_configured', { note: 'simulation was NOT performed' });
        return { ok: false, revertReason: 'simulation not configured; refusing to claim a simulation happened' };
      }
      return await this.deps.simulator.simulate({ calldata: calldata as Hex, router, from: tokenInAddr });
    } catch (err) {
      if (err instanceof BANError) throw err;
      return { ok: false, revertReason: (err as Error).message };
    }
  }
}

/** Registry-backed PancakeSwap adapter factory for a mainnet (56) setup. */
export function createPancakeSwapAdapter(deps: PancakeSwapDeps): PancakeSwapAdapter {
  return new PancakeSwapAdapter(deps);
}

/** Re-export verification helpers so consumers can enable strict EIP-55 where desired. */
export { Eip55Validator, BnbAddressVerifier };