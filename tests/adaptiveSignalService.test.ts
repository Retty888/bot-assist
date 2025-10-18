import { describe, expect, it } from "vitest";

import { generateAdaptiveAdvice } from "../src/services/signalAdviser/index.js";
import { SimulatedMarketDataProvider } from "../src/services/recommendationService/marketData.js";

describe("signal adviser service integration", () => {
  it("produces adaptive advice when fed simulated market data", async () => {
    const provider = new SimulatedMarketDataProvider();
    const response = await generateAdaptiveAdvice({
      text: "Long SOL size 4000 entry 140 stop 125 tp1 155 risk high timeframe 30m",
      provider,
      options: { minLeverage: 1, maxLeverage: 15 },
    });

    expect(response.advice.kpis).toBeDefined();
    expect(response.advice.adaptiveAdjustments.length).toBeGreaterThan(0);
    expect(response.advice.notes.some((note) => note.includes("Risk score"))).toBe(true);
  });
});
