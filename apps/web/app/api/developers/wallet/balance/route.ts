import { NextRequest, NextResponse } from 'next/server';
import { createPublicClient, http, parseAbi, formatUnits } from 'viem';
import { BANError, ErrorCode, createLogger } from '@ban/shared';

const logger = createLogger('api.wallet.balance');

const RPC_URL = process.env.BAN_RPC_URL || 'https://bsc-dataseed.binance.org/';
const WBNB = '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c';
const USDT = '0x55d398326f99059fF775485246999027B3197955';
const USDC = '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d';

const ERC20_BALANCE_ABI = parseAbi(['function balanceOf(address) view returns (uint256)']);

async function fetchBnbPrice(): Promise<number> {
  try {
    const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=binancecoin&vs_currencies=usd', {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      const json = await res.json() as { binancecoin?: { usd?: number } };
      return json.binancecoin?.usd ?? 600;
    }
  } catch { /* ignore */ }
  return 600;
}

export async function GET(request: NextRequest) {
  try {
    const address = request.nextUrl.searchParams.get('address');
    if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) {
      return NextResponse.json({ error: 'Invalid address' }, { status: 400 });
    }

    const client = createPublicClient({ transport: http(RPC_URL) });

    const [bnbRaw, usdtRaw, usdcRaw, bnbPrice] = await Promise.all([
      client.getBalance({ address: address as `0x${string}` }),
      client.readContract({ address: USDT as `0x${string}`, abi: ERC20_BALANCE_ABI, functionName: 'balanceOf', args: [address as `0x${string}`] }).catch(() => 0n),
      client.readContract({ address: USDC as `0x${string}`, abi: ERC20_BALANCE_ABI, functionName: 'balanceOf', args: [address as `0x${string}`] }).catch(() => 0n),
      fetchBnbPrice(),
    ]);

    const bnb = formatUnits(bnbRaw, 18);
    const usdt = formatUnits(usdtRaw as bigint, 18);
    const usdc = formatUnits(usdcRaw as bigint, 18);

    return NextResponse.json({
      ok: true,
      address,
      bnb,
      usdt,
      usdc,
      bnbPrice,
      usdTotal: (parseFloat(bnb) * bnbPrice) + parseFloat(usdt) + parseFloat(usdc),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('wallet_balance_error', { error: message });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}