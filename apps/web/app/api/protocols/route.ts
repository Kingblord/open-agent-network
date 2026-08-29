/**
 * GET /api/protocols — auth-gated, read-only snapshot of BAN's BSC protocol
 * registry (mustflow §13.5). Powers the admin/settings page. This endpoint is
 * STRICTLY informational: it returns the DERIVED ladder state from the
 * fail-closed registries. It has no write path and grants no authority —
 * enabling execution is never possible through this route.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getTokenFromRequest } from '@/lib/api-middleware';
import { verifyToken } from '@/lib/auth';
import { buildBnbRegistrySnapshot } from '@ban/registry';

export async function GET(req: NextRequest) {
  // Authenticate via the same JWT seam as every other web API route.
  const token = getTokenFromRequest(req);
  const user = token ? verifyToken(token) : null;
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const snapshot = buildBnbRegistrySnapshot();
    return NextResponse.json({ ok: true, snapshot });
  } catch (err) {
    console.error('[protocols] snapshot failed', err);
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : 'Failed to build protocol registry snapshot',
      },
      { status: 500 },
    );
  }
}