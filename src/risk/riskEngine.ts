import { ExecutionLogger, type ExecutionMetricsSnapshot } from "../telemetry/executionLogger.js";
import type { ExecutionMode } from "../storage/historyStore.js";
import type { TradeSignal } from "../trading/tradeSignalParser.js";
import { computeNotionalUsd, estimateLeverage, estimateMaxRiskUsd, resolveEntryPrice } from "../trading/executionMath.js";
import type { RiskViolation } from "./types.js";
import type { OrderParameters } from "@nktkas/hyperliquid";

export interface RiskEngineConfig {
  readonly accountEquityUsd: number;
  readonly maxLeverage?: number;
  readonly maxPositionNotionalUsd?: number;
  readonly maxPositionRiskUsd?: number;
  readonly dailyLossLimitUsd?: number;
  readonly dailyTradeCountLimit?: number;
  readonly dailyNotionalLimitUsd?: number;
}

export interface RiskContext {
  readonly signal: TradeSignal;
  readonly payload: OrderParameters;
  readonly mode: ExecutionMode;
  readonly entryPriceUsd?: number;
  readonly notionalUsd?: number;
  readonly leverage?: number;
  readonly estimatedRiskUsd?: number;
}

export interface RiskAssessment {
  readonly allowed: boolean;
  readonly violations: readonly RiskViolation[];
  readonly metrics?: ExecutionMetricsSnapshot["daily"];
}

export interface RiskSnapshot {
  readonly limits: RiskEngineConfig;
  readonly daily?: ExecutionMetricsSnapshot["daily"];
}

export class RiskEngine {
  constructor(private readonly config: RiskEngineConfig, private readonly logger?: ExecutionLogger) {}

  getConfig(): RiskEngineConfig {
    return this.config;
  }

  async evaluate(context: RiskContext): Promise<RiskAssessment> {
    const violations: RiskViolation[] = [];
    const metrics = this.logger ? await this.logger.getMetrics() : undefined;
    const daily = metrics?.daily;

    const entryPrice = context.entryPriceUsd ?? resolveEntryPrice(context.signal, context.payload);
    const notionalUsd = context.notionalUsd ?? computeNotionalUsd(context.signal.size, entryPrice);
    const estimatedRiskUsd =
      context.estimatedRiskUsd ?? estimateMaxRiskUsd(context.signal, entryPrice);
    const leverage =
      context.leverage ?? estimateLeverage(notionalUsd, this.config.accountEquityUsd);

    if (this.config.maxPositionNotionalUsd && notionalUsd && notionalUsd > this.config.maxPositionNotionalUsd) {
      violations.push({
        code: "position-notional",
        message: `Notional ${notionalUsd.toFixed(2)} exceeds limit`,
        observed: notionalUsd,
        limit: this.config.maxPositionNotionalUsd,
      });
    }

    if (this.config.maxPositionRiskUsd && estimatedRiskUsd && estimatedRiskUsd > this.config.maxPositionRiskUsd) {
      violations.push({
        code: "position-risk",
        message: `Risk ${estimatedRiskUsd.toFixed(2)} exceeds limit`,
        observed: estimatedRiskUsd,
        limit: this.config.maxPositionRiskUsd,
      });
    }

    if (this.config.maxLeverage && leverage && leverage > this.config.maxLeverage) {
      violations.push({
        code: "leverage",
        message: `Leverage ${leverage.toFixed(2)} exceeds limit`,
        observed: leverage,
        limit: this.config.maxLeverage,
      });
    }

    if (daily) {
      if (this.config.dailyTradeCountLimit && daily.trades + 1 > this.config.dailyTradeCountLimit) {
        violations.push({
          code: "daily-trades",
          message: `Daily trade limit reached (${daily.trades})`,
          observed: daily.trades + 1,
          limit: this.config.dailyTradeCountLimit,
        });
      }
      if (
        this.config.dailyLossLimitUsd &&
        (daily.lossUsd + Math.max(estimatedRiskUsd ?? 0, 0) > this.config.dailyLossLimitUsd)
      ) {
        violations.push({
          code: "daily-loss",
          message: `Projected daily loss exceeds limit`,
          observed: daily.lossUsd + Math.max(estimatedRiskUsd ?? 0, 0),
          limit: this.config.dailyLossLimitUsd,
        });
      }
      if (
        this.config.dailyNotionalLimitUsd &&
        (daily.grossNotionalUsd + Math.max(notionalUsd ?? 0, 0) > this.config.dailyNotionalLimitUsd)
      ) {
        violations.push({
          code: "daily-notional",
          message: `Projected daily notional exceeds limit`,
          observed: daily.grossNotionalUsd + Math.max(notionalUsd ?? 0, 0),
          limit: this.config.dailyNotionalLimitUsd,
        });
      }
    }

    return {
      allowed: violations.length === 0,
      violations,
      metrics: daily,
    } satisfies RiskAssessment;
  }

  async describe(): Promise<RiskSnapshot> {
    const metrics = this.logger ? await this.logger.getMetrics() : undefined;
    return {
      limits: this.config,
      daily: metrics?.daily,
    } satisfies RiskSnapshot;
  }
}
