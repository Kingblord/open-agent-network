// M6 - Deterministic Tool Layer.
//
// The AI is a reasoning layer ONLY. These tools are the atomic, structured data
// + preflight operations it may call. They return structured JSON output
// objects, never raw RPC blobs, and are capability-tagged via ToolCapability
// so the AI can only call tools in its granted capability set. They never
// expose private keys, unrestricted RPC, arbitrary contract calls, or raw
// transaction signing.
//
// Every tool carries its own zod inputSchema so ToolRegistry can enforce input
// validation BEFORE invocation. Tools contain no provider-specific logic; they
// call the shared adapter seam, so the same implementations work against
// DevDataProvider (dev/test) and a future live BNB provider identically.

import { z } from 'zod';
import type { ToolCapability } from '@ban/schemas';
import { ActionProposalSchema } from '@ban/schemas';
import type {
  ProtocolAdapterSet,
  PriceDataAdapter,
  YieldAdapter,
  LendingAdapter,
  LiquidityAdapter,
  SwapAdapter,
} from './index.js';

// Onchain sidecar adapter surfaced to tools: balances, gas, tx status, and the
// validated-proposal preflight. Unlike swap/liquidity/yield/lending, these are
// chain-level reads/estimates the AI needs on the execution path.
export interface ChainAdapter {
  getTokenBalance(input: { token: string; address: string }): Promise<{
    token: string;
    address: string;
    balance: string;
    decimals: number;
    timestamp: string;
  }>;
  getGasEstimate(input: { action: string }): Promise<{
    gasWei: string;
    gasPriceGwei: string;
    estimatedCostUsd: string;
    timestamp: string;
  }>;
  getTransactionStatus(hash: string): Promise<{
    status: 'CONFIRMED' | 'PENDING' | 'REVERTED';
    confirmations: number;
    timestamp: string;
  }>;
  // Deterministic preflight for a validated, policy-checked proposal. Never
  // accepts arbitrary raw transactions.
  simulateProposal(proposal: ReturnType<typeof ActionProposalSchema['parse']>): Promise<{
    ok: boolean;
    estimated?: { amountOut: string; priceImpactBps: number; route: string[] };
    gasWei?: string;
    revertReason?: string;
    timestamp: string;
  }>;
}

// The full adapter surface the tool layer consumes: protocol data-plane plus
// the chain sidecar. Uses nested { price, yield, lending, liquidity, swap } to
// mirror the ProtocolAdapterSet shape.
export type ToolAdapters = ProtocolAdapterSet & { chain: ChainAdapter };

// A single registered tool the AI may invoke. capabilityId is the ONLY window
// into the tool (canonical vocabulary), and invoke returns structured output
// only.
export interface ToolHandle {
  readonly name: string;
  readonly description: string;
  readonly capabilityId: ToolCapability;
  readonly inputSchema: z.ZodTypeAny;
  invoke(input: unknown): Promise<Record<string, unknown>>;
}

const addressSchema = z.string().min(1);
const networkSchema = z.string().min(1);

// Build the full, deterministic tool set against the given adapters.
export function buildToolHandles(adapters: ToolAdapters): ToolHandle[] {
  const { price, chain, liquidity, yield: yieldS, lending, swap } = adapters;

  return [
    // READ_BALANCE
    {
      name: 'getTokenBalance',
      description: 'Read an on-chain token balance for an address.',
      capabilityId: 'READ_BALANCE',
      inputSchema: z.object({ token: z.string(), address: addressSchema }).strict(),
      async invoke(input) {
        const { token, address } = input as { token: string; address: string };
        return chain.getTokenBalance({ token, address });
      },
    },
    // READ_PRICE
    {
      name: 'getTokenPrice',
      description: 'Read the deterministic USD price of a token.',
      capabilityId: 'READ_PRICE',
      inputSchema: z.object({ token: z.string().min(1) }).strict(),
      async invoke(input) {
        const { token } = input as { token: string };
        return price.getTokenPrice(token);
      },
    },
    // READ_LP_POSITION: pool state and LP position
    {
      name: 'getPoolState',
      description: 'Read the deterministic state of a liquidity pool.',
      capabilityId: 'READ_LP_POSITION',
      inputSchema: z.object({ poolAddress: addressSchema }).strict(),
      async invoke(input) {
        const { poolAddress } = input as { poolAddress: string };
        return liquidity.getPoolState(poolAddress);
      },
    },
    {
      name: 'getPoolPosition',
      description: 'Read a deterministic LP position for a pool and owner.',
      capabilityId: 'READ_LP_POSITION',
      inputSchema: z.object({ poolAddress: addressSchema, owner: addressSchema }).strict(),
      async invoke(input) {
        const { poolAddress, owner } = input as { poolAddress: string; owner: string };
        return liquidity.getPoolPosition(poolAddress, owner);
      },
    },
    // READ_YIELD
    {
      name: 'getYieldOpportunities',
      description: 'Read deterministic yield and lending opportunities for a network.',
      capabilityId: 'READ_YIELD',
      inputSchema: z.object({ network: networkSchema }).strict(),
      async invoke(input) {
        const { network } = input as { network: string };
        return { opportunities: await yieldS.getYieldOpportunities(network) };
      },
    },
    // READ_LENDING_POSITION
    {
      name: 'getLendingPosition',
      description: 'Read a deterministic lending position and health factor.',
      capabilityId: 'READ_LENDING_POSITION',
      inputSchema: z.object({ address: addressSchema, protocol: z.string().min(1) }).strict(),
      async invoke(input) {
        const { address, protocol } = input as { address: string; protocol: string };
        return lending.getLendingPosition(address, protocol);
      },
    },
    {
      name: 'getHealthFactor',
      description: 'Read the health factor of a lending position.',
      capabilityId: 'READ_LENDING_POSITION',
      inputSchema: z.object({ address: addressSchema, protocol: z.string().min(1) }).strict(),
      async invoke(input) {
        const { address, protocol } = input as { address: string; protocol: string };
        const pos = await lending.getLendingPosition(address, protocol);
        return { healthFactor: pos.healthFactor, address, protocol };
      },
    },
    // READ_BALANCE / chain sidecar
    {
      name: 'getGasEstimate',
      description: 'Read a deterministic gas estimate for an action.',
      capabilityId: 'READ_BALANCE',
      inputSchema: z.object({ action: z.string().min(1) }).strict(),
      async invoke(input) {
        const { action } = input as { action: string };
        return chain.getGasEstimate({ action });
      },
    },
    {
      name: 'getTransactionStatus',
      description: 'Read the status of an on-chain transaction.',
      capabilityId: 'READ_BALANCE',
      inputSchema: z.object({ hash: z.string().min(1) }).strict(),
      async invoke(input) {
        const { hash } = input as { hash: string };
        return chain.getTransactionStatus(hash);
      },
    },
    // PREFLIGHT: simulateTransaction operates only on a validated ActionProposal.
    // A shared ZodObject from @ban/schemas is not directly assignable to the
    // local zod's ZodTypeAny phantom type, so we cast it once here. The runtime
    // parse is unchanged and still enforces the full proposal schema.
    {
      name: 'simulateTransaction',
      description:
        'Preflight-simulate a validated BAN ActionProposal. Rejects any non-proposal or raw transaction input.',
      capabilityId: 'PROPOSE_SWAP',
      inputSchema: ActionProposalSchema as unknown as z.ZodTypeAny,
      async invoke(input) {
        // Strictly enforce the full proposal schema at runtime — this is the
        // ONLY accepted input shape. Arbitrary AI raw transactions are rejected
        // by parse() before any adapter is reached.
        const parsed = ActionProposalSchema.parse(input);
        const result = await chain.simulateProposal(parsed);
        // Echo the validated proposal id so callers can correlate the preflight
        // to the proposal it simulated. The adapter result itself never leaks
        // private keys or raw calldata.
        return { ...result, proposalId: parsed.proposalId };
      },
    },
  ];
}