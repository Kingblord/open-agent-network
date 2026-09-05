import { NextRequest, NextResponse } from 'next/server';
import { createPublicClient, http, parseAbi, formatUnits } from 'viem';
import { createLogger } from '@ban/shared';

const logger = createLogger('api.wallet.balance');

const RPC_URL = process.env.BAN_RPC_URL || 'https://bsc-dataseed.binance.org/';
const USDT = '0x55d398326f99059fF775485246999027B3197955';
const USDC = '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d';

const ERC20_ABI = parseAbi(['function balanceOf(address) view returns (uint256)']);

// Venus vToken addresses
const VENUS_VTOKENS: Record<string, string> = {
  vBNB: '0xA07c5b74C9B40447a954e1466938b865b6BBea36',
  vUSDT: '0xfD5840Cd36d94D7229439859C0112a4185BC0255',
  vUSDC: '0xecA88125a5ADbe82614ffC12D0DB554E2e2867C8',
  vETH: '0xf508fCD89b8bd15579dc79A6827cB4686A3592c8',
  vBTC: '0x882C173bC7Ff3b7786CA16dfeD3DFFfb9Ee7847B',
};
const VENUS_VTOKEN_ABI = parseAbi(['function balanceOf(address) view returns (uint256)', 'function exchangeRateStored() view returns (uint256)']);

// Aave V3 Pool
const AAVE_V3_POOL = '0x6807dc923806fE8Fd134338EABCA509979a7e0cB';
const AAVE_ABI = parseAbi(['function getUserAccountData(address) view returns (uint256 totalCollateralBase, uint256 totalDebtBase, uint256 availableBorrowsBase, uint256 currentLiquidationThreshold, uint256 ltv, uint256 healthFactor)']);

// PancakeSwap V3 Position Manager
const PANCAKE_POSITION_MANAGER = '0x46A15B0b27311cedF172AB29E4f4766fB7fD23bD';
const NFT_ABI = parseAbi(['function balanceOf(address) view returns (uint256)']);

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
    const addr = address as `0x${string}`;

    const [bnbRaw, usdtRaw, usdcRaw, bnbPrice] = await Promise.all([
      client.getBalance({ address: addr }),
      client.readContract({ address: USDT as `0x${string}`, abi: ERC20_ABI, functionName: 'balanceOf', args: [addr] }).catch(() => 0n),
      client.readContract({ address: USDC as `0x${string}`, abi: ERC20_ABI, functionName: 'balanceOf', args: [addr] }).catch(() => 0n),
      fetchBnbPrice(),
    ]);

    // Check Venus lending positions
    const venusPositions: { protocol: string; token: string; supplied: string; borrowed: string }[] = [];
    for (const [symbol, vTokenAddr] of Object.entries(VENUS_VTOKENS)) {
      try {
        const [balance, exchangeRate] = await Promise.all([
          client.readContract({ address: vTokenAddr as `0x${string}`, abi: VENUS_VTOKEN_ABI, functionName: 'balanceOf', args: [addr] }).catch(() => 0n),
          client.readContract({ address: vTokenAddr as `0x${string}`, abi: VENUS_VTOKEN_ABI, functionName: 'exchangeRateStored' }).catch(() => 0n),
        ]);
        const supplied = (BigInt(balance) * BigInt(exchangeRate)) / 10n ** 18n;
        if (supplied > 0n) {
          venusPositions.push({ protocol: 'venus', token: symbol.replace('v', ''), supplied: formatUnits(supplied, 18), borrowed: '0' });
        }
      } catch { /* skip */ }
    }

    // Check Aave V3 positions
    let aavePosition: { protocol: string; collateral: string; debt: string; healthFactor: number } | null = null;
    try {
      const data = await client.readContract({
        address: AAVE_V3_POOL as `0x${string}`, abi: AAVE_ABI, functionName: 'getUserAccountData', args: [addr],
      }) as readonly [bigint, bigint, bigint, bigint, bigint, bigint];
      const [collateral, debt, , , , healthFactor] = data;
      if (collateral > 0n || debt > 0n) {
        aavePosition = { protocol: 'aave', collateral: formatUnits(collateral, 8), debt: formatUnits(debt, 8), healthFactor: Number(healthFactor) / 1e27 };
      }
    } catch { /* no position */ }

    // Check PancakeSwap LP positions
    let lpCount = 0;
    try {
      const nftBalance = await client.readContract({ address: PANCAKE_POSITION_MANAGER as `0x${string}`, abi: NFT_ABI, functionName: 'balanceOf', args: [addr] }) as bigint;
      lpCount = Number(nftBalance);
    } catch { /* no position */ }

    const bnb = formatUnits(bnbRaw, 18);
    const usdt = formatUnits(usdtRaw as bigint, 18);
    const usdc = formatUnits(usdcRaw as bigint, 18);

    return NextResponse.json({
      ok: true,
      address,
      bnb, usdt, usdc,
      bnbPrice,
      usdTotal: (parseFloat(bnb) * bnbPrice) + parseFloat(usdt) + parseFloat(usdc),
      venus: venusPositions.length > 0 ? venusPositions : null,
      aave: aavePosition,
      pancakeswapLpCount: lpCount,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('wallet_balance_error', { error: message });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}