import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { hashPassword, generateToken, setAuthCookie } from '@/lib/auth';
import { getAdminDb, collections, isFirebaseAdminConfigured, BanUser } from '@/lib/firebase-admin';
import { handleError } from '@/lib/core/errors';
import { createStructuredLogger } from '@/lib/core/logger';

const SignupSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(120),
  password: z.string().min(8).max(256),
});

const logger = createStructuredLogger('api.auth.signup');

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
    const parsed = SignupSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid signup payload', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { email, name, password } = parsed.data;
    const normalizedEmail = email.trim().toLowerCase();
    const db = getAdminDb();

    const existing = await db.collection(collections.users).where('email', '==', normalizedEmail).get();
    if (!existing.empty) {
      return NextResponse.json(
        { error: 'An account with this email already exists', code: 'EMAIL_EXISTS' },
        { status: 409 }
      );
    }

    const id = `user_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    const passwordHash = await hashPassword(password);
    const now = new Date().toISOString();

    const userDoc: BanUser = {
      id,
      email: normalizedEmail,
      name: name.trim(),
      passwordHash,
      createdAt: now,
      updatedAt: now,
    };

    await db.collection(collections.users).doc(id).set(userDoc);

    const token = generateToken({ developerId: id, email: normalizedEmail });
    // Set the httpOnly cookie so GET /api/auth/me can authenticate the session
    await setAuthCookie(token);

    logger.info('user_created', { userId: id, email: normalizedEmail });

    return NextResponse.json(
      {
        token,
        user: { id, email: normalizedEmail, name: userDoc.name },
      },
      { status: 201 }
    );
  } catch (err) {
    logger.error('signup_failed', {}, err);
    return handleError(err);
  }
}