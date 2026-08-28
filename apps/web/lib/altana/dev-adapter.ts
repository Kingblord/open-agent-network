import 'server-only';

/**
 * M4 - Deterministic DEV Altana adapter.
 *
 * This is an EXPLICIT dev/test provider selected only when
 * `ALTANA_PROVIDER=dev` (the sandbox default). It simulates the Altana
 * session-registry surface (wallet provisioning, session grant/revoke) with
 * stable, deterministic fake on-chain references. It is NOT used on a real
 * network path; the real SDK calls are the `altana` provider's job.
 *
 * Rule 7: mocks/fakes only behind an explicit dev/test provider selection.
 */
import type {
  AltanaAdapter,
  AltanaGrant,
  AltanaGrantResult,
  AltanaRevoke,
  AltanaRevokeResult,
  AltanaWalletResult,
} from './adapter';
import { generateId } from '@ban/shared';

export class DevAltanaAdapter implements AltanaAdapter {
  readonly provider = 'dev' as const;

  async ensureWallet(): Promise<AltanaWalletResult> {
    // Deterministic fake address derived from a seeded id.
    return { address: `0xDEV${generateId('wallet').replace(/^wallet_/, '')}` };
  }

  async grantSession(input: AltanaGrant): Promise<AltanaGrantResult> {
    // Deterministic "on-chain" session key and registry reference.
    const sessionKey = `dev_key_${generateId('sk')}`;
    return {
      sessionKeyReference: sessionKey,
      onchainRegistryReference: `dev_tx_${generateId('tx')}`,
      expiry: input.expiresAtUnixSec,
    };
  }

  async revokeSession(_input: AltanaRevoke): Promise<AltanaRevokeResult> {
    return { revoked: true, onchainRegistryReference: `dev_tx_${generateId('tx')}` };
  }
}