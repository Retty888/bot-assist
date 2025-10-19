import { bench, describe, it } from "vitest";

import { parseTradeSignal } from "../src/trading/tradeSignalParser.js";

const baseSignals = [
  "Long BTC size 1.25 entry 63000 stop 61500 tp1 64000 tp2 65000",
  "Short ETH size:2.5 entry@2000 stoploss1 2100 50% stoploss2 2150 50% take profit1 1900 take profit2 1850 risk high timeframe 4h",
  "Buy SOL @150.5 size 10 stoploss 140.2 tp1 160 tp2 170 leverage 5x trail entry 3 0.5%",
  "Sell ADA size 5000 stop 0.48 tp 0.42 tp2 0.4 grid 4 0.02",
  "Long XRP size=750 entry=0.62 sl1 0.58 sl2 0.56 tp1 0.65 tp2 0.68 tp3 0.7 timeframe 45 minutes",
];

function buildDataset(multiplier: number): string[] {
  return Array.from({ length: baseSignals.length * multiplier }, (_, index) =>
    baseSignals[index % baseSignals.length],
  );
}

const shouldRunBenchmark = process.env.RUN_PARSER_BENCHMARK === "true";

describe("trade signal parser benchmark", () => {
  const dataset = buildDataset(200);

  if (shouldRunBenchmark) {
    bench("parse large dataset", () => {
      for (const text of dataset) {
        parseTradeSignal(text);
      }
    });
  } else {
    it.skip("parse large dataset (benchmark only)", () => {
      /* intentionally skipped outside benchmark mode */
    });
  }
});
