import 'server-only';

import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';

/**
 * Per-agent Altana keystore (mustflow §27–28 — one agent, one dedicated
 * wallet/address, one private-key signer).
 *
 * Each deployed agent owns its OWN wallet. Its signing key is generated at
 * deploy/provision time and stored under `ALTANA_SDK_STORE_DIR/<agentId>/key.json`
 * on the server filesystem (mode 0600). It is NEVER written to Firestore and
 * NEVER returned by any API — only the derived `walletAddress` is ever exposed.
 *
 * Keyless Altana model (no relayer, no Altana API key):
 *   - SDK + signer key + funded BNB wallet is the whole stack.
 *   - The first execute() activates the wallet and registers its admin key in
 *     Altana's KeyStore — the wallet must be funded with BNB before that.
 *
 * `BAN_BNB_PRIVATE_KEY` (env) remains only an operator bootstrap/fallback for
 * the legacy single-key path. Once an agent keystore exists it takes precedence
 * for that agent.
 */

export interface AgentKeystore {
  agentId: string;
  privateKey: `0x${string}`;
  walletAddress: string;
  createdAt: string;
}

export function getAltanaStoreDir(): string {
  const dir = process.env.ALTANA_SDK_STORE_DIR;
  return dir ? path.resolve(dir) : path.resolve(process.cwd(), '.altana');
}

export function agentKeystorePath(agentId: string): string {
  return path.join(getAltanaStoreDir(), agentId, 'key.json');
}

export async function hasAgentKeystore(agentId: string): Promise<boolean> {
  try {
    await access(agentKeystorePath(agentId), constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function loadAgentKeystore(agentId: string): Promise<AgentKeystore | null> {
  try {
    const raw = await readFile(agentKeystorePath(agentId), 'utf8');
    const parsed = JSON.parse(raw) as AgentKeystore;
    if (!parsed || parsed.agentId !== agentId || !parsed.privateKey || !parsed.walletAddress) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function saveAgentKeystore(keystore: AgentKeystore): Promise<void> {
  const file = agentKeystorePath(keystore.agentId);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(keystore, null, 2), { mode: 0o600 });
}