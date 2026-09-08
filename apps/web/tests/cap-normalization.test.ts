import { describe, it, expect, vi } from 'vitest';
import { normalizeProposalValueForCaps } from '../lib/agent-runtime/cap-normalization';

/**
 * Regression test for the REAL failure seen in production:
 *   task_e933ae360 / task_b4e735ab8 —
 *   "Value 2800000000000000000 exceeds per-transaction cap 5319856363878175"
 *
 * 2800000000000000000 is the CORRECT repayment amount in USDC WEI (2.8 USDC),
 * while 5319856363878175 is the session cap in BNB WEI ($4 worth of BNB).
 * Comparing raw USDC wei against a BNB-wei cap is a unit mismatch — the
 * normalization MUST convert to a BNB-wei equivalent before policy compares.
 */

const USDC_ADDR = '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d';
const USDT_ADDR = '0x55d398326f99059fF775485246999027B3197955';

function proposal(opts: { token?: string; estimatedValue: string; underlying?: string }): any {
  return {
    proposalId: 'prop_test',
    agentId: 'ag_test',
    userId: 'user_test',
    sessionId: 'sess_test',
    protocol: 'venus',
    contract: '0x0000000000000000000000000000000000000001',
    function: 'repayBorrow',
    action: 'DEPOSIT',
    token: opts.token ?? USDC_ADDR,
    amount: opts.estimatedValue,
    estimatedValue: opts.estimatedValue,
    asset: 'USDC',
    params: opts.underlying ? { underlying: opts.underlying } : {},
    idempotencyKey: 'ik_test',
    createdAt: new Date().toISOString(),
  };
}

describe('normalizeProposalValueForCaps — unit coherence (the "exceeds cap" fix)', () => {
  it('converts 2.8e18 USDC wei to a BNB-wei equivalent that FITS a $4 cap', async () => {
    // $4 cap in BNB wei at $757.55 (matches the task that failed)
    const capBnbWei = BigInt(Math.floor(4 / 757.55 * 1e18)); // ≈ 5279...e15
    vi.spyOn((await import('@/lib/bnb-price')), 'getBnbUsdPrice').mockResolvedValue(757.55);

    const normalized = await normalizeProposalValueForCaps(
      proposal({ estimatedValue: '2800000000000000000' }), // 2.8 USDC
      'test',
    );
    const bnbWei = BigInt(normalized.estimatedValue);
    expect(bnbWei).toBeLessThan(capBnbWei); // $2.80 < $4 → must fit
    // Sanity: 2.8 USDC at $757.55 ≈ 0.003696 BNB
    expect(Number(bnbWei) / 1e18).toBeCloseTo(0.003696, 4);
  });

  it('does NOT convert native BNB/WBNB proposals (already BNB-wei)', async () => {
    const p = proposal({ token: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', estimatedValue: '1000000000000000000' }); // WBNB
    const out = await normalizeProposalValueForCaps(p, 'test');
    expect(out.estimatedValue).toBe('1000000000000000000');
  });

  it('falls back to params.underlying when token is a vToken address', async () => {
    // A strategy that sets token = vUSDC (the receipt token) still converts.
    const p = proposal({
      token: '0xfD5840Cd36d94D7229439859C0112a4185BC0255', // vUSDC
      underlying: USDC_ADDR,
      estimatedValue: '1000000000000000000', // 1 USDC
    });
    vi.spyOn((await import('@/lib/bnb-price')), 'getBnbUsdPrice').mockResolvedValue(1000);
    const out = await normalizeProposalValueForCaps(p, 'test');
    // 1 USDC at $1000/BNB = 0.001 BNB
    expect(out.estimatedValue).toBe('1000000000000000');
  });

  it('fails closed when the price feed is unavailable (never guesses)', async () => {
    vi.spyOn((await import('@/lib/bnb-price')), 'getBnbUsdPrice').mockResolvedValue(null);
    const p = proposal({ estimatedValue: '1000000000000000000' });
    const result = await normalizeProposalValueForCaps(p, 'test').then(
      () => 'no-error',
      (e) => (e as { code?: string }).code ?? 'no-code',
    );
    expect(result).toBe('ERR_POLICY_DENIED');
  });
});