import { describe, expect, it } from "vitest";

import {
  buildRecommendations,
  type RecommendationHint,
} from "../src/insights/recommendationService.js";
import { SimulatedMarketDataProvider } from "../src/services/recommendationService/marketData.js";

function toSnapshot(point: Awaited<ReturnType<SimulatedMarketDataProvider["getSnapshot"]>>) {
  if (!point) {
    return undefined;
  }
  return {
    price: point.price,
    atr: point.atr,
    volatility: point.volatility,
    liquidityScore: point.liquidityScore,
    fundingRate: point.fundingRate,
  };
}

describe("adaptive recommendation service", () => {
  it("enriches hints with KPI-driven insights", async () => {
    const provider = new SimulatedMarketDataProvider();
    const kpis = await provider.getKpis("SOL");
    const snapshot = await provider.getSnapshot("SOL");

    const response = buildRecommendations({
      text: "Long SOL size 5000 entry 150 stop 132 tp1 165",
      market: toSnapshot(snapshot),
      kpis: kpis
        ? {
            trendStrength: kpis.trendStrength,
            drawdownPercent: kpis.drawdownPercent,
            winRate: kpis.winRate,
            liquidityScore: kpis.liquidityScore,
            slippageBps: kpis.slippageBps,
          }
        : undefined,
    });

    const ids = new Set(response.hints.map((hint: RecommendationHint) => hint.id));
    expect(ids.has("drawdown-SOL")).toBe(true);
    expect(ids.has("winrate-SOL")).toBe(true);
    expect(ids.has("slippage-SOL")).toBe(true);
    expect(response.context.trendStrength).toBeCloseTo(kpis?.trendStrength ?? 0, 2);
    expect(response.context.drawdownPercent).toBeCloseTo(kpis?.drawdownPercent ?? 0, 2);
    expect(response.context.slippageBps).toBeCloseTo(kpis?.slippageBps ?? 0, 2);
  });

  it("falls back to simulated data when no explicit market is supplied", async () => {
    const provider = new SimulatedMarketDataProvider();
    const kpis = await provider.getKpis("BTC");

    const response = buildRecommendations({
      text: "Long BTC size 1 entry 62000 stop 60000 tp1 64000",
      market: undefined,
      kpis: kpis
        ? {
            trendStrength: kpis.trendStrength,
            drawdownPercent: kpis.drawdownPercent,
            winRate: kpis.winRate,
            liquidityScore: kpis.liquidityScore,
            slippageBps: kpis.slippageBps,
          }
        : undefined,
    });

    const ids = new Set(response.hints.map((hint) => hint.id));
    expect(ids.has("grid-BTC")).toBe(true);
    const drawdownHint = response.hints.find((hint) => hint.id.startsWith("drawdown-"));
    if (kpis && kpis.drawdownPercent > 12) {
      expect(drawdownHint).toBeDefined();
    }
    expect(response.hints.some((hint) => hint.id === "winrate-BTC")).toBe(true);
  });
});
