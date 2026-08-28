/**
 * @ban/performance-engine — Deterministic, framework-agnostic performance
 * aggregation and mode classification for BAN agents.
 *
 * This package provides:
 *   - PerformanceCalculator — aggregate Execution/Position records into
 *     operational metrics (counts, success rate, fees, gas, duration, PnL).
 *   - ModeClassifier — deterministic LIVE / TESTNET / SIMULATED label.
 *
 * All computation is pure/stateless. No I/O, no Next.js, no Firestore, no
 * Inngest, no external services. Depends only on @ban/schemas and @ban/shared.
 */
export { PerformanceCalculator } from './performance-calculator.js';
export { classifyExecutionMode } from './mode-classifier.js';
export type { ExecutionMode, ModeClassificationResult } from './mode-classifier.js';
export type { ExecutionAggregate, PositionAggregate, ExecutionFilter } from './types.js';
//# sourceMappingURL=index.d.ts.map