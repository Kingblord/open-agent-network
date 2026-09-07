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
    successRate: string;
    totalFeesWei: string;
    avgGasPerTx: string;
    avgExecutionMs: number;
    lastExecutedAt: string | null;
    byStatus: Record<string, number>;
    capitalManagedUsd: string;
}
/** Aggregate metrics derived from Position records. */
export interface PositionAggregate {
    hasPositions: boolean;
    /**
     * Total USD cents of OPEN positions (currentValueUsd > 0) — both
     * agent-wallet funding buckets and deployed protocol positions. This is the
     * honest capital-managed figure: funded-but-idle capital counts, because the
     * agent controls it.
     */
    managedCapitalUsd: string;
    realizedPnlUsd: string | null;
    unrealizedPnlUsd: string | null;
    maxDrawdownUsd: string | null;
}
/** Execution filter options. */
export interface ExecutionFilter {
    agentId?: string;
    status?: string;
    since?: string;
}
export type { Execution, Position };
//# sourceMappingURL=types.d.ts.map