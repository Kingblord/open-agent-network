/**
 * ModeClassifier — determines LIVE / TESTNET / SIMULATED label
 * from an agent's execution records.
 *
 * Deterministic rules:
 *   - chainId === 56 (BSC mainnet) AND confirmedCount > 0 → LIVE
 *   - chainId === 97 (BSC testnet) OR any confirmed execution → TESTNET
 *   - no confirmed executions → SIMULATED
 *
 * Never fabricates a live mode. Unknown chainId defaults to TESTNET.
 */
export function classifyExecutionMode(chainId, confirmedCount) {
    if (!chainId) {
        return {
            mode: confirmedCount > 0 ? 'TESTNET' : 'SIMULATED',
            reason: confirmedCount > 0
                ? 'TESTNET — executions found but no chainId, defaulting to TESTNET'
                : 'SIMULATED — no executions recorded',
        };
    }
    if (chainId === 56 && confirmedCount > 0) {
        return {
            mode: 'LIVE',
            reason: `LIVE — confirmed ${confirmedCount} execution(s) on BSC mainnet (chainId ${chainId})`,
        };
    }
    if (chainId === 97 || confirmedCount > 0) {
        return {
            mode: 'TESTNET',
            reason: `TESTNET — executed on chain ${chainId} with ${confirmedCount} confirmed`,
        };
    }
    return {
        mode: 'SIMULATED',
        reason: `SIMULATED — no confirmed executions on chain ${chainId}`,
    };
}
