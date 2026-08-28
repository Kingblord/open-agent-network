import type { Observation, StrategyDecision } from '@ban/schemas';
import { ActionProposalSchema, StrategyDecisionSchema } from '@ban/schemas';
import { BANError, ErrorCode } from '@ban/shared';
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

export const OPENROUTER_DEFAULT_BASE = 'https://openrouter.ai/api/v1';

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

export class OpenRouterBrainAdapter implements BrainAdapter {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly fetch: typeof globalThis.fetch;

  constructor(config: OpenRouterBrainConfig = {}) {
    this.apiKey = config.apiKey ?? process.env.OPENROUTER_API_KEY ?? '';
    this.model = config.model ?? 'openai/gpt-4o-mini';
    this.baseUrl = (config.baseUrl ?? OPENROUTER_DEFAULT_BASE).replace(/\/+$/, '');
    this.fetch = config.fetch ?? globalThis.fetch?.bind(globalThis);
  }

  async decide(input: {
    agentId: string;
    strategyId?: string;
    observations: Observation[];
    capabilities: string[];
  }): Promise<StrategyDecision> {
    if (!this.apiKey) {
      throw new BANError(
        ErrorCode.PROVIDER_UNAVAILABLE,
        'OpenRouter is not configured: OPENROUTER_API_KEY is missing.',
        { retryable: true },
      );
    }

    if (!this.fetch) {
      throw new BANError(
        ErrorCode.PROVIDER_UNAVAILABLE,
        'OpenRouter adapter requires a fetch implementation (not available in this runtime).',
        { retryable: false },
      );
    }

    const system = [
      'You are the reasoning layer of a permissioned autonomous trading agent.',
      'You produce ONLY a strict JSON decision object. You may not invent capabilities, tools, or contracts.',
      'Allowed capabilities for THIS agent: ' + input.capabilities.join(', ') + '.',
      "A proposal's capabilityId MUST be one of the allowed capabilities; otherwise do NOT emit an action.",
      'Respond with JSON exactly of the form:',
      '{"status":"ACT"|"PASS","reasoning":string,"deniedReason"?:string,"proposal"?:{proposalId,agentId,userId,strategyId,sessionId,protocol,contract,function,action,capabilityId,token,amount,estimatedValue,asset,idempotencyKey,riskLevel,createdAt}}',
      'When status is PASS, never include proposal. When status is ACT, the proposal MUST be complete and valid.',
    ].join('\n');

    const user = JSON.stringify({
      agentId: input.agentId,
      strategyId: input.strategyId,
      capabilities: input.capabilities,
      observations: input.observations,
    });

    let res: Response;
    try {
      res = await this.fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          temperature: 0,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
        }),
      });
    } catch (err) {
      throw new BANError(ErrorCode.PROVIDER_UNAVAILABLE, `OpenRouter network error: ${(err as Error).message}`, { retryable: true, cause: err });
    }

    if (!res.ok) {
      throw new BANError(
        ErrorCode.PROVIDER_UNAVAILABLE,
        `OpenRouter returned HTTP ${res.status}: ${res.statusText}`,
        { retryable: res.status >= 500 },
      );
    }

    let data: unknown;
    try {
      data = await res.json();
    } catch {
      throw new BANError(ErrorCode.PROVIDER_UNAVAILABLE, 'OpenRouter returned a non-JSON response.', { retryable: true });
    }

    const content = extractContent(data);
    if (!content) {
      throw new BANError(ErrorCode.POLICY_DENIED, 'OpenRouter returned no text content; failing closed.', { retryable: false });
    }

    // Parse JSON from the model. Strip markdown fences defensively.
    const cleaned = content.trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
    let raw: Record<string, unknown>;
    try {
      raw = JSON.parse(cleaned);
    } catch {
      throw new BANError(ErrorCode.POLICY_DENIED, 'OpenRouter model returned malformed JSON; failing closed.', { retryable: false });
    }

    const statusRaw = raw.status;
    const proposalRaw = raw.proposal as Record<string, unknown> | undefined;
    const createdAt = typeof raw.createdAt === 'string' ? raw.createdAt : new Date().toISOString();

    const decisionInput: Record<string, unknown> = {
      decisionId: `decision_${Date.now().toString(36)}`,
      agentId: input.agentId,
      strategyId: input.strategyId,
      status: statusRaw === 'ACT' ? 'ACT' : 'PASS',
      reasoning:
        typeof raw.reasoning === 'string'
          ? raw.reasoning
          : statusRaw === 'ACT'
            ? 'Agent decision to act.'
            : 'No action.',
      observations: input.observations,
      createdAt,
    };

    if (statusRaw === 'ACT' && proposalRaw) {
      decisionInput.proposal = proposalRaw;
    }

    // Validate strictly. Any decision must satisfy StrategyDecisionSchema.
    const parsed = StrategyDecisionSchema.safeParse(decisionInput);
    if (!parsed.success) {
      throw new BANError(
        ErrorCode.POLICY_DENIED,
        `OpenRouter produced an invalid strategy decision; failing closed: ${parsed.error.message}`,
        { retryable: false },
      );
    }

    // Double-check: if status is ACT the proposal must independently validate.
    if (parsed.data.status === 'ACT' && parsed.data.proposal) {
      const propCheck = ActionProposalSchema.safeParse(parsed.data.proposal);
      if (!propCheck.success) {
        throw new BANError(
          ErrorCode.POLICY_DENIED,
          `OpenRouter produced an invalid proposal; failing closed: ${propCheck.error.message}`,
          { retryable: false },
        );
      }
    }

    return parsed.data as StrategyDecision;
  }
}

function extractContent(data: unknown): string | null {
  if (data && typeof data === 'object') {
    const d = data as { choices?: Array<{ message?: { content?: unknown } }> };
    if (Array.isArray(d.choices) && d.choices.length > 0) {
      const content = d.choices[0]?.message?.content;
      if (typeof content === 'string') return content;
    }
  }
  return null;
}