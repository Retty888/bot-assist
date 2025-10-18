import crypto from "node:crypto";

import type { OrderParameters } from "@nktkas/hyperliquid";

import { appendNdjsonRecord, readNdjsonRecords } from "../storage/ndjsonStore.js";
import type { ExecutionMode } from "../storage/historyStore.js";
import {
  computeNotionalUsd,
  estimateLeverage,
  estimateMaxRiskUsd,
  estimateTargetPnlUsd,
  resolveEntryPrice,
} from "../trading/executionMath.js";
import type { TradeSignal } from "../trading/tradeSignalParser.js";
import type { RiskViolation } from "../risk/types.js";

const EXECUTION_LOG_FILE = "execution-log.ndjson";

export type ExecutionLogStatus = "fulfilled" | "partial" | "rejected" | "error" | "blocked";

export interface LoggedSignalSnapshot {
  readonly text: string;
  readonly symbol: string;
  readonly side: TradeSignal["side"];
  readonly size: number;
  readonly entryPrice?: number;
  readonly stopLoss?: number;
  readonly leverage?: number;
  readonly riskLabel?: TradeSignal["riskLabel"];
}

export interface ExecutionLogRecord {
  readonly id: string;
  readonly timestamp: number;
  readonly signal: LoggedSignalSnapshot;
  readonly mode: ExecutionMode;
  readonly status: ExecutionLogStatus;
  readonly message?: string;
  readonly notionalUsd?: number;
  readonly entryPriceUsd?: number;
  readonly estimatedRiskUsd?: number;
  readonly estimatedPnlUsd?: number;
  readonly leverage?: number;
  readonly responseSummary?: {
    readonly status?: string;
    readonly statuses?: string[];
  };
  readonly riskViolations?: readonly RiskViolation[];
}

export interface ExecutionHistoryItem extends ExecutionLogRecord {}

export interface AggregatedStats {
  readonly trades: number;
  readonly successes: number;
  readonly failures: number;
  readonly blocked: number;
  readonly winRate: number;
  readonly pnlUsd: number;
  readonly positivePnlUsd: number;
  readonly lossUsd: number;
  readonly grossNotionalUsd: number;
  readonly averageNotionalUsd: number;
  readonly averagePnlUsd: number;
  readonly averageRiskUsd: number;
  readonly maxRiskUsd: number;
  readonly averageLeverage: number;
  readonly maxLeverage: number;
}

export interface ExecutionMetricsSnapshot {
  readonly totals: AggregatedStats;
  readonly daily: AggregatedStats;
  readonly lastExecution?: ExecutionHistoryItem;
}

export interface LogExecutionParams {
  readonly signal: TradeSignal;
  readonly payload: OrderParameters;
  readonly response: unknown;
  readonly mode: ExecutionMode;
  readonly status?: ExecutionLogStatus;
  readonly message?: string;
  readonly riskViolations?: readonly RiskViolation[];
}

export interface LogFailureParams {
  readonly signal: TradeSignal;
  readonly payload?: OrderParameters;
  readonly mode: ExecutionMode;
  readonly status: Extract<ExecutionLogStatus, "error" | "blocked">;
  readonly message: string;
  readonly riskViolations?: readonly RiskViolation[];
}

export interface ExecutionLoggerOptions {
  readonly accountEquityUsd?: number;
}

export class ExecutionLogger {
  constructor(private readonly options: ExecutionLoggerOptions = {}) {}

  async logExecution(params: LogExecutionParams): Promise<ExecutionLogRecord> {
    const id = crypto.randomUUID();
    const timestamp = Date.now();
    const entryPrice = resolveEntryPrice(params.signal, params.payload);
    const notionalUsd = computeNotionalUsd(params.signal.size, entryPrice);
    const estimatedRiskUsd = estimateMaxRiskUsd(params.signal, entryPrice);
    const estimatedPnlUsd = estimateTargetPnlUsd(params.signal, entryPrice);
    const leverage = estimateLeverage(notionalUsd, this.options.accountEquityUsd);

    const record = {
      id,
      timestamp,
      signal: this.buildSignalSnapshot(params.signal, leverage),
      mode: params.mode,
      status: params.status ?? "fulfilled",
      message: params.message,
      notionalUsd,
      entryPriceUsd: entryPrice,
      estimatedRiskUsd,
      estimatedPnlUsd,
      leverage,
      responseSummary: summarizeResponse(params.response),
      riskViolations: params.riskViolations?.slice(),
    } satisfies ExecutionLogRecord;

    await appendNdjsonRecord({ fileName: EXECUTION_LOG_FILE, record });
    return record;
  }

  async logFailure(params: LogFailureParams): Promise<ExecutionLogRecord> {
    const id = crypto.randomUUID();
    const timestamp = Date.now();
    const entryPrice = params.payload ? resolveEntryPrice(params.signal, params.payload) : params.signal.entryPrice;
    const notionalUsd = computeNotionalUsd(params.signal.size, entryPrice);
    const leverage = estimateLeverage(notionalUsd, this.options.accountEquityUsd);

    const record: ExecutionLogRecord = {
      id,
      timestamp,
      signal: this.buildSignalSnapshot(params.signal, leverage),
      mode: params.mode,
      status: params.status,
      message: params.message,
      notionalUsd,
      entryPriceUsd: entryPrice,
      estimatedRiskUsd: estimateMaxRiskUsd(params.signal, entryPrice),
      estimatedPnlUsd: estimateTargetPnlUsd(params.signal, entryPrice),
      leverage,
      responseSummary: undefined,
      riskViolations: params.riskViolations?.slice(),
    };

    await appendNdjsonRecord({ fileName: EXECUTION_LOG_FILE, record });
    return record;
  }

  async getHistory(limit = 50): Promise<ExecutionHistoryItem[]> {
    const records = await this.readRecords(limit);
    return records;
  }

  async getMetrics(): Promise<ExecutionMetricsSnapshot> {
    const records = await this.readRecords();
    const totals = aggregate(records);
    const startOfDay = getStartOfDay();
    const daily = aggregate(records.filter((record) => record.timestamp >= startOfDay));
    const lastExecution = records[0];
    return { totals, daily, lastExecution } satisfies ExecutionMetricsSnapshot;
  }

  private buildSignalSnapshot(signal: TradeSignal, leverage: number | undefined): LoggedSignalSnapshot {
    return {
      text: signal.text,
      symbol: signal.symbol,
      side: signal.side,
      size: signal.size,
      entryPrice: signal.entryPrice,
      stopLoss: signal.stopLoss,
      leverage: leverage ?? signal.leverage,
      riskLabel: signal.riskLabel,
    } satisfies LoggedSignalSnapshot;
  }

  private async readRecords(limit?: number): Promise<ExecutionLogRecord[]> {
    const raw = await readNdjsonRecords<ExecutionLogRecord>({
      fileName: EXECUTION_LOG_FILE,
      limit,
      mapper: (value) => mapRecord(value),
    });
    return raw;
  }
}

function summarizeResponse(response: unknown): ExecutionLogRecord["responseSummary"] {
  if (!response || typeof response !== "object") {
    return undefined;
  }
  const status =
    typeof (response as { status?: unknown }).status === "string"
      ? (response as { status: string }).status
      : undefined;
  const statuses = Array.isArray((response as { data?: { statuses?: unknown } }).data?.statuses)
    ? (response as { data: { statuses: Array<{ status?: string }> } }).data.statuses
        .map((item) => (typeof item?.status === "string" ? item.status : undefined))
        .filter((item): item is string => Boolean(item))
    : undefined;
  if (!status && (!statuses || statuses.length === 0)) {
    return undefined;
  }
  return { status, statuses };
}

function mapRecord(value: unknown): ExecutionLogRecord | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const record = value as ExecutionLogRecord;
  if (!record.id || !record.timestamp || !record.signal || !record.mode || !record.status) {
    return undefined;
  }
  return record;
}

function aggregate(records: ExecutionLogRecord[]): AggregatedStats {
  if (records.length === 0) {
    return {
      trades: 0,
      successes: 0,
      failures: 0,
      blocked: 0,
      winRate: 0,
      pnlUsd: 0,
      positivePnlUsd: 0,
      lossUsd: 0,
      grossNotionalUsd: 0,
      averageNotionalUsd: 0,
      averagePnlUsd: 0,
      averageRiskUsd: 0,
      maxRiskUsd: 0,
      averageLeverage: 0,
      maxLeverage: 0,
    } satisfies AggregatedStats;
  }

  let successes = 0;
  let failures = 0;
  let blocked = 0;
  let pnlUsd = 0;
  let positivePnlUsd = 0;
  let lossUsd = 0;
  let grossNotionalUsd = 0;
  let totalRiskUsd = 0;
  let maxRiskUsd = 0;
  let totalLeverage = 0;
  let maxLeverage = 0;

  records.forEach((record) => {
    if (record.status === "fulfilled" || record.status === "partial") {
      successes += 1;
    } else if (record.status === "blocked") {
      blocked += 1;
    } else {
      failures += 1;
    }
    if (record.estimatedPnlUsd) {
      pnlUsd += record.estimatedPnlUsd;
      if (record.estimatedPnlUsd >= 0) {
        positivePnlUsd += record.estimatedPnlUsd;
      } else {
        lossUsd += Math.abs(record.estimatedPnlUsd);
      }
    }
    if (record.notionalUsd) {
      grossNotionalUsd += record.notionalUsd;
    }
    if (record.estimatedRiskUsd) {
      totalRiskUsd += record.estimatedRiskUsd;
      if (record.estimatedRiskUsd > maxRiskUsd) {
        maxRiskUsd = record.estimatedRiskUsd;
      }
    }
    if (record.leverage) {
      totalLeverage += record.leverage;
      if (record.leverage > maxLeverage) {
        maxLeverage = record.leverage;
      }
    }
  });

  const trades = records.length;
  const averageNotionalUsd = trades > 0 ? grossNotionalUsd / trades : 0;
  const averagePnlUsd = trades > 0 ? pnlUsd / trades : 0;
  const averageRiskUsd = trades > 0 ? totalRiskUsd / trades : 0;
  const averageLeverage = trades > 0 ? totalLeverage / trades : 0;
  const denominator = successes + failures > 0 ? successes + failures : trades;
  const winRate = denominator > 0 ? successes / denominator : 0;

  return {
    trades,
    successes,
    failures,
    blocked,
    winRate,
    pnlUsd,
    positivePnlUsd,
    lossUsd,
    grossNotionalUsd,
    averageNotionalUsd,
    averagePnlUsd,
    averageRiskUsd,
    maxRiskUsd,
    averageLeverage,
    maxLeverage,
  } satisfies AggregatedStats;
}

function getStartOfDay(): number {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return now.getTime();
}
