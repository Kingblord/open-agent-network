/**
 * ERC-8183 Hire API — Hire an external agent via the AgenticCommerce kernel.
 *
 * POST /api/erc8183/hire
 * Body: { providerAddress, task, budget, deadlineSeconds? }
 *
 * Flow:
 *   1. User connects wallet (EIP-1193)
 *   2. Frontend builds hire calls via SDK's buildHireCalls
 *   3. User signs the batch (5 calls: createJob → registerJob → setBudget → approve → fund)
 *   4. Job is FUNDED on-chain
 *   5. Provider agent submits deliverable
 *   6. After dispute window, job is settled
 *
 * Note: This route builds the calls for frontend signing. The actual execution
 * happens client-side via the user's wallet (EIP-1193 provider).
 */
import { NextResponse } from 'next/server';
import { createLogger } from '@ban/shared';

const logger = createLogger('erc8183-hire');

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { providerAddress, task, budget, deadlineSeconds } = body;

    if (!providerAddress || !task || !budget) {
      return NextResponse.json(
        { error: 'Missing required fields: providerAddress, task, budget' },
        { status: 400 },
      );
    }

    // Validate provider address format
    if (!/^0x[0-9a-fA-F]{40}$/.test(providerAddress)) {
      return NextResponse.json(
        { error: 'Invalid provider address' },
        { status: 400 },
      );
    }

    // Budget must be a positive bigint string (raw $U units, 18 decimals)
    const budgetBigInt = BigInt(budget);
    if (budgetBigInt <= 0n) {
      return NextResponse.json(
        { error: 'Budget must be positive' },
        { status: 400 },
      );
    }

    logger.info('erc8183_hire_request', {
      providerAddress,
      taskLength: task.length,
      budget: budgetBigInt.toString(),
      deadlineSeconds: deadlineSeconds ?? 1800,
    });

    // Build the hire calls using the SDK
    // The actual execution happens client-side via the user's wallet
    const sdk = await import('@altananetwork/sdk');
    const { erc8183Addresses } = sdk;
    const addresses = erc8183Addresses(56); // BNB Mainnet

    const expiredAt = BigInt(Math.floor(Date.now() / 1000) + 3600 + (deadlineSeconds ?? 1800));

    // Return the hire parameters for the frontend to build and sign
    return NextResponse.json({
      ok: true,
      hire: {
        provider: providerAddress,
        task,
        budget: budgetBigInt.toString(),
        expiredAt: expiredAt.toString(),
        addresses,
        deadlineSeconds: deadlineSeconds ?? 1800,
      },
      instructions: 'Frontend must build hire calls via SDK and sign with user wallet',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('erc8183_hire_error', { error: message });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
