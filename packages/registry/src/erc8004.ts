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

/** BAN-native agents registered as ERC-8004 listings (the four hackathon agents). */
const BAN_NATIVE_CATALOG: Erc8004AgentListing[] = [
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

/** Loose shape of an external ERC-8004 discovery record we can normalize. */
export interface ExternalErc8004Record {
  id?: unknown;
  agentId?: unknown;
  /** 8004scan API is snake_case. */
  agent_id?: unknown;
  name?: unknown;
  description?: unknown;
  type?: unknown;
  strategyId?: unknown;
  capabilities?: unknown;
  protocols?: unknown;
  /** 8004scan API: supported_protocols. */
  supported_protocols?: unknown;
  riskLevel?: unknown;
  risk_level?: unknown;
  registryAddress?: unknown;
  /** 8004scan API: contract_address. */
  contract_address?: unknown;
  tokenId?: unknown;
  token_id?: unknown;
  metadataUri?: unknown;
  reputationScore?: unknown;
  total_score?: unknown;
  reputationSource?: unknown;
  reputation_source?: unknown;
  verified?: unknown;
  /** 8004scan API: is_verified. */
  is_verified?: unknown;
  created_at?: unknown;
}

function asString(v: unknown, fallback = ''): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'bigint') return String(v);
  return fallback;
}

function asStrings(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => asString(x)).filter(Boolean);
  if (typeof v === 'string' && v.trim()) return [v];
  return [];
}

/** Normalize an external ERC-8004 record into our listing shape (fail-open, reputation-neutral). */
export function normalizeExternalErc8004Record(record: ExternalErc8004Record, fallbackIndex = 0): Erc8004AgentListing {
  const id = asString(record.agentId ?? record.agent_id, asString(record.id, `external-agent-${fallbackIndex}`));
  const riskRaw = asString(record.riskLevel ?? record.risk_level, 'UNKNOWN').toUpperCase();
  const riskLevel: Erc8004AgentListing['riskLevel'] =
    riskRaw === 'LOW' || riskRaw === 'MEDIUM' || riskRaw === 'HIGH' ? riskRaw : 'MEDIUM';
  const reputationScore = record.reputationScore ?? record.total_score;
  const hasReputation =
    reputationScore !== undefined && reputationScore !== null && asString(reputationScore, '') !== '';
  return {
    id,
    name: asString(record.name, `External Agent ${fallbackIndex + 1}`),
    description: asString(record.description, undefined as unknown as string) || undefined,
    type: asString(record.type, 'external'),
    strategyId: asString(record.strategyId) || undefined,
    capabilities: asStrings(record.capabilities),
    protocols: asStrings(record.protocols ?? record.supported_protocols),
    riskLevel,
    status: 'REGISTERED',
    source: 'EXTERNAL',
    registry: {
      registryAddress: asString(record.registryAddress ?? record.contract_address) || undefined,
      tokenId: asString(record.tokenId ?? record.token_id) || undefined,
      metadataUri: asString(record.metadataUri) || undefined,
      // Verified flag sourced from the discovery feed (8004scan is_verified);
      // BAN never asserts on-chain verification it hasn't performed itself.
      verified: record.is_verified === true || record.verified === true,
    },
    // Never synthesize reputation: null unless a real score+source was provided.
    reputation: hasReputation
      ? { score: asString(reputationScore), source: asString(record.reputationSource ?? record.reputation_source) || 'external', verified: false }
      : null,
    createdAt: asString(record.created_at, new Date().toISOString()),
  };
}

export class Erc8004Registry {
  private readonly byId = new Map<string, Erc8004AgentListing>();

  constructor(listings: Erc8004AgentListing[] = []) {
    // Seed with the BAN-native catalog first, then any provided listings.
    for (const listing of [...BAN_NATIVE_CATALOG, ...listings]) {
      this.register(listing);
    }
  }

  register(listing: Erc8004AgentListing): void {
    const key = listing.id.toLowerCase();
    const existing = this.byId.get(key);
    // BAN-native listings are authoritative: external records may NEVER
    // overwrite a native listing with the same id (spoof protection).
    if (existing && existing.source === 'BAN_NATIVE' && listing.source !== 'BAN_NATIVE') return;
    this.byId.set(key, listing);
  }

  getById(id: string): Erc8004AgentListing | null {
    return this.byId.get(id.toLowerCase()) ?? null;
  }

  /** BAN-native listings only. */
  listNative(): Erc8004AgentListing[] {
    return [...this.byId.values()].filter((l) => l.source === 'BAN_NATIVE');
  }

  /** External listings only (for marketlace merge — avoids double-counting our own). */
  listExternal(): Erc8004AgentListing[] {
    return [...this.byId.values()].filter((l) => l.source === 'EXTERNAL');
  }

  listAll(): Erc8004AgentListing[] {
    return [...this.byId.values()];
  }

  /** Convenience for external feeds: normalize + register in one call. */
  ingestExternal(records: ExternalErc8004Record[]): Erc8004AgentListing[] {
    return records.map((r, i) => {
      const listing = normalizeExternalErc8004Record(r, i);
      this.register(listing);
      return listing;
    });
  }
}

/** Process-wide default regstry (seeded with the four BAN-native agents). Framework-agnostic. */
export const erc8004Registry = new Erc8004Registry();