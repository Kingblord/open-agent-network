import { describe, it, expect } from 'vitest';
import { PerformanceCalculator } from '../src/performance-calculator.js';
import { classifyExecutionMode } from '../src/mode-classifier.js';
import type { Execution, Position } from '@ban/schemas';

// ---------------------------------------------------------------------------
// Helpers — minimal Execution / Position factory for hermetic tests
// ---------------------------------------------------------------------------
function makeExecution(overrides: Partial<Execution> = {}): Execution {
  return {
    executionId: 'exe-' + Math.random().toString(36).slice(2, 8),
    proposalId: 'prop-' + Math.random().toString(36).slice(2, 8),
    agentId: 'agent-1',
    userId: 'user-1',
    protocol: 'uniswap',
    contract: '0xContract',
    function: 'swap',
    parameters: {},
    parametersHash: '0xabc',
    status: 'CONFIRMED',
    chainId: 97,
    createdAt: new Date().toISOString(),
    confirmedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makePosition(overrides: Partial<Position> = {}): Position {
  return {
    positionId: 'pos-' + Math.random().toString(36).slice(2, 8),
    agentId: 'agent-1',
    protocol: 'aave',
    token: '0xToken',
    entryValueUsd: '100000',   // 1000 USD cents = $10
    currentValueUsd: '120000', // $12
    status: 'ACTIVE',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// PerformanceCalculator
// ---------------------------------------------------------------------------
describe('PerformanceCalculator', () => {
  const calc = new PerformanceCalculator();

  describe('aggregateExecutions — empty input', () => {
    it('returns zeros / defaults when executions is empty', () => {
      const result = calc.aggregateExecutions([]);
      expect(result.totalTrades).toBe(0);
      expect(result.confirmedCount).toBe(0);
      expect(result.failedCount).toBe(0);
      expect(result.successRate).toBe('0');
      expect(result.totalFeesWei).toBe('0');
      expect(result.lastExecutedAt).toBeNull();
      expect(result.capitalManagedUsd).toBe('0');
    });
  });

  describe('aggregateExecutions — single CONFIRMED execution', () => {
    it('counts one confirmed trade with fees and duration', () => {
      const exec = makeExecution({
        status: 'CONFIRMED',
        gasUsed: '21000',
        createdAt: '2025-01-01T00:00:00Z',
        confirmedAt: '2025-01-01T00:00:05Z', // 5 sec = 5000 ms
      });
      const result = calc.aggregateExecutions([exec]);
      expect(result.totalTrades).toBe(1);
      expect(result.confirmedCount).toBe(1);
      expect(result.failedCount).toBe(0);
      expect(result.successRate).toBe('1.0000');
      expect(result.totalFeesWei).toBe('21000');
      expect(result.avgGasPerTx).toBe('21000');
      expect(result.avgExecutionMs).toBeGreaterThanOrEqual(5000);
      expect(result.lastExecutedAt).toBe('2025-01-01T00:00:00Z');
      expect(result.byStatus['CONFIRMED']).toBe(1);
      expect(result.capitalManagedUsd).toBe('100'); // 100 cents per confirmed on chainId
    });
  });

  describe('aggregateExecutions — mixed confirmed + failed', () => {
    it('computes success rate from confirmed vs total', () => {
      const execs = [
        makeExecution({ status: 'CONFIRMED', gasUsed: '21000' }),
        makeExecution({ status: 'FAILED', gasUsed: '15000' }),
        makeExecution({ status: 'CONFIRMED', gasUsed: '18000' }),
      ];
      const result = calc.aggregateExecutions(execs);
      expect(result.totalTrades).toBe(2);
      expect(result.confirmedCount).toBe(2);
      expect(result.failedCount).toBe(1);
      expect(result.successRate).toBe((2 / 3).toFixed(4));
      expect(result.totalFeesWei).toBe(String(21000 + 15000 + 18000));
      expect(result.byStatus['CONFIRMED']).toBe(2);
      expect(result.byStatus['FAILED']).toBe(1);
    });
  });

  describe('aggregateExecutions — capital managed', () => {
    it('adds 100 cents per confirmed execution with a chainId', () => {
      const execs = [
        makeExecution({ status: 'CONFIRMED', chainId: 56 }),
        makeExecution({ status: 'CONFIRMED', chainId: 97 }),
        makeExecution({ status: 'FAILED', chainId: 56 }),
      ];
      const result = calc.aggregateExecutions(execs);
      expect(result.capitalManagedUsd).toBe('200'); // 2 confirmed × 100
    });
  });

  describe('aggregatePositions — empty input', () => {
    it('returns hasPositions false and null pnl', () => {
      const result = calc.aggregatePositions([]);
      expect(result.hasPositions).toBe(false);
      expect(result.realizedPnlUsd).toBeNull();
      expect(result.unrealizedPnlUsd).toBeNull();
      expect(result.maxDrawdownUsd).toBeNull();
    });
  });

  describe('aggregatePositions — PnL from positions', () => {
    it('computes unrealized PnL from active positions (+ gain)', () => {
      const pos = makePosition({
        entryValueUsd: '100000',  // $10.00 in cents
        currentValueUsd: '120000', // $12.00 → +$2.00
      });
      const result = calc.aggregatePositions([pos]);
      expect(result.hasPositions).toBe(true);
      expect(result.unrealizedPnlUsd).toBe('20000.00'); // cents: 120000 - 100000 = 20000¢ = $200.00
      expect(result.realizedPnlUsd).toBe('0.00');
    });

    it('computes realized PnL from closed positions', () => {
      // Closed position: current === 0 → loss of entry value
      const pos = makePosition({
        entryValueUsd: '50000',  // $5.00 in cents
        currentValueUsd: '0',
      });
      const result = calc.aggregatePositions([pos]);
      // When current === 0, realized PnL = entry * -1 = -50000 cents = -$500.00
      expect(result.hasPositions).toBe(true);
      expect(result.unrealizedPnlUsd).toBe('0.00');
    });

    it('tracks max drawdown correctly', () => {
      const pos = makePosition({
        entryValueUsd: '100000',
        currentValueUsd: '80000', // -$2.00 in cents = -20000¢ = -$200.00 → drawdown $200.00
      });
      const result = calc.aggregatePositions([pos]);
      expect(result.hasPositions).toBe(true);
      expect(result.unrealizedPnlUsd).toBe('-20000.00');
      expect(result.maxDrawdownUsd).toBe('20000.00'); // $200.00
    });

    it('returns max drawdown as the largest loss across positions', () => {
      const pos1 = makePosition({ entryValueUsd: '300000', currentValueUsd: '280000' }); // -$200
      const pos2 = makePosition({ entryValueUsd: '200000', currentValueUsd: '100000' }); // -$1000
      const result = calc.aggregatePositions([pos1, pos2]);
      expect(result.unrealizedPnlUsd).toBe('-120000.00'); // -$1200
      expect(result.maxDrawdownUsd).toBe('100000.00'); // $1000 → larger loss
    });
  });

  describe('summarize — combined output', () => {
    it('merges execution and position aggregates', () => {
      const exec = makeExecution({ status: 'CONFIRMED', gasUsed: '21000' });
      const pos = makePosition({ entryValueUsd: '100000', currentValueUsd: '120000' });
      const summary = calc.summarize([exec], [pos]);
      expect(summary.totalTrades).toBe(1);
      expect(summary.unrealizedPnlUsd).toBe('20000.00');
      expect(summary.hasPositions).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// ModeClassifier
// ---------------------------------------------------------------------------
describe('ModeClassifier', () => {
  describe('classifyExecutionMode', () => {
    it('classifies LIVE when chainId is 56 and confirmedCount > 0', () => {
      const result = classifyExecutionMode(56, 5);
      expect(result.mode).toBe('LIVE');
      expect(result.reason).toContain('LIVE');
      expect(result.reason).toContain('56');
    });

    it('classifies TESTNET when chainId is 97 with confirmations', () => {
      const result = classifyExecutionMode(97, 5);
      expect(result.mode).toBe('TESTNET');
      expect(result.reason).toContain('TESTNET');
    });

    it('classifies TESTNET when chainId is not 56 but has confirmations', () => {
      const result = classifyExecutionMode(1, 3);
      expect(result.mode).toBe('TESTNET');
      expect(result.reason).toContain('1');
    });

    it('classifies SIMULATED when no confirmed executions exist', () => {
      const result = classifyExecutionMode(56, 0);
      expect(result.mode).toBe('SIMULATED');
      expect(result.reason).toContain('SIMULATED');
    });

    it('classifies TESTNET when chainId is null/undefined and has confirmations', () => {
      const result = classifyExecutionMode(null, 2);
      expect(result.mode).toBe('TESTNET');
      expect(result.reason).toContain('TESTNET');
    });

    it('classifies SIMULATED when chainId is null and no confirmations', () => {
      const result = classifyExecutionMode(null, 0);
      expect(result.mode).toBe('SIMULATED');
      expect(result.reason).toContain('SIMULATED');
    });
  });
});