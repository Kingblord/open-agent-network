/**
 * Erc8004Registry — BAN discovery/trust surface (ERC-8004-aligned).
 *
 * ERC-8004 (Agent Discovery & Reputation) standardizes how agents publish
 * identity + capability + reputation records for discovery. This module is the
 * BAN-owned seam:
 *
 *   - REGISTERS our BAN-native agents as first-class listings (the four
 *     hackathon agents: yield, health, lp, grid) so the marketplace sees them
 *     through the ERC-8004 lens too (mustflow discovery §3, update-v3 §4).
 *   - NORMALIZES external ERC-8004 records into the same `Erc8004AgentListing`
 *     shape (fail-open for discovery: unknown external records are listed but
 *     flagged `verified: false` + reputation null — never fabricated).
 *   - NEVER asserts reputation we don't have: `reputation` is `null` unless a
 *     real on-chain/verified source exists. Ratings on the marketplace are
 *     derived from real activity only.
 *
 * Fail-closed rule that DOES apply: a listing's `capabilities`/`protocols`
 * are only trusted for execution when the agent is additionally present in the
 * authoritative BAN agent registry (packages/registry + agent-registry.ts).
 * Discovery ≠ execution authorization.
 *
 * This module is runtime-safe to import (no network I/O, no Next/Firebase dep).
 */
/** BAN-native agents registered as ERC-8004 listings (the four hackathon agents). */
const BAN_NATIVE_CATALOG = [
    {
        id: 'ban-yield-optimizer',
        name: 'BAN Yield Optimizer',
        description: 'Autonomous yield optimization on BNB Smart Chain (real APY, no fabrication).',
        type: 'ban-native',
        strategyId: 'yield',
        capabilities: ['READ_YIELD', 'READ_PRICE', 'READ_BALANCE', 'PROPOSE_LENDING_ACTION', 'PROPOSE_SWAP'],
        protocols: ['pancakeswap', 'venus'],
        riskLevel: 'LOW',
        status: 'REGISTERED',
        source: 'BAN_NATIVE',
        registry: { verified: true },
        reputation: null,
    },
    {
        id: 'ban-health-guard',
        name: 'BAN Health Guard',
        description: 'Monitors lending health factor and auto-de-risks positions within policy bounds.',
        type: 'ban-native',
        strategyId: 'health',
        capabilities: ['READ_LENDING_POSITION', 'READ_PRICE', 'PROPOSE_LENDING_ACTION'],
        protocols: ['venus'],
        riskLevel: 'LOW',
        status: 'REGISTERED',
        source: 'BAN_NATIVE',
        registry: { verified: true },
        reputation: null,
    },
    {
        id: 'ban-lp-rebalancer',
        name: 'BAN LP Rebalancer',
        description: 'Rebalances LP positions (PancakeSwap) to keep composition within configured bounds.',
        type: 'ban-native',
        strategyId: 'lp',
        capabilities: ['READ_LP_POSITION', 'READ_PRICE', 'PROPOSE_LP_REBALANCE', 'PROPOSE_SWAP'],
        protocols: ['pancakeswap'],
        riskLevel: 'MEDIUM',
        status: 'REGISTERED',
        source: 'BAN_NATIVE',
        registry: { verified: true },
        reputation: null,
    },
    {
        id: 'ban-grid-trader',
        name: 'BAN Grid Trader',
        description: 'Parametric grid trading bot with strict per-transaction and cumulative spend caps.',
        type: 'ban-native',
        strategyId: 'grid',
        capabilities: ['READ_PRICE', 'READ_BALANCE', 'PROPOSE_GRID_ORDER', 'PROPOSE_SWAP'],
        protocols: ['pancakeswap'],
        riskLevel: 'HIGH',
        status: 'REGISTERED',
        source: 'BAN_NATIVE',
        registry: { verified: true },
        reputation: null,
    },
];
function asString(v, fallback = '') {
    if (typeof v === 'string')
        return v;
    if (typeof v === 'number' || typeof v === 'bigint')
        return String(v);
    return fallback;
}
function asStrings(v) {
    if (Array.isArray(v))
        return v.map((x) => asString(x)).filter(Boolean);
    if (typeof v === 'string' && v.trim())
        return [v];
    return [];
}
/** Normalize an external ERC-8004 record into our listing shape (fail-open, reputation-neutral). */
export function normalizeExternalErc8004Record(record, fallbackIndex = 0) {
    const id = asString(record.agentId, asString(record.id, `external-agent-${fallbackIndex}`));
    const riskRaw = asString(record.riskLevel, 'UNKNOWN').toUpperCase();
    const riskLevel = riskRaw === 'LOW' || riskRaw === 'MEDIUM' || riskRaw === 'HIGH' ? riskRaw : 'MEDIUM';
    const hasReputation = record.reputationScore !== undefined && record.reputationScore !== null && asString(record.reputationScore, '') !== '';
    return {
        id,
        name: asString(record.name, `External Agent ${fallbackIndex + 1}`),
        description: asString(record.description, undefined) || undefined,
        type: asString(record.type, 'external'),
        strategyId: asString(record.strategyId) || undefined,
        capabilities: asStrings(record.capabilities),
        protocols: asStrings(record.protocols),
        riskLevel,
        status: 'REGISTERED',
        source: 'EXTERNAL',
        registry: {
            registryAddress: asString(record.registryAddress) || undefined,
            tokenId: asString(record.tokenId) || undefined,
            metadataUri: asString(record.metadataUri) || undefined,
            // Not fully verified until we actually validate on-chain (no silent claims).
            verified: false,
        },
        // Never synthesize reputation: null unless a real score+source was provided.
        reputation: hasReputation
            ? { score: asString(record.reputationScore), source: asString(record.reputationSource) || 'external', verified: false }
            : null,
        createdAt: new Date().toISOString(),
    };
}
export class Erc8004Registry {
    byId = new Map();
    constructor(listings = []) {
        // Seed with the BAN-native catalog first, then any provided listings.
        for (const listing of [...BAN_NATIVE_CATALOG, ...listings]) {
            this.register(listing);
        }
    }
    register(listing) {
        const key = listing.id.toLowerCase();
        const existing = this.byId.get(key);
        // BAN-native listings are authoritative: external records may NEVER
        // overwrite a native listing with the same id (spoof protection).
        if (existing && existing.source === 'BAN_NATIVE' && listing.source !== 'BAN_NATIVE')
            return;
        this.byId.set(key, listing);
    }
    getById(id) {
        return this.byId.get(id.toLowerCase()) ?? null;
    }
    /** BAN-native listings only. */
    listNative() {
        return [...this.byId.values()].filter((l) => l.source === 'BAN_NATIVE');
    }
    /** External listings only (for marketlace merge — avoids double-counting our own). */
    listExternal() {
        return [...this.byId.values()].filter((l) => l.source === 'EXTERNAL');
    }
    listAll() {
        return [...this.byId.values()];
    }
    /** Convenience for external feeds: normalize + register in one call. */
    ingestExternal(records) {
        return records.map((r, i) => {
            const listing = normalizeExternalErc8004Record(r, i);
            this.register(listing);
            return listing;
        });
    }
}
/** Process-wide default regstry (seeded with the four BAN-native agents). Framework-agnostic. */
export const erc8004Registry = new Erc8004Registry();
