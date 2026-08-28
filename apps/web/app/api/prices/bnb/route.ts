import { NextRequest, NextResponse } from 'next/server';
import { getBnbUsdPrice } from '@/lib/bnb-price';

export const dynamic = 'force-dynamic';

/**
 * GET /api/prices/bnb
 *
 * Returns the current BNB → USD rate for control-plane conversions
 * (mustflow §6: USD-denominated session limits → wei). Never invents a rate:
 * when the provider is unreachable we return ok:false and the UI disables
 * conversion-dependent actions (honest "pending conversion").
 */
export async function GET() {
  const updatedAt = new Date().toISOString();
  try {
    const usd = await getBnbUsdPrice();
    return NextResponse.json({ ok: usd != null, usd, updatedAt });
  } catch {
    return NextResponse.json({ ok: false, usd: null, updatedAt });
  }
}