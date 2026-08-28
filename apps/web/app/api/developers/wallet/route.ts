import { NextRequest, NextResponse } from 'next/server';
import { getTokenFromRequest } from '@/lib/api-middleware';
import { verifyToken, JWTPayload } from '@/lib/auth';
import { getDeveloper, updateDeveloper } from '@/lib/db';
import { isAddress } from 'viem';

/**
 * POST /api/developers/wallet
 *
 * Persists the wallet address the user has connected via Thirdweb to their
 * Firestore account record. This makes the connected wallet survive across
 * sessions/browsers (not just localStorage) so BAN agents can bind to the
 * verified wallet address on the user's account.
 *
 * Auth: JWT (oan-token cookie / Bearer). Address is EIP-55 validated server-side.
 */
export async function POST(request: NextRequest) {
  try {
    const token = getTokenFromRequest(request);
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const user = verifyToken(token);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json().catch(() => null);
    const walletAddress = body?.walletAddress ?? null;

    if (walletAddress !== null && !isAddress(walletAddress)) {
      return NextResponse.json(
        { error: 'Invalid wallet address' },
        { status: 400 }
      );
    }

    const developer = await getDeveloper(user.developerId);
    if (!developer) {
      return NextResponse.json({ error: 'Developer not found' }, { status: 404 });
    }

    // Store the (optional) wallet address. Removing a link is allowed by passing
    // null (disconnect).
    await updateDeveloper(user.developerId, { walletAddress: walletAddress ?? undefined });

    return NextResponse.json({
      walletAddress,
      message: walletAddress ? 'Wallet connected' : 'Wallet disconnected',
    });
  } catch (error) {
    console.error('[v0] Wallet connect error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * GET /api/developers/wallet
 *
 * Returns the wallet address currently persisted on the authenticated account.
 */
export async function GET(request: NextRequest) {
  try {
    const token = getTokenFromRequest(request);
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const user = verifyToken(token);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const developer = await getDeveloper(user.developerId);
    if (!developer) {
      return NextResponse.json({ error: 'Developer not found' }, { status: 404 });
    }

    return NextResponse.json({ walletAddress: developer.walletAddress ?? null });
  } catch (error) {
    console.error('[v0] Get wallet error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export const dynamic = 'force-dynamic';