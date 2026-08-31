import 'server-only';

import type { BrainAdapter } from '@ban/ai';
import type { Observation, StrategyDecision } from '@ban/schemas';

/**
 * BAN Agent Runtime — capturing brain wrapper.
 *
 * The strategies call `brain.decide(...)` then swallow the decision (they only
 * re-validate and return the proposal). For the review terminal the loop must
 * SHOW the AI's actual reasoning before it proposes an action. This wrapper
 * wraps ANY BrainAdapter and:
 *   - passes the call through unchanged (exact same reasoning contract),
 *   - captures the real StrategyDecision (status / reasoning / decisionId /
 *     deniedReason) and invokes `onDecision` AFTER the call succeeds (and
 *     NEVER on a thrown error — a thrown brain call is not a decision).
 *
 * It never modifies the decision, never signs, never executes. It purely adds
 * observability on the existing seam.
 */

export interface BrainCaptureCallbacks {
  /** Invoked with the REAL decision produced by the wrapped brain. */
  onDecision?: (decision: StrategyDecision) => void;
}

export class BrainCaptureAdapter implements BrainAdapter {
  private readonly inner: BrainAdapter;
  private readonly onDecision?: (decision: StrategyDecision) => void;

  constructor(inner: BrainAdapter, callbacks: BrainCaptureCallbacks = {}) {
    this.inner = inner;
    this.onDecision = callbacks.onDecision;
  }

  async decide(input: {
    agentId: string;
    strategyId?: string;
    observations: Observation[];
    capabilities: string[];
  }): Promise<StrategyDecision> {
    const decision = await this.inner.decide(input);
    if (this.onDecision) {
      try {
        this.onDecision(decision);
      } catch {
        // Observability must never break the loop; the decision already
        // happened and is valid.
      }
    }
    return decision;
  }
}

export function isBrainCaptureAdapter(brain: BrainAdapter): brain is BrainCaptureAdapter {
  return brain instanceof BrainCaptureAdapter;
}

export function hasOpenRouterConfigured(): boolean {
  return Boolean(process.env.OPENROUTER_API_KEY);
}