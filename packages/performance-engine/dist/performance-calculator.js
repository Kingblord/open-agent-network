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
export class PerformanceCalculator {
    /**
     * Aggregate execution records into operational metrics.
     * Pure function — no I/O, no side effects.
     */
    aggregateExecutions(executions) {
        if (!executions || executions.length === 0) {
            return {
                totalTrades: 0,
                confirmedCount: 0,
                failedCount: 0,
                successRate: '0',
                totalFeesWei: '0',
                avgGasPerTx: '0',
                avgExecutionMs: 0,
                lastExecutedAt: null,
                byStatus: {},
                capitalManagedUsd: '0',
            };
        }
        const byStatus = {};
        let confirmedCount = 0;
        let failedCount = 0;
        let totalGasWei = 0;
        let gasTxCount = 0;
        let totalDurationMs = 0;
        let durationCount = 0;
        let lastExecutedAt = null;
        for (const exec of executions) {
            const status = exec.status ?? 'UNKNOWN';
            byStatus[status] = (byStatus[status] ?? 0) + 1;
            if (status === 'CONFIRMED')
                confirmedCount++;
            if (status === 'FAILED')
                failedCount++;
            if (exec.createdAt && (!lastExecutedAt || exec.createdAt > lastExecutedAt)) {
                lastExecutedAt = exec.createdAt;
            }
            // Gas aggregation (wei string → Number for dashboard-scale)
            if (exec.gasUsed) {
                const parsed = Number(exec.gasUsed);
                if (!isNaN(parsed) && parsed > 0) {
                    totalGasWei += parsed;
                    gasTxCount++;
                }
            }
            // Average execution duration (confirmedAt - createdAt in ms)
            if (exec.status === 'CONFIRMED' && exec.confirmedAt && exec.createdAt) {
                const start = new Date(exec.createdAt).getTime();
                const end = new Date(exec.confirmedAt).getTime();
                if (!isNaN(start) && !isNaN(end) && end >= start) {
                    totalDurationMs += (end - start);
                    durationCount++;
                }
            }
            // Capital managed is NOT derived from executions — it comes from open
            // Position records (see aggregatePositions). Executions only carry
            // operational metrics. (The previous 100-cents-per-confirmed-exec
            // placeholder was fabricated data and is removed.)
        }
        const totalTrades = confirmedCount;
        const denominator = confirmedCount + failedCount;
        const successRate = denominator > 0
            ? (confirmedCount / denominator).toFixed(4)
            : '0';
        const avgGasPerTx = gasTxCount > 0
            ? (totalGasWei / gasTxCount).toFixed(0)
            : '0';
        const avgExecutionMs = durationCount > 0
            ? Math.round(totalDurationMs / durationCount)
            : 0;
        return {
            totalTrades,
            confirmedCount,
            failedCount,
            successRate,
            totalFeesWei: totalGasWei.toString(),
            avgGasPerTx,
            avgExecutionMs,
            lastExecutedAt,
            byStatus,
            // Superseded by position-based capital in summarize(); kept on the
            // interface for compatibility and reported as 0 without positions.
            capitalManagedUsd: '0',
        };
    }
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
    aggregatePositions(positions) {
        if (!positions || positions.length === 0) {
            return {
                hasPositions: false,
                managedCapitalUsd: '0',
                realizedPnlUsd: null,
                unrealizedPnlUsd: null,
                maxDrawdownUsd: null,
            };
        }
        let managedCapital = 0;
        let realizedPnl = 0;
        let unrealizedPnl = 0;
        let maxDrawdown = 0;
        for (const pos of positions) {
            const entry = Number(pos.entryValueUsd || '0');
            const current = Number(pos.currentValueUsd || '0');
            if (isNaN(entry) || isNaN(current))
                continue;
            // Managed capital: every OPEN position (wallet funding buckets AND
            // deployed protocol positions) is capital the agent controls.
            if (current > 0)
                managedCapital += current;
            // `agent-wallet` funding records are capital trackers, not PnL-bearing
            // positions — skip them in the PnL math so a funded bucket moved into
            // protocols (current → 0) never registers as a realized loss.
            if (pos.protocol === 'agent-wallet')
                continue;
            // A closed position (current === 0) contributes to realized PnL
            if (current === 0) {
                realizedPnl += (entry * -1); // loss of entry value if closed at 0
            }
            else {
                unrealizedPnl += (current - entry);
            }
            // Track max drawdown: negative PnL
            const pnl = current - entry;
            if (pnl < 0 && Math.abs(pnl) > maxDrawdown) {
                maxDrawdown = Math.abs(pnl);
            }
        }
        return {
            hasPositions: true,
            managedCapitalUsd: managedCapital.toFixed(0),
            realizedPnlUsd: realizedPnl.toFixed(2),
            unrealizedPnlUsd: unrealizedPnl.toFixed(2),
            maxDrawdownUsd: maxDrawdown.toFixed(2),
        };
    }
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
    summarize(executions, positions, opts) {
        const execAgg = this.aggregateExecutions(executions);
        const posAgg = this.aggregatePositions(positions);
        // Prefer LIVE on-chain wallet capital (USD dollars) when the caller passed
        // a positive reading; otherwise fall back to open position values (cents).
        const walletCapitalUsd = opts?.walletCapitalUsd != null && Number(opts.walletCapitalUsd) > 0
            ? opts.walletCapitalUsd
            : undefined;
        return {
            totalTrades: execAgg.totalTrades,
            confirmedCount: execAgg.confirmedCount,
            successRate: execAgg.successRate,
            totalFeesWei: execAgg.totalFeesWei,
            avgGasPerTx: execAgg.avgGasPerTx,
            avgExecutionMs: execAgg.avgExecutionMs,
            lastExecutedAt: execAgg.lastExecutedAt,
            byStatus: execAgg.byStatus,
            // Realtime wallet capital when known; else open position values (cents).
            capitalManagedUsd: walletCapitalUsd ?? posAgg.managedCapitalUsd,
            hasPositions: posAgg.hasPositions,
            realizedPnlUsd: posAgg.realizedPnlUsd,
            unrealizedPnlUsd: posAgg.unrealizedPnlUsd,
            maxDrawdownUsd: posAgg.maxDrawdownUsd,
        };
    }
}
