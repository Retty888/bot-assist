import { describe, expect, it } from 'vitest';

import type { ExecutionMetricsSnapshot } from '../src/telemetry/executionLogger.js';
import { ExecutionLogger } from '../src/telemetry/executionLogger.js';
import { RiskEngine } from '../src/risk/riskEngine.js';
import type { TradeSignal } from '../src/trading/tradeSignalParser.js';

const baseSignal: TradeSignal = {
  side: 'long',
  symbol: 'BTC',
  rawSymbol: 'BTC',
  size: 1,
  entryPrice: 100,
  stopLoss: 90,
  stopLosses: [],
  takeProfits: [{ price: 120 }],
  leverage: 2,
  execution: 'market',
  trailingStop: undefined,
  entryStrategy: { type: 'single' },
  riskLabel: 'medium',
  timeframeHints: [],
  text: 'Long BTC',
};

const noopPayload = { orders: [] } as unknown as Parameters<RiskEngine['evaluate']>[0]['payload'];

class StubLogger extends ExecutionLogger {
  constructor(private snapshot: ExecutionMetricsSnapshot) {
    super();
  }

  override async getMetrics(): Promise<ExecutionMetricsSnapshot> {
    return this.snapshot;
  }
}

describe('RiskEngine', () => {
  it('flags position notional above limit', async () => {
    const engine = new RiskEngine({ accountEquityUsd: 1_000, maxPositionNotionalUsd: 5_000 });
    const result = await engine.evaluate({
      signal: baseSignal,
      payload: noopPayload,
      mode: 'test',
      entryPriceUsd: 6_000,
      notionalUsd: 6_000,
    });
    expect(result.allowed).toBe(false);
    expect(result.violations[0]?.code).toBe('position-notional');
  });

  it('uses daily metrics from logger when enforcing trade limits', async () => {
    const snapshot: ExecutionMetricsSnapshot = {
      totals: {
        trades: 10,
        successes: 8,
        failures: 2,
        blocked: 0,
        winRate: 0.8,
        pnlUsd: 1_000,
        positivePnlUsd: 1_500,
        lossUsd: 500,
        grossNotionalUsd: 50_000,
        averageNotionalUsd: 5_000,
        averagePnlUsd: 100,
        averageRiskUsd: 200,
        maxRiskUsd: 500,
        averageLeverage: 2,
        maxLeverage: 4,
      },
      daily: {
        trades: 5,
        successes: 4,
        failures: 1,
        blocked: 0,
        winRate: 0.8,
        pnlUsd: 500,
        positivePnlUsd: 600,
        lossUsd: 100,
        grossNotionalUsd: 20_000,
        averageNotionalUsd: 4_000,
        averagePnlUsd: 100,
        averageRiskUsd: 150,
        maxRiskUsd: 300,
        averageLeverage: 2,
        maxLeverage: 3,
      },
      lastExecution: undefined,
    } satisfies ExecutionMetricsSnapshot;
    const logger = new StubLogger(snapshot);
    const engine = new RiskEngine(
      {
        accountEquityUsd: 1_000,
        dailyTradeCountLimit: 5,
        dailyLossLimitUsd: 200,
        dailyNotionalLimitUsd: 20_000,
      },
      logger,
    );
    const result = await engine.evaluate({
      signal: baseSignal,
      payload: noopPayload,
      mode: 'test',
      entryPriceUsd: 100,
      notionalUsd: 1_000,
      estimatedRiskUsd: 250,
    });
    const violationCodes = result.violations.map((item) => item.code);
    expect(violationCodes).toContain('daily-trades');
    expect(violationCodes).toContain('daily-loss');
    expect(violationCodes).toContain('daily-notional');
  });
});
