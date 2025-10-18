import fs from "node:fs/promises";
import path from "node:path";

import { ensureDataDir } from "./dataPaths.js";

export interface Candle {
  readonly timestamp: number;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly volume: number;
}

export type CandleFileFormat = "csv";

type MergeStrategy = "merge" | "replace";

type CandleOrder = "asc" | "desc";

export interface CandleStorageKey {
  readonly symbol: string;
  readonly interval: string;
  readonly format?: CandleFileFormat;
}

export interface CandleSaveOptions extends CandleStorageKey {
  readonly candles: readonly Candle[];
  readonly mergeStrategy?: MergeStrategy;
}

export interface CandleLoadOptions extends CandleStorageKey {
  readonly fromTimestamp?: number;
  readonly toTimestamp?: number;
  readonly limit?: number;
  readonly order?: CandleOrder;
}

const CANDLES_ROOT_DIR = "candles";
const CSV_HEADER = "timestamp,open,high,low,close,volume";
const PRICE_DECIMALS = 6;
const VOLUME_DECIMALS = 6;

function sanitizeSegment(value: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error("Storage key segments must be non-empty");
  }
  return normalized
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

function resolveCandlesPath({ symbol, interval, format = "csv" }: CandleStorageKey): string {
  const sanitizedSymbol = sanitizeSegment(symbol);
  const sanitizedInterval = sanitizeSegment(interval);
  const extension = format;
  return path.join(CANDLES_ROOT_DIR, sanitizedSymbol, `${sanitizedInterval}.${extension}`);
}

function roundToDecimals(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function normalizeCandle(entry: Candle): Candle | undefined {
  const timestamp = Number(entry.timestamp);
  const open = Number(entry.open);
  const high = Number(entry.high);
  const low = Number(entry.low);
  const close = Number(entry.close);
  const volume = Number(entry.volume);

  if (!Number.isFinite(timestamp) || !Number.isFinite(open)) {
    return undefined;
  }
  if (
    !Number.isFinite(high) ||
    !Number.isFinite(low) ||
    !Number.isFinite(close) ||
    !Number.isFinite(volume)
  ) {
    return undefined;
  }

  return {
    timestamp: Math.round(timestamp),
    open: roundToDecimals(open, PRICE_DECIMALS),
    high: roundToDecimals(high, PRICE_DECIMALS),
    low: roundToDecimals(low, PRICE_DECIMALS),
    close: roundToDecimals(close, PRICE_DECIMALS),
    volume: roundToDecimals(volume, VOLUME_DECIMALS),
  } satisfies Candle;
}

function serializeCandlesToCsv(candles: readonly Candle[]): string {
  const lines = candles.map((candle) =>
    [
      candle.timestamp,
      candle.open.toFixed(PRICE_DECIMALS),
      candle.high.toFixed(PRICE_DECIMALS),
      candle.low.toFixed(PRICE_DECIMALS),
      candle.close.toFixed(PRICE_DECIMALS),
      candle.volume.toFixed(VOLUME_DECIMALS),
    ].join(","),
  );
  return `${CSV_HEADER}\n${lines.join("\n")}\n`;
}

function parseCsv(content: string): Candle[] {
  const lines = content.trim().split(/\r?\n/);
  if (lines.length === 0) {
    return [];
  }
  const [header, ...rows] = lines;
  if (header.trim() !== CSV_HEADER) {
    throw new Error(`Unexpected candle CSV header: "${header}"`);
  }
  const candles: Candle[] = [];
  for (const row of rows) {
    if (!row.trim()) {
      continue;
    }
    const [timestampStr, openStr, highStr, lowStr, closeStr, volumeStr] = row.split(",");
    const candle = normalizeCandle({
      timestamp: Number(timestampStr),
      open: Number.parseFloat(openStr),
      high: Number.parseFloat(highStr),
      low: Number.parseFloat(lowStr),
      close: Number.parseFloat(closeStr),
      volume: Number.parseFloat(volumeStr),
    });
    if (candle) {
      candles.push(candle);
    }
  }
  candles.sort((a, b) => a.timestamp - b.timestamp);
  return candles;
}

async function ensureCandlesFilePath(key: CandleStorageKey): Promise<string> {
  const dataDir = await ensureDataDir();
  const relativePath = resolveCandlesPath(key);
  const fullPath = path.join(dataDir, relativePath);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  return fullPath;
}

async function readCandlesFromDisk(key: CandleStorageKey): Promise<Candle[]> {
  const dataDir = await ensureDataDir();
  const relativePath = resolveCandlesPath(key);
  const fullPath = path.join(dataDir, relativePath);
  try {
    const content = await fs.readFile(fullPath, { encoding: "utf8" });
    return parseCsv(content);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

export async function saveCandles({
  candles,
  mergeStrategy = "merge",
  ...key
}: CandleSaveOptions): Promise<void> {
  if (candles.length === 0) {
    return;
  }
  const normalizedCandles = candles
    .map((candle) => normalizeCandle(candle))
    .filter((candle): candle is Candle => Boolean(candle));
  if (normalizedCandles.length === 0) {
    return;
  }

  const targetPath = await ensureCandlesFilePath(key);
  let existing: Candle[] = [];
  if (mergeStrategy === "merge") {
    existing = await readCandlesFromDisk(key);
  }

  const merged = new Map<number, Candle>();
  for (const candle of existing) {
    merged.set(candle.timestamp, candle);
  }
  for (const candle of normalizedCandles) {
    merged.set(candle.timestamp, candle);
  }

  const mergedCandles = Array.from(merged.values()).sort((a, b) => a.timestamp - b.timestamp);

  if (mergeStrategy === "merge" && existing.length === mergedCandles.length) {
    let unchanged = true;
    for (let index = 0; index < existing.length; index += 1) {
      const left = existing[index];
      const right = mergedCandles[index];
      if (
        left.timestamp !== right.timestamp ||
        left.open !== right.open ||
        left.high !== right.high ||
        left.low !== right.low ||
        left.close !== right.close ||
        left.volume !== right.volume
      ) {
        unchanged = false;
        break;
      }
    }
    if (unchanged) {
      return;
    }
  }

  const serialized = serializeCandlesToCsv(mergedCandles);
  await fs.writeFile(targetPath, serialized, { encoding: "utf8" });
}

export async function loadCandles({
  fromTimestamp,
  toTimestamp,
  limit,
  order = "asc",
  ...key
}: CandleLoadOptions): Promise<Candle[]> {
  const candles = await readCandlesFromDisk(key);
  let filtered = candles;
  if (typeof fromTimestamp === "number") {
    filtered = filtered.filter((candle) => candle.timestamp >= fromTimestamp);
  }
  if (typeof toTimestamp === "number") {
    filtered = filtered.filter((candle) => candle.timestamp <= toTimestamp);
  }

  if (order === "desc") {
    filtered = [...filtered].reverse();
  }

  if (typeof limit === "number") {
    if (limit <= 0) {
      return [];
    }
    if (order === "desc") {
      filtered = filtered.slice(0, limit);
    } else if (filtered.length > limit) {
      filtered = filtered.slice(filtered.length - limit);
    }
  }

  return filtered;
}

export async function getLastCandleTimestamp(key: CandleStorageKey): Promise<number | undefined> {
  const candles = await loadCandles({ ...key, order: "desc", limit: 1 });
  return candles[0]?.timestamp;
}
