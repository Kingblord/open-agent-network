/**
 * PerformanceCalculator — deterministic, framework-agnostic aggregation of
 * Execution and Position records.
 *
 * All arithmetic uses Number for counts/durations (safe within reasonable
 * batch sizes for operational metrics) and BigInt-safe string construction
 * for wei/gas values.
 *
 * PnL is computed ONLY from valid Position records; returns null when
 * positions are unavailable — never fabricated.
 *
 * Capital managed is computed from OPEN Position records (USD cents): both
 * `agent-wallet` funding buckets (capital deposited by the user and controlled
 * by the agent) and deployed protocol positions. Owner withdrawals and
 * protocol DEPOSIT moves decrement the funding bucket, so the same dollars are
 * never double-counted. The previous "100 cents per confirmed execution"
 * placeholder was fabricated data and has been removed (Rule 7: no fake data
 * in production paths).
 */
import type { Execution, Position } from '@ban/schemas';
import type { ExecutionAggregate, PositionAggregate } from './types.js';
export declare class PerformanceCalculator {
    /**
     * Aggregate execution records into operational metrics.
     * Pure function — no I/O, no side effects.
     */
    aggregateExecutions(executions: Execution[]): ExecutionAggregate;
    /**
     * Aggregate position records into managed-capital and PnL metrics.
     *
     * Capital managed = sum of OPEN positions' currentValueUsd (USD cents),
     * including `agent-wallet` funding buckets — funds deposited to an agent
     * are capital the agent controls even before its first swap.
     *
     * PnL is computed ONLY from deployed protocol positions. `agent-wallet`
     * funding records are capital trackers, NOT PnL-bearing positions, so a
     * funding bucket decremented to 0 (moved into protocols / withdrawn) must
     * never surface as a "realized loss".
     *
     * If no positions are available, PnL fields are null — never fabricated.
     */
    aggregatePositions(positions: Position[]): PositionAggregate;
    /**
     * Combine execution and position aggregates into a single performance summary.
     *
     * `opts.walletCapitalUsd` (optional, decimal USD string) lets callers pass a
     * live on-chain reading of the agent wallet's current capital. When present it
     * wins over the position-based `managedCapitalUsd`, because a user's task
     * funding is capital the agent controls the moment it lands in the wallet —
     * whether or not any execution has happened yet. When absent, position-based
     * capital is used (the fallback used by unit tests and historical data).
     */
    summarize(executions: Execution[], positions: Position[], opts?: {
        walletCapitalUsd?: string | null;
    }): {
        totalTrades: number;
        confirmedCount: number;
        successRate: string;
        totalFeesWei: string;
        avgGasPerTx: string;
        avgExecutionMs: number;
        lastExecutedAt: string | null;
        byStatus: Record<string, number>;
        capitalManagedUsd: string;
        hasPositions: boolean;
        realizedPnlUsd: string | null;
        unrealizedPnlUsd: string | null;
        maxDrawdownUsd: string | null;
    };
}
//# sourceMappingURL=performance-calculator.d.ts.map