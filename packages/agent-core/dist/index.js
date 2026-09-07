// ---------------------------------------------------------------------------
// State machines (Milestone 3.5 system state model)
// ---------------------------------------------------------------------------
const AGENT_TRANSITIONS = {
    DRAFT: ['ACTIVE', 'ERROR'],
    ACTIVE: ['PAUSED', 'REVOKED', 'EXPIRED', 'ERROR'],
    PAUSED: ['ACTIVE', 'REVOKED', 'EXPIRED', 'ERROR'],
    REVOKED: [],
    EXPIRED: ['ACTIVE'],
    ERROR: ['ACTIVE', 'PAUSED', 'REVOKED'],
};
const SESSION_TRANSITIONS = {
    PENDING: ['ACTIVE', 'REVOKED', 'EXPIRED'],
    ACTIVE: ['EXPIRING', 'REVOKED', 'EXPIRED'],
    EXPIRING: ['EXPIRED', 'REVOKED'],
    EXPIRED: ['REVOKED'],
    REVOKED: [],
};
const EXECUTION_TRANSITIONS = {
    PROPOSED: ['VALIDATING', 'REJECTED', 'CANCELLED'],
    VALIDATING: ['QUEUED', 'REJECTED', 'FAILED', 'CANCELLED'],
    REJECTED: [],
    QUEUED: ['EXECUTING', 'FAILED', 'CANCELLED'],
    EXECUTING: ['CONFIRMING', 'FAILED'],
    CONFIRMING: ['CONFIRMED', 'FAILED'],
    CONFIRMED: [],
    FAILED: [],
    CANCELLED: [],
};
export function canTransition(current, next, machine) {
    const table = machine === 'agent'
        ? AGENT_TRANSITIONS
        : machine === 'session'
            ? SESSION_TRANSITIONS
            : EXECUTION_TRANSITIONS;
    const allowed = table[current] ?? [];
    return allowed.includes(next);
}
export { canonicalizeAction, toWeiIntegerString, isHexAddress, readObservationCandidates, pickCandidate, normalizeStrategyDecision, CANONICAL_ACTIONS, STRATEGY_ACTION_MAP, } from './canonical-action.js';
