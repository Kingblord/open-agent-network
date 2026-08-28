import type { Observation, StrategyDecision } from '@ban/schemas';
import { ActionProposalSchema } from '@ban/schemas';
import { BANError, ErrorCode } from '@ban/shared';
import type { BrainAdapter } from './brain.js';

/**
 * M7 — Deterministic DevBrainAdapter (Rule 7: explicit dev/test provider).
 *
 * Drives the SAME reasoning→decision path a live LLM would, but with a
 * deterministic, in-process policy so tests are hermetic and reproducible.
 * It does NOT claim to be intelligent; it proves the contract:
 *   - consumes structured observations,
 *   - can emit a strict, schema-valid `ACT` proposal when prompted (only when
 *     a valid action is requested and the agent holds the capability),
 *   - otherwise falls back to `PASS` with a reason (fail-closed).
 *
 * The REASONING is trivial and deterministic; the important, testable invariant
 * is that ANY decision it returns satisfies `StrategyDecisionSchema` and any
 * `proposal` satisfies `ActionProposalSchema`.
 */
export interface DevBrainConfig {
  /** When set, decide() emits an ACT proposal for this capability. */
  actCapability?: string;
  /** When set, decide() ALWAYS fails closed with PASS + this deniedReason. */
  alwaysDenyReason?: string;
}

export class DevBrainAdapter implements BrainAdapter {
  private readonly config: DevBrainConfig;

  constructor(config: DevBrainConfig = {}) {
    this.config = config;
  }

  async decide(input: {
    agentId: string;
    strategyId?: string;
    observations: Observation[];
    capabilities: string[];
  }): Promise<StrategyDecision> {
    const decisionId = `decision_dev_${input.agentId}_${Date.now()}`;

    if (this.config.alwaysDenyReason) {
      return {
        decisionId,
        agentId: input.agentId,
        strategyId: input.strategyId,
        status: 'PASS',
        observations: input.observations,
        deniedReason: this.config.alwaysDenyReason,
        reasoning: 'Deterministic deny (alwaysDenyReason configured).',
        createdAt: new Date().toISOString(),
      };
    }

    // Emit a valid ACT proposal when asked AND the capability is actually granted.
    if (this.config.actCapability && input.capabilities.includes(this.config.actCapability)) {
      const proposal = {
        proposalId: `prop_${input.agentId}_${Date.now()}`,
        agentId: input.agentId,
        userId: 'dev-user',
        strategyId: input.strategyId,
        sessionId: 'dev-session',
        protocol: 'pancake',
        contract: '0xdevcontract',
        function: 'swap',
        action: 'SWAP',
        capabilityId: this.config.actCapability,
        token: 'BNB',
        amount: '1000000000000000000', // 1 BNB in wei
        estimatedValue: '1000000000000000000',
        asset: 'BNB',
        idempotencyKey: `ik_${input.agentId}_${Date.now()}`,
        riskLevel: 'LOW',
        createdAt: new Date().toISOString(),
      };

      const parsed = ActionProposalSchema.safeParse(proposal);
      if (!parsed.success) {
        throw new BANError(ErrorCode.INTERNAL, `DevBrain produced invalid proposal: ${parsed.error.message}`, { retryable: false });
      }

      return {
        decisionId,
        agentId: input.agentId,
        strategyId: input.strategyId,
        status: 'ACT',
        proposal: parsed.data,
        observations: input.observations,
        reasoning: 'Deterministic ACT from configured capability.',
        createdAt: new Date().toISOString(),
      };
    }

    return {
      decisionId,
      agentId: input.agentId,
      strategyId: input.strategyId,
      status: 'PASS',
      observations: input.observations,
      reasoning: 'No configured act capability; deterministic PASS (fail-closed).',
      createdAt: new Date().toISOString(),
    };
  }
}