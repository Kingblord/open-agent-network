import { NextRequest, NextResponse } from 'next/server';
import { verifyToken } from '@/lib/auth';
import { getTokenFromRequest } from '@/lib/api-middleware';
import { getAdminDb, collections, isFirebaseAdminConfigured, BanUser } from '@/lib/firebase-admin';
import { handleError } from '@/lib/core/errors';
import { createStructuredLogger } from '@/lib/core/logger';

const logger = createStructuredLogger('api.me');

/**
 * M1 closed loop terminus:
 *   User signs in -> JWT -> route handler verifies identity
 *   -> user document exists -> authenticated request succeeds
 *   -> Firestore record created (audit event) -> structured log emitted.
 */
export async function GET(request: NextRequest) {
  try {
    const token = getTokenFromRequest(request);
    const payload = token ? verifyToken(token) : null;

    if (!payload) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!isFirebaseAdminConfigured()) {
      logger.warn('firebase_not_configured', { developerId: payload.developerId });
      return NextResponse.json(
        { error: 'Firebase not configured on server' },
        { status: 500 }
      );
    }

    const db = getAdminDb();
    const docRef = db.collection(collections.users).doc(payload.developerId);
    const snap = await docRef.get();

    let user: BanUser | null = null;
    if (snap.exists) {
      user = snap.data() as BanUser;
      logger.info('me_request', { userId: user.id, email: user.email });
    } else {
      // Recreate the record if the JWT is valid but the doc was removed.
      const now = new Date().toISOString();
      user = {
        id: payload.developerId,
        email: payload.email,
        name: payload.email.split('@')[0],
        createdAt: now,
        updatedAt: now,
      };
      await docRef.set(user);
      logger.info('me_user_created', { userId: user.id, email: user.email });
    }

    // Firestore record created/read -> structured log emitted (as JSON line).
    return NextResponse.json({
      ok: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
      },
    });
  } catch (err) {
    logger.error('me_failed', {}, err);
    return handleError(err);
  }
}