import { NextResponse } from 'next/server';
import { removeAuthCookie } from '@/lib/auth';
import { createStructuredLogger } from '@/lib/core/logger';

const logger = createStructuredLogger('api.auth.logout');

export async function POST() {
  try {
    await removeAuthCookie();
    logger.info('user_logged_out');
    return NextResponse.json({ ok: true });
  } catch (err) {
    logger.error('logout_failed', {}, err);
    return NextResponse.json({ error: 'Logout failed' }, { status: 500 });
  }
}