import { HealthFactorCalculator } from './health-factor-calculator.js';
import type { HealthSnapshot, HealthCandidate } from './types.js';
export declare class HealthCandidateSelector {
    private readonly calculator;
    constructor(calculator?: HealthFactorCalculator);
    select(snapshot: HealthSnapshot): HealthCandidate[];
}
//# sourceMappingURL=health-candidate-selector.d.ts.map