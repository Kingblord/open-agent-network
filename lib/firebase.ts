// Firebase is intentionally disabled. Authentication is handled entirely by
// the versioned localStorage store in lib/auth-context.tsx.
// This compatibility module remains so legacy data routes can compile without
// initializing Firestore or requiring Firebase environment variables.
export const db = null as never
export const auth = null as never
export default null
