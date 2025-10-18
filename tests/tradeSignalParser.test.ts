import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { parseTradeSignal, TradeSignalParseError } from "../src/trading/tradeSignalParser.js";

describe("parseTradeSignal", () => {
  it("parses a well structured signal", () => {
    const signal = parseTradeSignal(
      "Long BTC 0.75 entry 63000 stop 61500 take profit 64000 tp2 65000",
    );

    expect(signal.side).toBe("long");
    expect(signal.symbol).toBe("BTC");
    expect(signal.size).toBeCloseTo(0.75);
    expect(signal.entryPrice).toBeCloseTo(63000);
    expect(signal.stopLoss).toBeCloseTo(61500);
    expect(signal.stopLosses).toHaveLength(1);
    expect(signal.stopLosses[0]).toMatchObject({ price: 61500, sizeFraction: undefined });
    expect(signal.takeProfits.map((tp) => tp.price)).toEqual([64000, 65000]);
    expect(signal.execution).toBe("limit");
    expect(signal.entryStrategy.type).toBe("single");
  });

  it("detects market order when entry is missing", () => {
    const signal = parseTradeSignal(
      "short eth size=2 stop 3200 tp1 3000 tp2 2900 market",
    );
    expect(signal.side).toBe("short");
    expect(signal.symbol).toBe("ETH");
    expect(signal.execution).toBe("market");
    expect(signal.entryPrice).toBeUndefined();
    expect(signal.takeProfits.map((tp) => tp.price)).toEqual([3000, 2900]);
  });

  it("supports @ notation and comma decimals", () => {
    const signal = parseTradeSignal("Buy SOL @150.5 size 10 stoploss 140,2 tp 160 tp2 170");
    expect(signal.entryPrice).toBeCloseTo(150.5);
    expect(signal.size).toBeCloseTo(10);
    expect(signal.stopLoss).toBeCloseTo(140.2);
    expect(signal.stopLosses[0].price).toBeCloseTo(140.2);
  });

  it("parses signals with currency symbols and bullet formatting", () => {
    const signal = parseTradeSignal(`Trade 1

👀 Open Long Tracked Trade

🟩 SUI (https://trysuper.co/trade/SUI)

Titan Vault (https://www.trysuper.co/trader/0x4b0eab9444a75a03f1ef340c8beac737afa5ab09) Open Long
• Amount: 33.5 SUI ($84.13)
• Price: $2.51130
• Stop: $2.40
• TP1: $2.60
• TP2: $2.70
• Leverage: 10x
• Margin Utilization: 0.10%`);

    expect(signal.side).toBe("long");
    expect(signal.symbol).toBe("SUI");
    expect(signal.size).toBeCloseTo(33.5);
    expect(signal.entryPrice).toBeCloseTo(2.5113);
    expect(signal.stopLoss).toBeCloseTo(2.4);
    expect(signal.stopLosses[0].price).toBeCloseTo(2.4);
    expect(signal.takeProfits.map((tp) => tp.price)).toEqual([2.6, 2.7]);
    expect(signal.leverage).toBeCloseTo(10);
  });

  it("throws when stop loss missing", () => {
    expect(() => parseTradeSignal("Long BTC 1 take profit 66000")).toThrow(
      TradeSignalParseError,
    );
  });

  it("parses trailing stop expressed in percent", () => {
    const signal = parseTradeSignal(
      "Long BTC 2 entry 60000 tp1 62000 tp2 63000 trailing stop 0.75%",
    );

    expect(signal.trailingStop).toEqual({
      mode: "percent",
      value: 0.75,
    });
    expect(signal.stopLoss).toBeUndefined();
    expect(signal.stopLosses).toHaveLength(0);
  });

  it("parses grid entry strategy with absolute spacing", () => {
    const signal = parseTradeSignal(
      "Long BTC 3 entry 60000 stop 58500 tp 62500 grid 3 150",
    );

    expect(signal.entryStrategy).toEqual({
      type: "grid",
      levels: 3,
      spacing: {
        mode: "absolute",
        value: 150,
      },
    });
  });

  it("parses trailing entry strategy with percent spacing", () => {
    const signal = parseTradeSignal(
      "Short ETH size 5 entry 3200 stop 3350 tp 3000 trail entry 4 0.5%",
    );

    expect(signal.entryStrategy).toEqual({
      type: "trailing",
      levels: 4,
      step: {
        mode: "percent",
        value: 0.5,
      },
    });
  });

  it("parses partial stop allocations with labels", () => {
    const signal = parseTradeSignal(
      "Long BTC 1 entry 63000 sl1 62000 50% sl2 61500 50 percent tp1 64000 tp2 65000",
    );

    expect(signal.stopLosses).toHaveLength(2);
    expect(signal.stopLosses[0].label).toBe("sl1");
    expect(signal.stopLosses[0].price).toBeCloseTo(62000);
    expect(signal.stopLosses[0].sizeFraction).toBeCloseTo(0.5, 5);
    expect(signal.stopLosses[1].label).toBe("sl2");
    expect(signal.stopLosses[1].price).toBeCloseTo(61500);
    expect(signal.stopLosses[1].sizeFraction).toBeCloseTo(0.5, 5);
    expect(signal.takeProfits.map((tp) => tp.price)).toEqual([64000, 65000]);
  });

  it("captures risk labels and timeframe hints", () => {
    const signal = parseTradeSignal(
      "Short SOL size 2 entry 180 intraday timeFrame 4H stop 200 tp1 150 tp2 130 risk aggressive",
    );

    expect(signal.riskLabel).toBe("high");
    expect(signal.timeframeHints).toContain("4h");
    expect(signal.timeframeHints).toContain("intraday");
  });

  it("collects multiple timeframe tokens", () => {
    const signal = parseTradeSignal(
      "Long ETH size 3 entry 3000 stop 2800 tp1 3200 tp2 3300 scalp tf 15m weekly outlook",
    );

    expect(signal.timeframeHints).toEqual(expect.arrayContaining(["15m", "scalp", "1w"]));
  });

  it("extracts take profit fractions from inline percents", () => {
    const signal = parseTradeSignal(
      "Long BTC size 1 entry 60000 stop 58000 tp1 62000 30% tp2 64000 70pct",
    );

    expect(signal.takeProfits[0].price).toBeCloseTo(62000);
    expect(signal.takeProfits[0].sizeFraction).toBeCloseTo(0.3, 5);
    expect(signal.takeProfits[1].price).toBeCloseTo(64000);
    expect(signal.takeProfits[1].sizeFraction).toBeCloseTo(0.7, 5);
  });

  it("supports property based take profit fraction parsing", () => {
    const takeProfitArb = fc
      .array(
        fc.record({
          offset: fc.integer({ min: 1, max: 8 }),
          percent: fc.integer({ min: 10, max: 40 }),
        }),
        { minLength: 1, maxLength: 3 },
      )
      .filter((levels) => levels.reduce((sum, level) => sum + level.percent, 0) <= 95);

    fc.assert(
      fc.property(takeProfitArb, (levels) => {
        const baseEntry = 1000;
        const stopPrice = 900;
        const fragments = levels
          .map(
            (level, index) =>
              `tp${index + 1} ${baseEntry + level.offset * 10} ${level.percent.toFixed(0)}%`,
          )
          .join(" ");
        const text = `Long BTC size 2 entry ${baseEntry} stop ${stopPrice} ${fragments}`;
        const signal = parseTradeSignal(text);
        expect(signal.takeProfits).toHaveLength(levels.length);
        levels.forEach((level, index) => {
          expect(signal.takeProfits[index].sizeFraction).toBeCloseTo(level.percent / 100, 6);
        });
      }),
    );
  });
});
