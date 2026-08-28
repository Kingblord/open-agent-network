export class GridRiskModel {
    assess(factors) {
        // Fail-closed: no volatility data → HIGH
        if (!factors.volatilityAvailable) {
            return { level: 'HIGH', adjustmentCents: '500' };
        }
        // High exposure + high volatility → HIGH
        if (factors.exposureRatioBps > 8000 && factors.volatilityBps > 500) {
            return { level: 'HIGH', adjustmentCents: '200' };
        }
        // Close to stop boundary → HIGH
        if (factors.distanceToStopCents < 1000) {
            return { level: 'HIGH', adjustmentCents: '100' };
        }
        // Moderate exposure or volatility → MEDIUM
        if (factors.exposureRatioBps > 5000 || factors.volatilityBps > 200) {
            return { level: 'MEDIUM', adjustmentCents: '50' };
        }
        return { level: 'LOW', adjustmentCents: '0' };
    }
}
//# sourceMappingURL=grid-risk-model.js.map