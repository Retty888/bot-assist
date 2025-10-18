import { describe, expect, it } from "vitest";

import { adviseWithAdaptiveRules, type MarketKpiSnapshot } from "../src/services/signalAdviser/index.js";
import { parseTradeSignal } from "../src/trading/tradeSignalParser.js";

const baseHighRiskSignal = parseTradeSignal(
  "Long BTC size 2 entry 62000 stop 60000 tp1 64000 leverage 12 risk extreme timeframe 5m",
);

const baseLowRiskSignal = parseTradeSignal(
  "Long ETH size 3 entry 3000 stop 2850 tp1 3200 tp2 3300 leverage 2 risk low timeframe 4h",
);

describe("adaptive signal adviser", () => {
  it("applies dynamic risk controls under stressed KPIs", () => {
    const kpis: MarketKpiSnapshot = {
      symbol: "BTC",
      timestamp: Date.now(),
      volatilityScore: 8.4,
      trendStrength: 0.4,
      drawdownPercent: 27.5,
      winRate: 0.44,
      liquidityScore: 95,
      slippageBps: 142,
    };

    const advice = adviseWithAdaptiveRules(baseHighRiskSignal, { minLeverage: 1, maxLeverage: 25 }, kpis);

    expect(advice.recommendedLeverage).toBeLessThan(12);
    expect(advice.execution).toBe("limit");
    expect(advice.hardRules.some((rule) => rule.id === "extreme-risk-limit-order" && rule.triggered)).toBe(true);
    expect(advice.adaptiveAdjustments.some((adjustment) => adjustment.id === "dynamic-risk-threshold" && adjustment.applied)).toBe(
      true,
    );
    const liquidityGuard = advice.adaptiveAdjustments.find((adjustment) => adjustment.id === "liquidity-guard");
    expect(liquidityGuard).toBeDefined();
    expect(advice.riskScore).toBeGreaterThan(0.55);
  });

  it("boosts leverage and favours momentum entries when KPIs are strong", () => {
    const kpis: MarketKpiSnapshot = {
      symbol: "ETH",
      timestamp: Date.now(),
      volatilityScore: 3.2,
      trendStrength: 0.82,
      drawdownPercent: 6.5,
      winRate: 0.71,
      liquidityScore: 480,
      slippageBps: 35,
    };

    const advice = adviseWithAdaptiveRules(baseLowRiskSignal, { minLeverage: 1, maxLeverage: 12 }, kpis);

    expect(advice.recommendedLeverage).toBeGreaterThan(baseLowRiskSignal.leverage ?? 0);
    expect(advice.execution).toBe("market");
    expect(advice.entryStrategy.type).toBe("trailing");
    expect(advice.adaptiveAdjustments.some((adjustment) => adjustment.id === "performance-bonus" && adjustment.applied)).toBe(true);
    expect(advice.adaptiveAdjustments.some((adjustment) => adjustment.id === "trend-urgency" && adjustment.applied)).toBe(true);
    expect(advice.riskScore).toBeLessThan(0.35);
  });
});
