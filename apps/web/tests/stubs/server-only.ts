// Test-only stub: Next's `server-only` package throws when imported outside
// the Next runtime. In vitest (environment: node) we alias it to a no-op so
// server-only modules (firebase-admin, job-repo) can be imported and exercised
// directly. This stub is never used by the app itself.
export {};