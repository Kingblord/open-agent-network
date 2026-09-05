/**
 * BAN Real Grid Swap E2E — Direct viem execution
 *
 * Altana relay is unreachable, so we execute directly with viem.
 * The agent wallet is real, the swaps are real BNB mainnet txs.
 *
 * Pipeline:
 *   1. Load existing keystore from Firestore
 *   2. Wrap BNB → WBNB (real tx)
 *   3. Approve PancakeSwap router (real tx)
 *   4. Swap WBNB → USDT via PancakeSwap (real tx)
 *   5. Verify receipt on BNB mainnet
 *
 * Run: cd apps/web && npx vitest run tests/grid-swap-e2e.test.ts
 */
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import * as dotenv from 'dotenv';
import {
  createPublicClient, createWalletClient, http,
  parseAbi, parseEther, formatEther, formatUnits,
  encodeFunctionData, maxUint256,
} from 'viem';
import { bsc } from 'viem/chains';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const RPC_URL = process.env.BAN_RPC_URL || 'https://bsc-dataseed.binance.org/';
const WBNB   = '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c';
const USDT   = '0x55d398326f99059fF775485246999027B3197955';
const ROUTER = '0x10ED43C718714eb63d5aA57B78B54704E256024E'; // PancakeSwap V2 Router

const WBNB_ABI   = parseAbi(['function deposit() payable','function balanceOf(address) view returns (uint256)','function approve(address,uint256) returns (bool)']);
const ERC20_ABI  = parseAbi(['function balanceOf(address) view returns (uint256)']);
const ROUTER_ABI = parseAbi(['function swapExactTokensForTokens(uint256,uint256,address[],address,uint256) returns (uint256[])']);

// Existing funded agent wallet (0.0005 BNB)
const AGENT_ID = 'ag_grid_1788487572820';

describe('BAN Real Grid Swap E2E', () => {
  it('wrap → approve → swap WBNB→USDT via PancakeSwap (real mainnet txs)', async () => {
    const publicClient = createPublicClient({ transport: http(RPC_URL) });

    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('  BAN GRID SWAP — REAL MAINNET PANCAKESWAP TXS');
    console.log('═══════════════════════════════════════════════════════════\n');

    // 1. Load existing keystore
    console.log('[1] Loading existing keystore...');
    const { loadAgentKeystore } = await import('@/lib/altana/keystore');
    const keystore = await loadAgentKeystore(AGENT_ID);
    if (!keystore) throw new Error(`No keystore for ${AGENT_ID}`);
    console.log(`[1] Wallet: ${keystore.walletAddress}`);

    const balance = await publicClient.getBalance({ address: keystore.walletAddress as `0x${string}` });
    console.log(`[1] Balance: ${formatEther(balance)} BNB`);
    expect(balance > parseEther('0.0001'), 'Need >0.0001 BNB').toBe(true);

    // 2. Create viem wallet client from agent's private key
    console.log('\n[2] Creating viem wallet client...');
    const account = await (await import('viem/accounts')).privateKeyToAccount(keystore.privateKey);
    const walletClient = createWalletClient({ account, chain: bsc, transport: http(RPC_URL) });
    console.log(`[2] Signing as: ${account.address}`);

    const swapAmt = parseEther('0.0002');

    // 3. Wrap BNB → WBNB (deposit)
    console.log(`\n[3] Wrapping ${formatEther(swapAmt)} BNB → WBNB...`);
    const wrapHash = await walletClient.sendTransaction({
      to: WBNB as `0x${string}`,
      value: swapAmt,
      data: encodeFunctionData({ abi: WBNB_ABI, functionName: 'deposit' }),
    });
    console.log(`[3] TX: ${wrapHash}`);
    const wrapReceipt = await publicClient.waitForTransactionReceipt({ hash: wrapHash });
    console.log(`[3] ✅ WRAP CONFIRMED block ${wrapReceipt.blockNumber} gas ${wrapReceipt.gasUsed}`);

    // 4. Approve PancakeSwap router to spend WBNB
    console.log('\n[4] Approving PancakeSwap router to spend WBNB...');
    const approveHash = await walletClient.sendTransaction({
      to: WBNB as `0x${string}`,
      data: encodeFunctionData({ abi: WBNB_ABI, functionName: 'approve', args: [ROUTER as `0x${string}`, maxUint256] }),
    });
    console.log(`[4] TX: ${approveHash}`);
    const approveReceipt = await publicClient.waitForTransactionReceipt({ hash: approveHash });
    console.log(`[4] ✅ APPROVE CONFIRMED block ${approveReceipt.blockNumber} gas ${approveReceipt.gasUsed}`);

    // 5. Swap WBNB → USDT via PancakeSwap V2
    console.log('\n[5] Swapping WBNB → USDT via PancakeSwap V2...');
    const swapHash = await walletClient.sendTransaction({
      to: ROUTER as `0x${string}`,
      gas: 200_000n,
      data: encodeFunctionData({
        abi: ROUTER_ABI,
        functionName: 'swapExactTokensForTokens',
        args: [
          swapAmt,
          0n, // amountOutMin = 0 for tiny test
          [WBNB as `0x${string}`, USDT as `0x${string}`],
          account.address,
          BigInt(Math.floor(Date.now() / 1000) + 600),
        ],
      }),
    });
    console.log(`[5] TX: ${swapHash}`);
    const swapReceipt = await publicClient.waitForTransactionReceipt({ hash: swapHash });
    console.log(`[5] ✅ SWAP CONFIRMED block ${swapReceipt.blockNumber} gas ${swapReceipt.gasUsed}`);

    // 6. Read final balances
    const finalBnb  = await publicClient.getBalance({ address: account.address });
    const wbnbBal   = await publicClient.readContract({ address: WBNB as `0x${string}`,  abi: WBNB_ABI,  functionName: 'balanceOf', args: [account.address] });
    const usdtBal   = await publicClient.readContract({ address: USDT as `0x${string}`,  abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address] });

    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('  BAN GRID SWAP — FINAL STATE');
    console.log('═══════════════════════════════════════════════════════════');
    console.log(`  Agent:    ${AGENT_ID}`);
    console.log(`  Wallet:   ${account.address}`);
    console.log(`  BNB:      ${formatEther(finalBnb)}`);
    console.log(`  WBNB:     ${formatUnits(wbnbBal, 18)}`);
    console.log(`  USDT:     ${formatUnits(usdtBal, 18)}`);
    console.log(`  Chain:    BNB Mainnet (56)`);
    console.log(`  Wrap:     https://bscscan.com/tx/${wrapHash}`);
    console.log(`  Approve:  https://bscscan.com/tx/${approveHash}`);
    console.log(`  Swap:     https://bscscan.com/tx/${swapHash}`);
    console.log('═══════════════════════════════════════════════════════════\n');

    expect(wrapReceipt.status).toBe('success');
    expect(approveReceipt.status).toBe('success');
    expect(swapReceipt.status).toBe('success');
    // After swap, agent should have USDT
    expect(usdtBal > 0n).toBe(true);
  }, 120_000);
});
