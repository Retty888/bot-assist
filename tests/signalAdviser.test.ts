import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { adviseSignal } from "../src/trading/signalAdviser.js";
import { parseTradeSignal, type TradeSignal } from "../src/trading/tradeSignalParser.js";

const baseSignal: TradeSignal = parseTradeSignal(
  "Long BTC size 1 entry 100 stop 90 tp1 120 tp2 130",
);

describe("signal adviser", () => {
  it("reduces leverage and enables trailing entries for short timeframes", () => {
    const signal: TradeSignal = {
      ...baseSignal,
      leverage: 10,
      riskLabel: "high",
      timeframeHints: ["15m"],
    };

    const advice = adviseSignal(signal, { minLeverage: 2, maxLeverage: 20 });

    expect(advice.recommendedLeverage).toBeLessThan(10);
    expect(advice.execution).toBe("market");
    expect(advice.entryStrategy.type).toBe("trailing");
    expect(advice.adjustedSignal.entryStrategy.type).toBe("trailing");
    expect(advice.notes.length).toBeGreaterThan(0);
  });

  it("boosts leverage and prefers grid entries on swing trades", () => {
    const swingSignal: TradeSignal = {
      ...baseSignal,
      leverage: 3,
      takeProfits: [
        { price: 120 },
        { price: 130 },
        { price: 140 },
      ],
      timeframeHints: ["1d"],
      riskLabel: "low",
    };

    const advice = adviseSignal(swingSignal, { minLeverage: 1, maxLeverage: 25 });

    expect(advice.recommendedLeverage).toBeGreaterThan(3);
    expect(advice.execution).toBe("limit");
    expect(advice.entryStrategy).toMatchObject({ type: "grid", levels: 3 });
  });

  it("keeps leverage inside provided bounds", () => {
    const mediumSignal: TradeSignal = {
      ...baseSignal,
      leverage: 5,
      riskLabel: "medium",
      timeframeHints: ["1h"],
    };

    fc.assert(
      fc.property(
        fc.double({ min: 1, max: 10 }),
        fc.double({ min: 5, max: 30 }),
        (minRaw, maxRaw) => {
          const normalizedMin = Number.isFinite(minRaw) && minRaw > 0 ? minRaw : 1;
          const normalizedMax = Number.isFinite(maxRaw) && maxRaw > 0 ? maxRaw : 25;
          const min = Math.min(normalizedMin, normalizedMax);
          const max = Math.max(normalizedMin, normalizedMax);
          const advice = adviseSignal(mediumSignal, { minLeverage: minRaw, maxLeverage: maxRaw });
          expect(Number.isFinite(advice.recommendedLeverage)).toBe(true);
          expect(advice.recommendedLeverage + 0.02).toBeGreaterThanOrEqual(min);
          expect(advice.recommendedLeverage - 0.02).toBeLessThanOrEqual(max);
        },
      ),
    );
  });

  it("falls back to sane leverage bounds when provided with invalid ones", () => {
    const signal: TradeSignal = {
      ...baseSignal,
      leverage: 8,
      riskLabel: "low",
    };

    const advice = adviseSignal(signal, {
      minLeverage: Number.NaN,
      maxLeverage: Number.POSITIVE_INFINITY,
    });

    expect(advice.recommendedLeverage).toBeGreaterThanOrEqual(1);
    expect(advice.recommendedLeverage).toBeLessThanOrEqual(25);
    expect(Number.isFinite(advice.recommendedLeverage)).toBe(true);
  });
});
