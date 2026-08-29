import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAdminApp, getAdminDb, collections, isFirebaseAdminConfigured } from '@/lib/firebase-admin';
import { generateToken, setAuthCookie } from '@/lib/auth';
import { handleError } from '@/lib/core/errors';
import { createStructuredLogger } from '@/lib/core/logger';

const FirebaseAuthSchema = z.object({
  idToken: z.string().min(1),
  name: z.string().max(120).optional(),
});

const logger = createStructuredLogger('api.auth.firebase');

/**
 * POST /api/auth/firebase
 *
 * Exchanges a Firebase client ID token for a BAN Firestore user record.
 * - Creates the user in Firestore on first encounter (via Firebase Auth signup)
 * - Returns existing user on subsequent encounters (via Firebase Auth login)
 *
 * The Firebase Admin SDK verifies the ID token server-side — no client-side
 * trust is assumed. The `name` field is accepted only on first creation.
 *
 * In both cases (first-time OR existing user) a signed JWT is set in the
 * httpOnly `oan-token` cookie so that every mutating API (deploy, lifecycle,
 * profile update, agent rename, API keys, credits) can authenticate. This
 * keeps the Firebase login path consistent with the legacy JWT login path —
 * otherwise a user who logs in via Firebase can render the UI but every write
 * fails with 401.
 *
 * NOTE: firebase-admin/auth is imported lazily (inside the handler) on purpose.
 * If the module itself fails to LOAD — e.g. the jwks-rsa -> jose ESM/CJS
 * interop error on older Node runtimes — the failure is caught here and
 * returned as a machine-readable JSON 503 with the underlying reason, instead
 * of escaping the route handler and making Next/Vercel render the generic
 * HTML 500 page (which reads like the endpoint isn't an API at all).
 */
export async function POST(request: NextRequest) {
  try {
    if (!isFirebaseAdminConfigured()) {
      logger.warn('firebase_not_configured');
      return NextResponse.json(
        { error: 'Firebase not configured on server' },
        { status: 500 }
      );
    }

    // Lazy-load the Admin auth SDK so ANY module-load failure is catchable
    // and reported as JSON, never an uncaught import-time crash.
    let loadDetail = '';
    const authModule = await import('firebase-admin/auth').catch((loadErr: unknown) => {
      loadDetail = loadErr instanceof Error ? loadErr.message : String(loadErr);
      logger.error('firebase_admin_auth_load_failed', { detail: loadDetail }, loadErr);
      return null;
    });

    if (!authModule) {
      return NextResponse.json(
        {
          error: 'Firebase Admin auth SDK failed to load on the server',
          code: 'AUTH_SDK_LOAD_FAILED',
          detail: loadDetail,
        },
        { status: 503 }
      );
    }
    const getFirebaseAuth = authModule.getAuth;

    const body = await request.json().catch(() => null);
    const parsed = FirebaseAuthSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid payload', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { idToken, name } = parsed.data;

    // Verify the Firebase ID token using Admin SDK — MUST pass the admin app
    // so the Admin SDK uses the correct project's public keys to verify.
    let decoded;
    try {
      decoded = await getFirebaseAuth(getAdminApp()).verifyIdToken(idToken);
    } catch {
      return NextResponse.json(
        { error: 'Invalid or expired Firebase token', code: 'INVALID_TOKEN' },
        { status: 401 }
      );
    }

    const { uid, email } = decoded;
    if (!email) {
      return NextResponse.json(
        { error: 'Firebase token missing email', code: 'NO_EMAIL' },
        { status: 400 }
      );
    }

    const normalizedEmail = email.toLowerCase();
    const db = getAdminDb();

    // Check if user exists in Firestore
    const existing = await db.collection(collections.users).where('email', '==', normalizedEmail).get();

    if (!existing.empty) {
      // Existing user — mint JWT + set cookie so all mutating APIs authenticate
      const doc = existing.docs[0];
      const userData = doc.data();
      const token = generateToken({ developerId: userData.id, email: userData.email });
      await setAuthCookie(token);
      return NextResponse.json({
        token,
        user: {
          id: userData.id,
          email: userData.email,
          name: userData.name,
          credits: userData.credits ?? 0,
          tier: userData.tier ?? 'free',
          createdAt: userData.createdAt,
        },
      });
    }

    // New user — create a Firestore record, then set the JWT cookie
    const id = `user_${uid.slice(0, 8)}`;
    const now = new Date().toISOString();

    await db.collection(collections.users).doc(id).set({
      id,
      email: normalizedEmail,
      name: name || email.split('@')[0] || 'User',
      credits: 0,
      tier: 'free',
      createdAt: now,
      updatedAt: now,
    });

    logger.info('user_created_via_firebase', { userId: id, email: normalizedEmail });

    const token = generateToken({ developerId: id, email: normalizedEmail });
    await setAuthCookie(token);

    return NextResponse.json({
      token,
      user: {
        id,
        email: normalizedEmail,
        name: name || email.split('@')[0] || 'User',
        credits: 0,
        tier: 'free',
        createdAt: now,
      },
    }, { status: 201 });
  } catch (err) {
    logger.error('firebase_auth_failed', {}, err);
    return handleError(err);
  }
}