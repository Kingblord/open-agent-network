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
 * Capital managed is a conservative estimate (sum of proposal estimatedValue
 * from executions that the policy approved). In the live loop (M18) this
 * should be replaced with onchain position data.
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
     * Aggregate position records into PnL metrics.
     *
     * PnL is computed ONLY from valid Position records.
     * If no positions are available, returns null for realized/unrealized PnL
     * and max drawdown — never fabricated.
     */
    aggregatePositions(positions: Position[]): PositionAggregate;
    /**
     * Combine execution and position aggregates into a single performance summary.
     */
    summarize(executions: Execution[], positions: Position[]): {
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