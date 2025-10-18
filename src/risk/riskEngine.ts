import type { TradeSignal } from "../trading/tradeSignalParser.js";
import type { ExecutionMetrics } from "../telemetry/executionLogger.js";

export interface RiskLimits {
  readonly maxLeverage?: number;
  readonly maxTradeNotionalUsd?: number;
  readonly maxTradeRiskUsd?: number;
  readonly maxDailyLossUsd?: number;
  readonly maxDailyVolumeUsd?: number;
}

export interface RiskEngineOptions {
  readonly limits: RiskLimits;
  readonly warningThreshold?: number;
  readonly metricsProvider: () => Promise<ExecutionMetrics>;
}

export interface RiskEvaluationContext {
  readonly entryPrice: number;
  readonly midPrice: number;
  readonly notionalUsd: number;
  readonly leverage?: number;
  readonly estimatedRiskUsd?: number;
  readonly timestamp?: number;
  readonly demoMode: boolean;
}

export interface RiskUsageSnapshot {
  readonly leverage?: { readonly value: number; readonly limit?: number };
  readonly notionalUsd?: { readonly value: number; readonly limit?: number };
  readonly riskUsd?: { readonly value: number; readonly limit?: number };
  readonly dailyLossUsd?: { readonly value: number; readonly limit?: number };
  readonly dailyVolumeUsd?: { readonly value: number; readonly limit?: number };
}

export interface RiskCheckResult {
  readonly passed: boolean;
  readonly reasons: readonly string[];
  readonly warnings: readonly string[];
  readonly usage: RiskUsageSnapshot;
  readonly metrics: ExecutionMetrics | null;
  readonly timestamp: number;
}

const DEFAULT_WARNING_THRESHOLD = 0.8;

function ratio(value: number, limit: number | undefined): number {
  if (!(limit && limit > 0)) {
    return 0;
  }
  return value / limit;
}

export class RiskEngine {
  private readonly limits: RiskLimits;
  private readonly warningThreshold: number;
  private readonly metricsProvider: () => Promise<ExecutionMetrics>;

  constructor(options: RiskEngineOptions) {
    this.limits = options.limits;
    this.warningThreshold = options.warningThreshold ?? DEFAULT_WARNING_THRESHOLD;
    this.metricsProvider = options.metricsProvider;
  }

  async evaluate(signal: TradeSignal, context: RiskEvaluationContext): Promise<RiskCheckResult> {
    const metrics = await this.safeLoadMetrics();
    const reasons: string[] = [];
    const warnings: string[] = [];

    const leverage = context.leverage ?? signal.leverage ?? 1;
    const usage: RiskUsageSnapshot = {
      leverage: { value: leverage, limit: this.limits.maxLeverage },
      notionalUsd: { value: context.notionalUsd, limit: this.limits.maxTradeNotionalUsd },
      riskUsd: context.estimatedRiskUsd
        ? { value: context.estimatedRiskUsd, limit: this.limits.maxTradeRiskUsd }
        : undefined,
      dailyLossUsd: metrics
        ? {
            value: metrics.totals.dailyLossUsd + Math.max(context.estimatedRiskUsd ?? 0, 0),
            limit: this.limits.maxDailyLossUsd,
          }
        : undefined,
      dailyVolumeUsd: metrics
        ? {
            value: metrics.totals.dailyVolumeUsd + context.notionalUsd,
            limit: this.limits.maxDailyVolumeUsd,
          }
        : undefined,
    };

    if (this.limits.maxLeverage && leverage > this.limits.maxLeverage) {
      reasons.push(`Leverage ${leverage.toFixed(2)} exceeds limit ${this.limits.maxLeverage}`);
    } else if (this.limits.maxLeverage && ratio(leverage, this.limits.maxLeverage) >= this.warningThreshold) {
      warnings.push(
        `Leverage ${leverage.toFixed(2)} is approaching configured limit ${this.limits.maxLeverage}`,
      );
    }

    if (this.limits.maxTradeNotionalUsd && context.notionalUsd > this.limits.maxTradeNotionalUsd) {
      reasons.push(
        `Notional $${context.notionalUsd.toFixed(2)} exceeds per-trade cap $${this.limits.maxTradeNotionalUsd.toFixed(2)}`,
      );
    } else if (
      this.limits.maxTradeNotionalUsd &&
      ratio(context.notionalUsd, this.limits.maxTradeNotionalUsd) >= this.warningThreshold
    ) {
      warnings.push(
        `Notional $${context.notionalUsd.toFixed(2)} is nearing cap $${this.limits.maxTradeNotionalUsd.toFixed(2)}`,
      );
    }

    if (
      this.limits.maxTradeRiskUsd &&
      context.estimatedRiskUsd !== undefined &&
      context.estimatedRiskUsd > this.limits.maxTradeRiskUsd
    ) {
      reasons.push(
        `Risk ${context.estimatedRiskUsd.toFixed(2)} USD exceeds stop-loss allowance ${this.limits.maxTradeRiskUsd.toFixed(2)} USD`,
      );
    } else if (
      this.limits.maxTradeRiskUsd &&
      context.estimatedRiskUsd !== undefined &&
      ratio(context.estimatedRiskUsd, this.limits.maxTradeRiskUsd) >= this.warningThreshold
    ) {
      warnings.push(
        `Risk ${context.estimatedRiskUsd.toFixed(2)} USD is close to limit ${this.limits.maxTradeRiskUsd.toFixed(2)} USD`,
      );
    }

    if (
      this.limits.maxDailyVolumeUsd &&
      metrics &&
      usage.dailyVolumeUsd &&
      usage.dailyVolumeUsd.value > this.limits.maxDailyVolumeUsd
    ) {
      reasons.push(
        `Daily volume ${usage.dailyVolumeUsd.value.toFixed(2)} USD exceeds cap ${this.limits.maxDailyVolumeUsd.toFixed(2)} USD`,
      );
    } else if (
      this.limits.maxDailyVolumeUsd &&
      usage.dailyVolumeUsd &&
      ratio(usage.dailyVolumeUsd.value, this.limits.maxDailyVolumeUsd) >= this.warningThreshold
    ) {
      warnings.push(
        `Daily volume ${usage.dailyVolumeUsd.value.toFixed(2)} USD is approaching cap ${this.limits.maxDailyVolumeUsd.toFixed(2)} USD`,
      );
    }

    if (
      this.limits.maxDailyLossUsd &&
      metrics &&
      usage.dailyLossUsd &&
      usage.dailyLossUsd.value > this.limits.maxDailyLossUsd
    ) {
      reasons.push(
        `Projected daily loss ${usage.dailyLossUsd.value.toFixed(2)} USD exceeds limit ${this.limits.maxDailyLossUsd.toFixed(2)} USD`,
      );
    } else if (
      this.limits.maxDailyLossUsd &&
      usage.dailyLossUsd &&
      ratio(usage.dailyLossUsd.value, this.limits.maxDailyLossUsd) >= this.warningThreshold
    ) {
      warnings.push(
        `Projected daily loss ${usage.dailyLossUsd.value.toFixed(2)} USD is nearing limit ${this.limits.maxDailyLossUsd.toFixed(2)} USD`,
      );
    }

    const passed = reasons.length === 0;
    return {
      passed,
      reasons,
      warnings,
      usage,
      metrics,
      timestamp: context.timestamp ?? Date.now(),
    } satisfies RiskCheckResult;
  }

  private async safeLoadMetrics(): Promise<ExecutionMetrics | null> {
    try {
      return await this.metricsProvider();
    } catch (error) {
      console.warn("[risk] Unable to load telemetry metrics for risk evaluation", error);
      return null;
    }
  }
}
