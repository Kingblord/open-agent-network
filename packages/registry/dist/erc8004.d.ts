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
export type Erc8004ListingSource = 'BAN_NATIVE' | 'EXTERNAL';
export type Erc8004ListingStatus = 'REGISTERED' | 'DEPRECATED';
export interface Erc8004AgentListing {
    /** Local listing id. For BAN_NATIVE, equals the BAN agent id (e.g. "ban-yield-optimizer"). */
    id: string;
    name: string;
    description?: string;
    type: string;
    strategyId?: string;
    capabilities: string[];
    protocols: string[];
    riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
    status: Erc8004ListingStatus;
    source: Erc8004ListingSource;
    /** ERC-8004 on-chain / registry metadata (may be partial for EXTERNAL). */
    registry?: {
        /** Registry contract address if published on-chain (else undefined). */
        registryAddress?: string;
        /** ERC-8004 identity tokenId if published as an NFT identity. */
        tokenId?: string;
        /** Metadata URI if the record references one. */
        metadataUri?: string;
        /** Known/verified record, vs synthesized from an unverified feed. */
        verified: boolean;
    };
    /** Reputation is null unless we have a REAL verified source. Never synthetic. */
    reputation: {
        score?: string;
        source?: string;
        verified: boolean;
    } | null;
    createdAt?: string;
}
/** Loose shape of an external ERC-8004 discovery record we can normalize. */
export interface ExternalErc8004Record {
    id?: unknown;
    agentId?: unknown;
    name?: unknown;
    description?: unknown;
    type?: unknown;
    strategyId?: unknown;
    capabilities?: unknown;
    protocols?: unknown;
    riskLevel?: unknown;
    registryAddress?: unknown;
    tokenId?: unknown;
    metadataUri?: unknown;
    reputationScore?: unknown;
    reputationSource?: unknown;
}
/** Normalize an external ERC-8004 record into our listing shape (fail-open, reputation-neutral). */
export declare function normalizeExternalErc8004Record(record: ExternalErc8004Record, fallbackIndex?: number): Erc8004AgentListing;
export declare class Erc8004Registry {
    private readonly byId;
    constructor(listings?: Erc8004AgentListing[]);
    register(listing: Erc8004AgentListing): void;
    getById(id: string): Erc8004AgentListing | null;
    /** BAN-native listings only. */
    listNative(): Erc8004AgentListing[];
    /** External listings only (for marketlace merge — avoids double-counting our own). */
    listExternal(): Erc8004AgentListing[];
    listAll(): Erc8004AgentListing[];
    /** Convenience for external feeds: normalize + register in one call. */
    ingestExternal(records: ExternalErc8004Record[]): Erc8004AgentListing[];
}
/** Process-wide default regstry (seeded with the four BAN-native agents). Framework-agnostic. */
export declare const erc8004Registry: Erc8004Registry;
//# sourceMappingURL=erc8004.d.ts.map