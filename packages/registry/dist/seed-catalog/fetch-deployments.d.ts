/**
 * Deployment JSON fetcher for PancakeSwap + Aave V3 (BNB Chain) + Lista DAO —
 * mustflow §10–§14.
 *
 * Read-only resolver: pulls the protocols' PUBLISHED deployment JSON and maps
 * official role names → candidate addresses. It NEVER guesses addresses and
 * NEVER mutates the seed catalog (`bnb-seeds.ts`) or `bnb-mainnet.ts`;
 * promotion into the catalog happens only via the verification pipeline
 * (`verify-seeds.ts`) after an on-chain check.
 *
 * Fail-closed contract:
 *   - A role with no resolvable address in the published source stays null
 *     and prints as EMPTY. The registry remains `verified:false` /
 *     `contracts:{}` → nothing executable until the pipeline confirms a real
 *     address (verified ≠ enabled, mustflow §12).
 *   - An unreachable / non-200 / malformed / non-address-looking source
 *     yields FETCH_FAILED for that protocol (with the HTTP status logged) —
 *     the catalog is left untouched.
 *
 * Canonical sources (defaults, see VERIFY-SOURCES.md):
 *   - PancakeSwap: pancakeswap/pancake-v3-contracts → deployments/bscMainnet.json
 *     (confirmed HTTP 200). override env PANCAKE_BNB_DEPLOYMENT_URL.
 *   - Aave V3:     aave/aave-v3-deploy → deployments/bnb.json (repo exists;
 *     exact path needs confirmation — override with the working raw URL).
 *   - Lista DAO:   lista-dao/lista-token broadcast JSON (override env).
 *   (Aave/Lista's paths were 404 from this IP's guesses; the fetcher reports
 *   status per URL so a correct path is a one-line override.)
 *
 * Recognizes both "keyed object" deployment JSON (e.g. Aave / PancakeSwap /
 * Venus: { Role: "0x…" } or { Role: { address: "0x…" } } / versioned nesting)
 * and Foundry broadcast JSON (root `transactions[]` with contractName +
 * contractAddress, e.g. Lista).
 *
 * CLI (built from src):
 *   node dist/seed-catalog/fetch-deployments.js
 * Writes dist/seed-catalog/fetched-addresses.json for the verification step
 * (override the output path with env BAN_FETCHED_FILE).
 */
import { ProtocolRoleReference } from './aave-lista-references.js';
export interface ResolvedRoleAddress {
    protocolId: string;
    role: string;
    usedByAdapterAs: string;
    /** null = no published address resolved (fail-closed; never guessed). */
    address: string | null;
    /** Provenance: the exact URL that supplied the address. */
    source: string | null;
}
export interface FetchOutcome {
    protocolId: string;
    sourceUrl: string | null;
    ok: boolean;
    error?: string;
    roles: ResolvedRoleAddress[];
}
/** Cheap 0x + 40-hex address check (no checksum requirement — sources vary). */
export declare function isAddressLike(value: unknown): value is `0x${string}`;
/** Fetch a raw URL as unknown JSON; returns null on any failure (never throws). */
export declare function fetchJson(url: string): Promise<unknown | null>;
/** Resolve one role key from any supported published-JSON shape. */
export declare function findRoleAddress(payload: unknown, role: string): string | null;
/** Resolve a protocol's published JSON against its role references (role name → address). */
export declare function resolveRolesFromPayload(protocolId: string, references: ProtocolRoleReference[], payload: unknown, sourceUrl: string): ResolvedRoleAddress[];
/** Fetch + resolve one protocol. Fail-closed: no resolved URL → ok:false, roles all null. */
export declare function fetchAndResolveProtocol(protocolId: 'aave' | 'lista' | 'pancakeswap'): Promise<FetchOutcome>;
export declare function fetchAllProtocolOutcomes(): Promise<FetchOutcome[]>;
//# sourceMappingURL=fetch-deployments.d.ts.map