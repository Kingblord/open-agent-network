import { NextRequest, NextResponse } from 'next/server';
import { verifyToken, getAuthCookie } from '@/lib/auth';
import { getAdminDb, collections, isFirebaseAdminConfigured } from '@/lib/firebase-admin';
import { handleError } from '@/lib/core/errors';
import { createStructuredLogger } from '@/lib/core/logger';

const logger = createStructuredLogger('api.auth.me');

export async function GET(_request: NextRequest) {
  try {
    if (!isFirebaseAdminConfigured()) {
      logger.warn('firebase_not_configured');
      return NextResponse.json(
        { error: 'Firebase not configured on server' },
        { status: 500 }
      );
    }

    const token = await getAuthCookie();
    if (!token) {
      return NextResponse.json(
        { error: 'Not authenticated', code: 'NO_TOKEN' },
        { status: 401 }
      );
    }

    const payload = verifyToken(token);
    if (!payload) {
      return NextResponse.json(
        { error: 'Invalid or expired token', code: 'INVALID_TOKEN' },
        { status: 401 }
      );
    }

    const db = getAdminDb();
    const doc = await db.collection(collections.users).doc(payload.developerId).get();
    if (!doc.exists) {
      return NextResponse.json(
        { error: 'User not found', code: 'USER_NOT_FOUND' },
        { status: 401 }
      );
    }

    const userData = doc.data()!;
    return NextResponse.json({
      user: {
        id: userData.id,
        email: userData.email,
        name: userData.name,
        credits: userData.credits ?? 0,
        tier: userData.tier ?? 'free',
        createdAt: userData.createdAt,
      },
    });
  } catch (err) {
    logger.error('me_failed', {}, err);
    return handleError(err);
  }
}