import type { Observation, StrategyDecision } from '@ban/schemas';
import type { BrainAdapter } from './brain.js';
/**
 * M7 — OpenRouterBrainAdapter (real inference provider).
 *
 * This is the LIVE provider behind the `BrainAdapter` seam. It calls OpenRouter's
 * OpenAI-compatible `/chat/completions` endpoint and drives the exact same
 * reasoning→strategy-decision contract as `DevBrainAdapter`, but against a real LLM.
 *
 * SAFETY invariants that hold here (same as every brain adapter):
 *   - The brain is the reasoning layer ONLY. It never signs, never executes,
 *     never invokes arbitrary tools — it only emits a strict `StrategyDecision`.
 *   - Any `proposal` returned MUST satisfy `ActionProposalSchema`. If the model
 *     returns a malformed or partial proposal, we FAIL CLOSED
 *     (`ERR_POLICY_DENIED`) rather than forwarding it.
 *   - The decision always carries a server-stamped `createdAt` (the model was
 *     never asked to fabricate timestamps).
 *   - Live calls are gated on `OPENROUTER_API_KEY`; when absent the adapter
 *     throws `ERR_PROVIDER_UNAVAILABLE`.
 *
 * Because this path issues real network inference it is intentionally NOT used in
 * hermetic unit tests (those use `DevBrainAdapter`). It is exercised in deployment.
 */
export declare const OPENROUTER_DEFAULT_BASE = "https://openrouter.ai/api/v1";
export interface OpenRouterBrainConfig {
    /** OpenRouter API key. Read from `OPENROUTER_API_KEY` unless overridden. */
    apiKey?: string;
    /** Optional model id. Defaults to a capable, low-cost default. */
    model?: string;
    /** Optional base URL override (used by tests / self-hosted mirrors). */
    baseUrl?: string;
    /** Optional fetch override for hermetic / test injection. */
    fetch?: typeof globalThis.fetch;
}
export declare class OpenRouterBrainAdapter implements BrainAdapter {
    private readonly apiKey;
    private readonly model;
    private readonly baseUrl;
    private readonly fetch;
    constructor(config?: OpenRouterBrainConfig);
    decide(input: {
        agentId: string;
        strategyId?: string;
        observations: Observation[];
        capabilities: string[];
    }): Promise<StrategyDecision>;
}
/** Normalize a model-authored riskLevel to the exact schema enum (or strip it so the strategy falls back to its own rank). */
export declare function normalizeRiskLevel(value: unknown): unknown;
/**
 * Normalize a raw model-authored proposal using the SHARED strategy-vocabulary
 * map (@ban/agent-core): BUY/SELL → SWAP (+ params.side), REPAY/ADD_COLLATERAL
 * → DEPOSIT (+ params.healthAction), REMOVE/CREATE/REPOSITION →
 * BURN/MINT/REBALANCE, and STOP/HOLD/WAIT/NONE → null (caller converts the
 * decision to an honest PASS). Also normalizes sloppy riskLevel spellings —
 * the #1 cause of model-valid decisions hard-failing as ERR_POLICY_DENIED.
 * Unknown values remain untouched so strict schema validation still fails
 * closed.
 */
export declare function normalizeProposalAction(proposal: Record<string, unknown>): Record<string, unknown> | null;
//# sourceMappingURL=openrouter-brain.d.ts.map