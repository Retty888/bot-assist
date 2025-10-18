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
    expect(signal.takeProfits).toEqual([64000, 65000]);
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
    expect(signal.takeProfits).toEqual([3000, 2900]);
  });

  it("supports @ notation and comma decimals", () => {
    const signal = parseTradeSignal("Buy SOL @150.5 size 10 stoploss 140,2 tp 160 tp2 170");
    expect(signal.entryPrice).toBeCloseTo(150.5);
    expect(signal.size).toBeCloseTo(10);
    expect(signal.stopLoss).toBeCloseTo(140.2);
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
    expect(signal.takeProfits).toEqual([2.6, 2.7]);
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
});
