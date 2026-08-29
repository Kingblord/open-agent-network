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
import { mkdir, writeFile } from 'node:fs/promises';
import { AAVE_V3_BNB_ROLES, LISTA_DAO_BNB_ROLES, } from './aave-lista-references.js';
const FETCH_TIMEOUT_MS = 10_000;
/** Cheap 0x + 40-hex address check (no checksum requirement — sources vary). */
export function isAddressLike(value) {
    return typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value);
}
function isRecord(value) {
    return value !== null && typeof value === 'object';
}
function log(...args) {
    console.log('[fetch-deployments]', ...args);
}
/** Fetch a raw URL as unknown JSON; returns null on any failure (never throws). */
export async function fetchJson(url) {
    try {
        const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
        if (!res.ok) {
            log(`HTTP ${res.status} — ${url}`);
            return null;
        }
        const text = await res.text();
        return JSON.parse(text);
    }
    catch (err) {
        log(`fetch failed: ${url}`, err instanceof Error ? err.message : String(err));
        return null;
    }
}
/**
 * Deep keyed-object lookup: finds `{ Role: "0x…" }`, `{ Role: { address } }`,
 * versioned nesting (`{ "0.0.1": { Role: … } }`) and array-valued roles.
 * Case-insensitive on the role key (sources vary in casing).
 */
function findKeyValue(node, key) {
    const direct = Object.keys(node).find((k) => k.toLowerCase() === key.toLowerCase());
    return direct === undefined ? undefined : node[direct];
}
function deepAddressLookup(node, key) {
    if (Array.isArray(node)) {
        for (const item of node) {
            const hit = deepAddressLookup(item, key);
            if (hit)
                return hit;
        }
        return null;
    }
    if (!isRecord(node))
        return null;
    const entry = findKeyValue(node, key);
    if (entry !== undefined) {
        if (isAddressLike(entry))
            return entry;
        if (isRecord(entry) && isAddressLike(entry.address))
            return entry.address;
        if (Array.isArray(entry)) {
            for (const item of entry) {
                if (isAddressLike(item))
                    return item;
                if (isRecord(item) && isAddressLike(item.address))
                    return item.address;
            }
        }
    }
    for (const value of Object.values(node)) {
        const hit = deepAddressLookup(value, key);
        if (hit)
            return hit;
    }
    return null;
}
/** Foundry broadcast JSON: root `transactions[]` → { contractName, contractAddress }. */
function broadcastLookup(payload, role) {
    if (!isRecord(payload) || !Array.isArray(payload.transactions))
        return null;
    const roleLower = role.toLowerCase();
    for (const tx of payload.transactions) {
        if (!isRecord(tx))
            continue;
        const name = typeof tx.contractName === 'string' ? tx.contractName.toLowerCase() : '';
        if (name !== roleLower)
            continue;
        const addr = tx.contractAddress ?? tx.address;
        if (isAddressLike(addr))
            return addr;
    }
    return null;
}
/** Resolve one role key from any supported published-JSON shape. */
export function findRoleAddress(payload, role) {
    const deep = deepAddressLookup(payload, role);
    if (deep)
        return deep;
    return broadcastLookup(payload, role);
}
/** Resolve a protocol's published JSON against its role references (role name → address). */
export function resolveRolesFromPayload(protocolId, references, payload, sourceUrl) {
    return references.map((ref) => {
        const address = findRoleAddress(payload, ref.role);
        return {
            protocolId,
            role: ref.role,
            usedByAdapterAs: ref.usedByAdapterAs,
            address,
            source: address ? sourceUrl : null,
        };
    });
}
/** Candidate raw URLs per protocol, tried in order; env overrides win. */
function candidateUrls(protocolId) {
    const env = protocolId === 'aave'
        ? process.env.AAVE_BNB_DEPLOYMENT_URL
        : process.env.LISTA_BNB_DEPLOYMENT_URL;
    const candidates = protocolId === 'aave'
        ? [
            'https://raw.githubusercontent.com/aave/aave-v3-deploy/main/deployments/bnb.json',
            'https://raw.githubusercontent.com/aave/v3-deployments/master/output/bnb.json',
            'https://raw.githubusercontent.com/aave/v3-deployments/main/output/bnb.json',
        ]
        : [
            'https://raw.githubusercontent.com/lista-dao/lista-token/master/broadcast/ListaToken.s.sol/bscMainnet/run-latest.json',
            'https://raw.githubusercontent.com/lista-dao/lista-contracts/main/deployments/bnb.json',
            'https://docs.lista.org/static/deployments/bnb.json',
        ];
    return env ? [env, ...candidates] : candidates;
}
/** PancakeSwap V3 role names as they appear in the published deployment JSON. */
const PANCAKE_V3_BNB_ROLES = [
    {
        protocolId: 'pancakeswap',
        chainId: 56,
        role: 'SmartRouter',
        usedByAdapterAs: 'v3SwapRouter',
        published: true,
        status: 'pending-on-chain-verification',
        sources: ['pancakeswap-v3-deployments-json'],
    },
    {
        protocolId: 'pancakeswap',
        chainId: 56,
        role: 'MasterChefV3',
        usedByAdapterAs: 'masterChefV3',
        published: true,
        status: 'pending-on-chain-verification',
        sources: ['pancakeswap-v3-deployments-json'],
    },
];
/** Fetch + resolve one protocol. Fail-closed: no resolved URL → ok:false, roles all null. */
export async function fetchAndResolveProtocol(protocolId) {
    let refs;
    let urls;
    if (protocolId === 'pancakeswap') {
        refs = PANCAKE_V3_BNB_ROLES;
        const env = process.env.PANCAKE_BNB_DEPLOYMENT_URL;
        urls = [
            'https://raw.githubusercontent.com/pancakeswap/pancake-v3-contracts/main/deployments/bscMainnet.json',
        ];
        if (env)
            urls = [env, ...urls];
    }
    else {
        refs = protocolId === 'aave' ? AAVE_V3_BNB_ROLES : LISTA_DAO_BNB_ROLES;
        urls = candidateUrls(protocolId);
    }
    const emptyRoles = refs.map((r) => ({
        protocolId,
        role: r.role,
        usedByAdapterAs: r.usedByAdapterAs,
        address: null,
        source: null,
    }));
    for (const url of urls) {
        const payload = await fetchJson(url);
        if (payload === null)
            continue;
        const roles = resolveRolesFromPayload(protocolId, refs, payload, url);
        const resolved = roles.some((r) => r.address !== null);
        if (resolved) {
            return { protocolId, sourceUrl: url, ok: true, roles };
        }
        log(`present but no matching role keys in ${url}`);
    }
    return {
        protocolId,
        sourceUrl: null,
        ok: false,
        error: 'no candidate URL resolved — set PANCAKE_BNB_DEPLOYMENT_URL / AAVE_BNB_DEPLOYMENT_URL / LISTA_BNB_DEPLOYMENT_URL to pin the exact published JSON',
        roles: emptyRoles,
    };
}
export async function fetchAllProtocolOutcomes() {
    const [pancake, aave, lista] = await Promise.all([
        fetchAndResolveProtocol('pancakeswap'),
        fetchAndResolveProtocol('aave'),
        fetchAndResolveProtocol('lista'),
    ]);
    return [pancake, aave, lista];
}
/** Write machine-readable candidates for the verification step (never the catalog). */
async function writeFetchedCandidates(outcomes) {
    const file = process.env.BAN_FETCHED_FILE ?? 'dist/seed-catalog/fetched-addresses.json';
    const candidates = outcomes.flatMap((o) => o.roles).filter((r) => r.address !== null);
    await mkdir('dist/seed-catalog', { recursive: true });
    await writeFile(file, JSON.stringify({ generatedAt: new Date().toISOString(), candidates }, null, 2));
    log(`wrote ${file} (${candidates.length} candidates)`);
}
/** CLI entrypoint (module-safe; no top-level await). */
async function main() {
    const outcomes = await fetchAllProtocolOutcomes();
    for (const o of outcomes) {
        if (!o.ok) {
            log(`FETCH_FAILED ${o.protocolId.padEnd(12)} ${o.error ?? ''}`);
            for (const r of o.roles) {
                log(`  EMPTY  ${r.role.padEnd(22)} ${r.usedByAdapterAs.padEnd(18)} no published address resolved — fail-closed (never guessed)`);
            }
            continue;
        }
        log(`RESOLVED ${o.protocolId.padEnd(12)} source=${o.sourceUrl ?? ''}`);
        for (const r of o.roles) {
            log(r.address
                ? `  OK     ${r.role.padEnd(22)} ${r.usedByAdapterAs.padEnd(18)} ${r.address}`
                : `  EMPTY  ${r.role.padEnd(22)} ${r.usedByAdapterAs.padEnd(18)} role published but no address found in source — fail-closed`);
        }
    }
    await writeFetchedCandidates(outcomes);
}
main().catch((err) => {
    console.error('[fetch-deployments] failed', err instanceof Error ? err.message : err);
    process.exitCode = 1;
});
