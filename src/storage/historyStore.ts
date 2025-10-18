import crypto from "node:crypto";

import { appendNdjsonRecord, readNdjsonRecords } from "./ndjsonStore.js";

const SIGNAL_HISTORY_FILE = "signal-history.ndjson";
const TRADE_HISTORY_FILE = "trade-history.ndjson";

export type ExecutionMode = "demo" | "live" | "test";

export interface SignalHistoryRecord {
  readonly id: string;
  readonly timestamp: number;
  readonly text: string;
  readonly parsedSymbol?: string;
  readonly size?: number;
  readonly mode: ExecutionMode;
}

export interface TradeHistoryRecord {
  readonly id: string;
  readonly timestamp: number;
  readonly mode: ExecutionMode;
  readonly symbol: string;
  readonly notionalUsd?: number;
  readonly payload: unknown;
  readonly response: unknown;
}

export async function appendSignalHistory(record: Omit<SignalHistoryRecord, "id" | "timestamp"> & {
  readonly timestamp?: number;
}): Promise<SignalHistoryRecord> {
  const entry: SignalHistoryRecord = {
    id: crypto.randomUUID(),
    timestamp: record.timestamp ?? Date.now(),
    text: record.text,
    parsedSymbol: record.parsedSymbol,
    size: record.size,
    mode: record.mode,
  };
  await appendNdjsonRecord({ fileName: SIGNAL_HISTORY_FILE, record: entry });
  return entry;
}

export async function appendTradeHistory(record: Omit<TradeHistoryRecord, "id" | "timestamp"> & {
  readonly timestamp?: number;
}): Promise<TradeHistoryRecord> {
  const entry: TradeHistoryRecord = {
    id: crypto.randomUUID(),
    timestamp: record.timestamp ?? Date.now(),
    mode: record.mode,
    symbol: record.symbol,
    notionalUsd: record.notionalUsd,
    payload: record.payload,
    response: record.response,
  };
  await appendNdjsonRecord({ fileName: TRADE_HISTORY_FILE, record: entry });
  return entry;
}

export async function getSignalHistory(limit?: number): Promise<SignalHistoryRecord[]> {
  return readNdjsonRecords({ fileName: SIGNAL_HISTORY_FILE, limit });
}

export async function getTradeHistory(limit?: number): Promise<TradeHistoryRecord[]> {
  return readNdjsonRecords({ fileName: TRADE_HISTORY_FILE, limit });
}

