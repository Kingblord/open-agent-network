import type { Observation, StrategyDecision } from '@ban/schemas';
/**
 * M7 — BrainAdapter interface (framework-agnostic).
 *
 * The AI is the reasoning layer ONLY. A BrainAdapter consumes structured
 * observations and returns a strict `StrategyDecision` that downstream re-validates.
 * Adapters never sign, never execute, never invent tools — they only reason and
 * emit proposals constrained to the agent's capability set.
 *
 * Implementations:
 *   - OpenRouterBrainAdapter  — real HTTP inference via OpenRouter's OpenAI-compatible
 *       chat/completions API. Live calls are gated on OPENROUTER_API_KEY.
 *   - DevBrainAdapter         — deterministic, hermetic provider (Rule 7) used by tests
 *       and dev so nothing on the reasoning path requires network/keys.
 */
export interface BrainAdapter {
    /** Reason over a set of structured observations and produce a strict decision. */
    decide(input: {
        agentId: string;
        strategyId?: string;
        observations: Observation[];
        capabilities: string[];
    }): Promise<StrategyDecision>;
}
//# sourceMappingURL=brain.d.ts.map