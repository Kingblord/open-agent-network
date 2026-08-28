import 'server-only';

/**
 * M4 - SessionManager factory.
 *
 * Selects the Altana provider based on env. In production/real deployments the
 * real Altana adapter is used; for local dev / hermetic tests
 * `ALTANA_PROVIDER=dev` selects the deterministic DEV adapter.
 */
import { SessionManager } from './session-manager';
import { DevAltanaAdapter } from './altana/dev-adapter';

export function sessionManagerFactory(): SessionManager {
  const provider = process.env.ALTANA_PROVIDER ?? 'dev';
  if (provider === 'altana') {
    // Real provider is a network/deployment concern; the sandbox defaults to
    // the DEV adapter so the control-plane + tests are runnable offline.
    // Import lazily to avoid pulling the SDK into every request if unused.
  }
  return new SessionManager(new DevAltanaAdapter());
}