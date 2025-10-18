import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const PRICE_FACTOR = 1_000_000;

function round(value: number): number {
  return Math.round(value * PRICE_FACTOR) / PRICE_FACTOR;
}

async function loadStore() {
  vi.resetModules();
  return import("../src/storage/candlesStore.js");
}

describe("candlesStore", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "candles-store-"));
    process.env.BOT_DATA_DIR = path.join(tempDir, "data");
  });

  afterEach(async () => {
    delete process.env.BOT_DATA_DIR;
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("persists candles and merges overlapping timestamps", async () => {
    const { saveCandles, loadCandles, getLastCandleTimestamp } = await loadStore();

    const symbol = "ETHUSDT";
    const interval = "1m";

    await saveCandles({
      symbol,
      interval,
      candles: [
        { timestamp: 1_710_000_000_000, open: 123.456789, high: 124.123456, low: 122.987654, close: 123.987654, volume: 10.123456 },
        { timestamp: 1_710_000_060_000, open: 124.456789, high: 125.223344, low: 123.112233, close: 124.887766, volume: 11.765432 },
      ],
    });

    const initial = await loadCandles({ symbol, interval });
    expect(initial).toStrictEqual([
      {
        timestamp: 1_710_000_000_000,
        open: round(123.456789),
        high: round(124.123456),
        low: round(122.987654),
        close: round(123.987654),
        volume: round(10.123456),
      },
      {
        timestamp: 1_710_000_060_000,
        open: round(124.456789),
        high: round(125.223344),
        low: round(123.112233),
        close: round(124.887766),
        volume: round(11.765432),
      },
    ]);

    await saveCandles({
      symbol,
      interval,
      candles: [
        { timestamp: 1_710_000_060_000, open: 130.123456, high: 131.654321, low: 129.98765, close: 130.777777, volume: 14.54321 },
        { timestamp: 1_710_000_120_000, open: 131.123456, high: 132.765432, low: 130.654321, close: 132.111111, volume: 15.987654 },
      ],
    });

    const merged = await loadCandles({ symbol, interval });
    expect(merged).toStrictEqual([
      {
        timestamp: 1_710_000_000_000,
        open: round(123.456789),
        high: round(124.123456),
        low: round(122.987654),
        close: round(123.987654),
        volume: round(10.123456),
      },
      {
        timestamp: 1_710_000_060_000,
        open: round(130.123456),
        high: round(131.654321),
        low: round(129.98765),
        close: round(130.777777),
        volume: round(14.54321),
      },
      {
        timestamp: 1_710_000_120_000,
        open: round(131.123456),
        high: round(132.765432),
        low: round(130.654321),
        close: round(132.111111),
        volume: round(15.987654),
      },
    ]);

    await expect(
      getLastCandleTimestamp({ symbol, interval }),
    ).resolves.toBe(1_710_000_120_000);

    const filePath = path.join(process.env.BOT_DATA_DIR as string, "candles", "ethusdt", "1m.csv");
    const rawFile = await fs.readFile(filePath, { encoding: "utf8" });
    expect(rawFile.startsWith("timestamp,open,high,low,close,volume\n")).toBe(true);
  });

  it("supports filtering, ordering, and limiting when loading", async () => {
    const { saveCandles, loadCandles } = await loadStore();

    const symbol = "BTCUSDT";
    const interval = "5m";

    const baseTimestamp = 1_720_000_000_000;
    const candles = Array.from({ length: 6 }, (_, index) => ({
      timestamp: baseTimestamp + index * 300_000,
      open: 50_000 + index * 100,
      high: 50_050 + index * 100,
      low: 49_950 + index * 100,
      close: 50_025 + index * 100,
      volume: 100 + index,
    }));

    await saveCandles({ symbol, interval, candles });

    const limited = await loadCandles({ symbol, interval, limit: 3 });
    expect(limited.map((item) => item.timestamp)).toStrictEqual([
      baseTimestamp + 3 * 300_000,
      baseTimestamp + 4 * 300_000,
      baseTimestamp + 5 * 300_000,
    ]);

    const descending = await loadCandles({ symbol, interval, limit: 2, order: "desc" });
    expect(descending.map((item) => item.timestamp)).toStrictEqual([
      baseTimestamp + 5 * 300_000,
      baseTimestamp + 4 * 300_000,
    ]);

    const filtered = await loadCandles({
      symbol,
      interval,
      fromTimestamp: baseTimestamp + 2 * 300_000,
      toTimestamp: baseTimestamp + 4 * 300_000,
    });
    expect(filtered.map((item) => item.timestamp)).toStrictEqual([
      baseTimestamp + 2 * 300_000,
      baseTimestamp + 3 * 300_000,
      baseTimestamp + 4 * 300_000,
    ]);
  });
});
