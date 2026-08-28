import { NextRequest, NextResponse } from 'next/server';
import { getTokenFromRequest } from '@/lib/api-middleware';
import { verifyToken } from '@/lib/auth';
import { getDeveloperTransactions } from '@/lib/db';

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

    const transactions = await getDeveloperTransactions(user.developerId);

    return NextResponse.json({
      transactions: transactions.map(tx => ({
        id: tx.id,
        amount: tx.amount,
        type: tx.type,
        reason: tx.reason,
        balanceBefore: tx.balanceBefore,
        balanceAfter: tx.balanceAfter,
        createdAt: tx.createdAt,
      })),
    });
  } catch (error) {
    console.error('[v0] Get transactions error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
