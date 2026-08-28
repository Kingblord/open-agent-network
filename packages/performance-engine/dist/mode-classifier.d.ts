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
export type ExecutionMode = 'LIVE' | 'TESTNET' | 'SIMULATED';
export interface ModeClassificationResult {
    mode: ExecutionMode;
    reason: string;
}
export declare function classifyExecutionMode(chainId: number | null | undefined, confirmedCount: number): ModeClassificationResult;
//# sourceMappingURL=mode-classifier.d.ts.map