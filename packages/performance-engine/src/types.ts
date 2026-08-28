/**
 * Performance-engine internal types.
 *
 * These mirror the canonical PerformanceSchema / ExecutionSchema / PositionSchema
 * from @ban/schemas but are kept here for framework-agnostic deterministic computation
 * — the calculator never depends on Next.js, Firestore, or any external service.
 */

import type { Execution, Position } from '@ban/schemas';

/** Aggregate metrics derived from a set of Execution records. */
export interface ExecutionAggregate {
  totalTrades: number;
  confirmedCount: number;
  failedCount: number;
  successRate: string;          // decimal string 0-1, e.g. "0.8500"
  totalFeesWei: string;         // wei decimal string
  avgGasPerTx: string;          // wei decimal string
  avgExecutionMs: number;       // milliseconds (confirmedAt - createdAt)
  lastExecutedAt: string | null;
  byStatus: Record<string, number>;
  capitalManagedUsd: string;    // sum of execution values in USD cents (estimate)
}

/** Aggregate metrics derived from Position records. */
export interface PositionAggregate {
  hasPositions: boolean;
  realizedPnlUsd: string | null;
  unrealizedPnlUsd: string | null;
  maxDrawdownUsd: string | null;
}

/** Execution filter options. */
export interface ExecutionFilter {
  agentId?: string;
  status?: string;
  since?: string; // ISO date
}

export type { Execution, Position };