import { NextRequest, NextResponse } from 'next/server';
import { getTokenFromRequest } from '@/lib/api-middleware';
import { getDeveloper } from '@/lib/db';
import { verifyToken } from '@/lib/auth';

export async function GET(request: NextRequest) {
  try {
    const token = getTokenFromRequest(request);

    if (!token) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const user = verifyToken(token);
    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const developer = await getDeveloper(user.developerId);

    if (!developer) {
      return NextResponse.json(
        { error: 'Developer not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      balance: developer.credits,
      tier: developer.tier,
    });
  } catch (error) {
    console.error('[v0] Get credits error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
