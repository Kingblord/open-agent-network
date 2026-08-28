import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { comparePassword, generateToken, setAuthCookie } from '@/lib/auth';
import { getAdminDb, collections, isFirebaseAdminConfigured, BanUser } from '@/lib/firebase-admin';
import { handleError } from '@/lib/core/errors';
import { createStructuredLogger } from '@/lib/core/logger';

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const logger = createStructuredLogger('api.auth.login');

export async function POST(request: NextRequest) {
  try {
    if (!isFirebaseAdminConfigured()) {
      logger.warn('firebase_not_configured');
      return NextResponse.json(
        { error: 'Firebase not configured on server' },
        { status: 500 }
      );
    }

    const body = await request.json().catch(() => null);
    const parsed = LoginSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid login payload' },
        { status: 400 }
      );
    }

    const { email, password } = parsed.data;
    const normalizedEmail = email.trim().toLowerCase();
    const db = getAdminDb();

    const snap = await db.collection(collections.users).where('email', '==', normalizedEmail).get();
    if (snap.empty) {
      return NextResponse.json(
        { error: 'Invalid credentials' },
        { status: 401 }
      );
    }

    const userDoc = snap.docs[0].data() as BanUser;
    const valid = userDoc.passwordHash ? await comparePassword(password, userDoc.passwordHash) : false;
    if (!valid) {
      return NextResponse.json(
        { error: 'Invalid credentials' },
        { status: 401 }
      );
    }

    const token = generateToken({ developerId: userDoc.id, email: userDoc.email });
    // Set the httpOnly cookie so GET /api/auth/me can authenticate the session
    await setAuthCookie(token);

    logger.info('user_login', { userId: userDoc.id, email: userDoc.email });

    return NextResponse.json({
      token,
      user: { id: userDoc.id, email: userDoc.email, name: userDoc.name },
    });
  } catch (err) {
    logger.error('login_failed', {}, err);
    return handleError(err);
  }
}