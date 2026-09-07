import { ActionProposalSchema, StrategyDecisionSchema } from '@ban/schemas';
import { BANError, ErrorCode } from '@ban/shared';
import { canonicalizeAction } from '@ban/agent-core';
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
export class OpenRouterBrainAdapter {
    apiKey;
    model;
    baseUrl;
    fetch;
    constructor(config = {}) {
        this.apiKey = config.apiKey ?? process.env.OPENROUTER_API_KEY ?? '';
        this.model = config.model ?? 'openai/gpt-4o-mini';
        this.baseUrl = (config.baseUrl ?? OPENROUTER_DEFAULT_BASE).replace(/\/+$/, '');
        this.fetch = config.fetch ?? globalThis.fetch?.bind(globalThis);
    }
    async decide(input) {
        if (!this.apiKey) {
            throw new BANError(ErrorCode.PROVIDER_UNAVAILABLE, 'OpenRouter is not configured: OPENROUTER_API_KEY is missing.', { retryable: true });
        }
        if (!this.fetch) {
            throw new BANError(ErrorCode.PROVIDER_UNAVAILABLE, 'OpenRouter adapter requires a fetch implementation (not available in this runtime).', { retryable: false });
        }
        const system = [
            'You are the reasoning layer of a permissioned autonomous trading agent.',
            'You produce ONLY a strict JSON decision object. You may not invent capabilities, tools, or contracts.',
            'Allowed capabilities for THIS agent: ' + input.capabilities.join(', ') + '.',
            "A proposal's capabilityId MUST be one of the allowed capabilities; otherwise do NOT emit an action.",
            'proposal.action MUST be EXACTLY one of: SWAP, TRANSFER, DEPOSIT, WITHDRAW, STAKE, UNSTAKE, MINT, BURN, APPROVE, REBALANCE, CUSTOM. Never use any other value.',
            'Strategy-specific vocabulary is NOT an action: grid BUY/SELL → action "SWAP" with params.side; lending REPAY/ADD_COLLATERAL → action "DEPOSIT" with params.healthAction; LP REMOVE/CREATE/REPOSITION → actions "BURN"/"MINT"/"REBALANCE". STOP/HOLD/WAIT/NONE are NOT actions — they mean status "PASS" with no proposal.',
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
        let res;
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
        }
        catch (err) {
            throw new BANError(ErrorCode.PROVIDER_UNAVAILABLE, `OpenRouter network error: ${err.message}`, { retryable: true, cause: err });
        }
        if (!res.ok) {
            throw new BANError(ErrorCode.PROVIDER_UNAVAILABLE, `OpenRouter returned HTTP ${res.status}: ${res.statusText}`, { retryable: res.status >= 500 });
        }
        let data;
        try {
            data = await res.json();
        }
        catch {
            throw new BANError(ErrorCode.PROVIDER_UNAVAILABLE, 'OpenRouter returned a non-JSON response.', { retryable: true });
        }
        const content = extractContent(data);
        if (!content) {
            throw new BANError(ErrorCode.POLICY_DENIED, 'OpenRouter returned no text content; failing closed.', { retryable: false });
        }
        // Parse JSON from the model. Strip markdown fences defensively.
        const cleaned = content.trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
        let raw;
        try {
            raw = JSON.parse(cleaned);
        }
        catch {
            throw new BANError(ErrorCode.POLICY_DENIED, 'OpenRouter model returned malformed JSON; failing closed.', { retryable: false });
        }
        const statusRaw = raw.status;
        const proposalRaw = raw.proposal;
        const createdAt = typeof raw.createdAt === 'string' ? raw.createdAt : new Date().toISOString();
        const decisionInput = {
            decisionId: `decision_${Date.now().toString(36)}`,
            agentId: input.agentId,
            strategyId: input.strategyId,
            status: statusRaw === 'ACT' ? 'ACT' : 'PASS',
            reasoning: typeof raw.reasoning === 'string'
                ? raw.reasoning
                : statusRaw === 'ACT'
                    ? 'Agent decision to act.'
                    : 'No action.',
            observations: input.observations,
            createdAt,
        };
        if (statusRaw === 'ACT' && proposalRaw) {
            const normalized = normalizeProposalAction(proposalRaw);
            if (normalized === null) {
                // The model emitted a non-executable directive (STOP/HOLD/WAIT).
                // Honest semantics: that is a decision to NOT trade → PASS, no proposal.
                decisionInput.status = 'PASS';
                decisionInput.reasoning =
                    typeof raw.reasoning === 'string' && raw.reasoning.trim()
                        ? raw.reasoning
                        : 'Strategy directive (STOP/HOLD/WAIT) — no onchain action.';
            }
            else {
                decisionInput.proposal = normalized;
            }
        }
        // Validate strictly. Any decision must satisfy StrategyDecisionSchema.
        const parsed = StrategyDecisionSchema.safeParse(decisionInput);
        if (!parsed.success) {
            throw new BANError(ErrorCode.POLICY_DENIED, `OpenRouter produced an invalid strategy decision; failing closed: ${parsed.error.message}`, { retryable: false });
        }
        // Double-check: if status is ACT the proposal must independently validate.
        if (parsed.data.status === 'ACT' && parsed.data.proposal) {
            const propCheck = ActionProposalSchema.safeParse(parsed.data.proposal);
            if (!propCheck.success) {
                throw new BANError(ErrorCode.POLICY_DENIED, `OpenRouter produced an invalid proposal; failing closed: ${propCheck.error.message}`, { retryable: false });
            }
        }
        return parsed.data;
    }
}
/**
 * Normalize a raw model-authored proposal using the SHARED strategy-vocabulary
 * map (@ban/agent-core): BUY/SELL → SWAP (+ params.side), REPAY/ADD_COLLATERAL
 * → DEPOSIT (+ params.healthAction), REMOVE/CREATE/REPOSITION →
 * BURN/MINT/REBALANCE, and STOP/HOLD/WAIT/NONE → null (caller converts the
 * decision to an honest PASS). Unknown values remain untouched so strict
 * schema validation still fails closed.
 */
export function normalizeProposalAction(proposal) {
    // A proposal without a string action is malformed, not a directive — leave
    // it untouched so strict schema validation fails closed.
    if (typeof proposal.action !== 'string')
        return proposal;
    const { action: canonical, directive } = canonicalizeAction(proposal.action);
    // Non-executable directives are decisions to not trade, not onchain actions.
    if (directive)
        return null;
    const params = {
        ...(proposal.params ?? {}),
    };
    // Preserve the model's raw vocabulary for audit + strategy-side matching.
    const rawAction = proposal.action.trim().toUpperCase();
    if (rawAction && params.requestedAction == null)
        params.requestedAction = rawAction;
    // Trading direction rides along as side (grid executor contract).
    if ((rawAction === 'BUY' || rawAction === 'SELL') && params.side == null) {
        params.side = rawAction;
    }
    return { ...proposal, action: canonical, params };
}
function extractContent(data) {
    if (data && typeof data === 'object') {
        const d = data;
        if (Array.isArray(d.choices) && d.choices.length > 0) {
            const content = d.choices[0]?.message?.content;
            if (typeof content === 'string')
                return content;
        }
    }
    return null;
}
