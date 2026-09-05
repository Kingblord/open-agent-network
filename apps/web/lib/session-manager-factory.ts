import 'server-only';

/**
 * M4 - SessionManager factory.
 *
 * Selects the Altana provider based on env:
 *   - ALTANA_PROVIDER=altana → RealAltanaAdapter (on-chain session grant/revoke)
 *   - ALTANA_PROVIDER=dev (default) → DevAltanaAdapter (deterministic fakes)
 *
 * The real adapter is lazy-loaded to avoid pulling the SDK into every request.
 */
import { SessionManager } from './session-manager';
import { DevAltanaAdapter } from './altana/dev-adapter';

export function sessionManagerFactory(): SessionManager {
  const provider = process.env.ALTANA_PROVIDER ?? 'dev';
  if (provider === 'altana') {
    // Lazy-load the real adapter to avoid pulling the SDK into every request.
    // The real adapter uses @altananetwork/sdk for on-chain session grant/revoke.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { RealAltanaAdapter } = require('./altana/real-adapter') as typeof import('./altana/real-adapter');
    return new SessionManager(new RealAltanaAdapter());
  }
  return new SessionManager(new DevAltanaAdapter());
}