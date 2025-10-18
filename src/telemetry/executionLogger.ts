import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

import type { OrderParameters } from "@nktkas/hyperliquid";

import type { TradeSignal } from "../trading/tradeSignalParser.js";
import type { RiskCheckResult } from "../risk/riskEngine.js";

export type ExchangeOrderResponse = Record<string, unknown> | null | undefined;

export interface ExecutionLoggerOptions {
  readonly storagePath?: string;
  readonly maxEntries?: number;
}

export type ExecutionStatus =
  | "blocked"
  | "rejected"
  | "submitted"
  | "partial"
  | "filled"
  | "error";

export interface ExecutionEstimates {
  readonly entryPrice: number;
  readonly midPrice: number;
  readonly notionalUsd: number;
  readonly direction: 1 | -1;
  readonly leverage?: number;
  readonly projectedPnlUsd?: number;
  readonly projectedRoiPercent?: number;
  readonly expectedWinPrice?: number;
  readonly estimatedRiskUsd?: number;
}

export interface ExecutionLogEntry {
  readonly id: string;
  readonly timestamp: number;
  readonly signal: Pick<
    TradeSignal,
    | "side"
    | "symbol"
    | "rawSymbol"
    | "size"
    | "leverage"
    | "execution"
    | "entryPrice"
    | "takeProfits"
    | "stopLoss"
    | "stopLosses"
    | "trailingStop"
    | "text"
  >;
  readonly payload: OrderParameters | null;
  readonly response: ExchangeOrderResponse;
  readonly status: ExecutionStatus;
  readonly success: boolean;
  readonly notes?: string;
  readonly risk: RiskCheckResult | null;
  readonly estimates: ExecutionEstimates;
  readonly demoMode: boolean;
}

export interface ExecutionHistoryOptions {
  readonly limit?: number;
}

export interface SymbolPerformance {
  readonly symbol: string;
  readonly trades: number;
  readonly wins: number;
  readonly losses: number;
  readonly winRate: number;
  readonly projectedPnlUsd: number;
  readonly averageLeverage: number | null;
  readonly averageNotionalUsd: number;
}

export interface DailyPerformance {
  readonly date: string;
  readonly trades: number;
  readonly projectedPnlUsd: number;
  readonly projectedRoiPercent: number;
  readonly wins: number;
  readonly losses: number;
  readonly volumeUsd: number;
}

export interface ExecutionMetrics {
  readonly totals: {
    readonly trades: number;
    readonly executedTrades: number;
    readonly wins: number;
    readonly losses: number;
    readonly winRate: number;
    readonly projectedPnlUsd: number;
    readonly projectedRoiPercent: number;
    readonly averageLeverage: number | null;
    readonly averageNotionalUsd: number;
    readonly dailyLossUsd: number;
    readonly dailyVolumeUsd: number;
  };
  readonly symbols: readonly SymbolPerformance[];
  readonly daily: readonly DailyPerformance[];
  readonly pnlSeries: readonly { readonly timestamp: number; readonly cumulative: number }[];
  readonly leverageSeries: readonly { readonly timestamp: number; readonly leverage: number | null }[];
}

interface MutableSymbolAccumulator {
  symbol: string;
  trades: number;
  wins: number;
  losses: number;
  projectedPnlUsd: number;
  notionalSum: number;
  leverageSum: number;
  leverageCount: number;
}

const DEFAULT_MAX_ENTRIES = 2_000;

function resolveStoragePath(customPath?: string): string {
  if (customPath) {
    return customPath;
  }
  const baseDir = path.join(process.cwd(), "data");
  return path.join(baseDir, "execution-log.json");
}

function normalizeNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function computeProjectedPnl(signal: TradeSignal, entryPrice: number): {
  projectedPnlUsd?: number;
  projectedRoiPercent?: number;
  expectedWinPrice?: number;
} {
  if (!(entryPrice > 0 && signal.size > 0)) {
    return {};
  }

  if (!Array.isArray(signal.takeProfits) || signal.takeProfits.length === 0) {
    return {};
  }

  const explicitFractions = signal.takeProfits
    .map((level) => normalizeNumber(level.sizeFraction))
    .map((fraction) => (fraction !== undefined && fraction > 0 ? fraction : undefined));
  const providedSum = explicitFractions.reduce((sum, value) => sum + (value ?? 0), 0);
  const unspecified = explicitFractions.filter((value) => value === undefined).length;
  const remainder = Math.max(1 - providedSum, 0);
  const fallback = unspecified > 0 ? remainder / unspecified : 0;

  let expectedWinPrice = 0;
  let weightSum = 0;
  signal.takeProfits.forEach((level, index) => {
    const price = normalizeNumber(level.price);
    if (!price || !(price > 0)) {
      return;
    }
    const weight = explicitFractions[index] ?? (unspecified > 0 ? fallback : 1 / signal.takeProfits.length);
    if (!(weight > 0)) {
      return;
    }
    expectedWinPrice += price * weight;
    weightSum += weight;
  });

  if (!(weightSum > 0)) {
    return {};
  }

  expectedWinPrice /= weightSum;
  const direction = signal.side === "short" ? -1 : 1;
  const projectedPnl = (expectedWinPrice - entryPrice) * direction * signal.size;
  const projectedRoiPercent = (projectedPnl / (entryPrice * signal.size)) * 100;
  return {
    projectedPnlUsd: projectedPnl,
    projectedRoiPercent,
    expectedWinPrice,
  };
}

function computeRisk(signal: TradeSignal, entryPrice: number): number | undefined {
  const stop = normalizeNumber(signal.stopLosses[0]?.price ?? signal.stopLoss);
  if (!stop || !(stop > 0)) {
    return undefined;
  }
  const direction = signal.side === "short" ? -1 : 1;
  const delta = (stop - entryPrice) * direction;
  const riskPerUnit = delta < 0 ? Math.abs(delta) : 0;
  if (!(riskPerUnit > 0)) {
    return undefined;
  }
  return riskPerUnit * signal.size;
}

function buildEstimates(signal: TradeSignal, entryPrice: number, midPrice: number, leverage?: number) {
  const direction: 1 | -1 = signal.side === "short" ? -1 : 1;
  const notional = entryPrice * signal.size;
  const projected = computeProjectedPnl(signal, entryPrice);
  const estimatedRisk = computeRisk(signal, entryPrice);
  return {
    entryPrice,
    midPrice,
    notionalUsd: notional,
    direction,
    leverage,
    projectedPnlUsd: projected.projectedPnlUsd,
    projectedRoiPercent: projected.projectedRoiPercent,
    expectedWinPrice: projected.expectedWinPrice,
    estimatedRiskUsd: estimatedRisk,
  } satisfies ExecutionEstimates;
}

function isSuccessfulResponse(status: ExecutionStatus): boolean {
  return status === "filled" || status === "submitted" || status === "partial";
}

export class ExecutionLogger {
  private readonly storagePath: string;
  private readonly maxEntries: number;
  private readonly entries: ExecutionLogEntry[] = [];
  private loading?: Promise<void>;
  private pendingWrite?: Promise<void>;

  constructor(options?: ExecutionLoggerOptions) {
    this.storagePath = resolveStoragePath(options?.storagePath);
    this.maxEntries = options?.maxEntries ?? DEFAULT_MAX_ENTRIES;
  }

  async initialize(): Promise<void> {
    if (!this.loading) {
      this.loading = this.loadFromDisk();
    }
    await this.loading;
  }

  async logExecution(
    signal: TradeSignal,
    payload: OrderParameters,
    response: ExchangeOrderResponse,
    params: {
      readonly status: ExecutionStatus;
      readonly demoMode: boolean;
      readonly entryPrice: number;
      readonly midPrice: number;
      readonly leverage?: number;
      readonly risk: RiskCheckResult | null;
      readonly notes?: string;
    },
  ): Promise<ExecutionLogEntry> {
    await this.initialize();
    const entry: ExecutionLogEntry = {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      signal: {
        side: signal.side,
        symbol: signal.symbol,
        rawSymbol: signal.rawSymbol,
        size: signal.size,
        leverage: signal.leverage,
        execution: signal.execution,
        entryPrice: signal.entryPrice,
        takeProfits: signal.takeProfits,
        stopLoss: signal.stopLoss,
        stopLosses: signal.stopLosses,
        trailingStop: signal.trailingStop,
        text: signal.text,
      },
      payload,
      response,
      status: params.status,
      success: isSuccessfulResponse(params.status),
      notes: params.notes,
      risk: params.risk ?? null,
      estimates: buildEstimates(signal, params.entryPrice, params.midPrice, params.leverage ?? signal.leverage),
      demoMode: params.demoMode,
    };

    this.entries.push(entry);
    if (this.entries.length > this.maxEntries) {
      this.entries.splice(0, this.entries.length - this.maxEntries);
    }
    await this.persist();
    return entry;
  }

  async logFailure(
    signal: TradeSignal,
    params: {
      readonly status: ExecutionStatus;
      readonly demoMode: boolean;
      readonly entryPrice: number;
      readonly midPrice: number;
      readonly leverage?: number;
      readonly risk: RiskCheckResult | null;
      readonly notes: string;
    },
  ): Promise<ExecutionLogEntry> {
    await this.initialize();
    const entry: ExecutionLogEntry = {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      signal: {
        side: signal.side,
        symbol: signal.symbol,
        rawSymbol: signal.rawSymbol,
        size: signal.size,
        leverage: signal.leverage,
        execution: signal.execution,
        entryPrice: signal.entryPrice,
        takeProfits: signal.takeProfits,
        stopLoss: signal.stopLoss,
        stopLosses: signal.stopLosses,
        trailingStop: signal.trailingStop,
        text: signal.text,
      },
      payload: null,
      response: null,
      status: params.status,
      success: false,
      notes: params.notes,
      risk: params.risk ?? null,
      estimates: buildEstimates(signal, params.entryPrice, params.midPrice, params.leverage ?? signal.leverage),
      demoMode: params.demoMode,
    };

    this.entries.push(entry);
    if (this.entries.length > this.maxEntries) {
      this.entries.splice(0, this.entries.length - this.maxEntries);
    }
    await this.persist();
    return entry;
  }

  async getHistory(options?: ExecutionHistoryOptions): Promise<readonly ExecutionLogEntry[]> {
    await this.initialize();
    const limit = options?.limit ?? 100;
    return this.entries.slice(-limit).reverse();
  }

  async getMetrics(): Promise<ExecutionMetrics> {
    await this.initialize();
    const now = new Date();
    const todayKey = now.toISOString().slice(0, 10);

    let cumulative = 0;
    const pnlSeries: { readonly timestamp: number; readonly cumulative: number }[] = [];

    const leverageSeries = this.entries.map((entry) => ({
      timestamp: entry.timestamp,
      leverage: entry.estimates.leverage ?? entry.signal.leverage ?? null,
    }));

    let wins = 0;
    let losses = 0;
    let executedTrades = 0;
    let notionalAccum = 0;
    let leverageAccum = 0;
    let leverageCount = 0;
    let projectedPnl = 0;
    let roiAccum = 0;
    let roiCount = 0;
    let dailyLossUsd = 0;
    let dailyVolumeUsd = 0;

    const dailyMap = new Map<string, DailyPerformance>();
    const symbolMap = new Map<string, MutableSymbolAccumulator>();

    for (const entry of this.entries) {
      const executed = entry.status !== "blocked" && entry.status !== "rejected" && entry.status !== "error";
      const notional = entry.estimates.notionalUsd ?? 0;
      const pnl = entry.estimates.projectedPnlUsd ?? 0;
      const roi = entry.estimates.projectedRoiPercent ?? 0;
      const leverage = entry.estimates.leverage ?? entry.signal.leverage;

      if (executed) {
        projectedPnl += pnl;
        notionalAccum += notional;
        if (Number.isFinite(roi)) {
          roiAccum += roi;
          roiCount += 1;
        }

        if (Number.isFinite(leverage ?? NaN)) {
          leverageAccum += leverage as number;
          leverageCount += 1;
        }

        cumulative += pnl;
        pnlSeries.push({ timestamp: entry.timestamp, cumulative });
        executedTrades += 1;
        if (entry.success) {
          wins += 1;
        } else {
          losses += 1;
        }
      }

      const dateKey = new Date(entry.timestamp).toISOString().slice(0, 10);
      const day = dailyMap.get(dateKey) ?? {
        date: dateKey,
        trades: 0,
        projectedPnlUsd: 0,
        projectedRoiPercent: 0,
        wins: 0,
        losses: 0,
        volumeUsd: 0,
      };
      day.trades += executed ? 1 : 0;
      if (executed) {
        day.projectedPnlUsd += pnl;
        day.volumeUsd += notional;
        if (entry.success) {
          day.wins += 1;
        } else {
          day.losses += 1;
        }
        day.trades += 1;
      }
      dailyMap.set(dateKey, day);

      const symbolKey = entry.signal.symbol;
      const symbol = symbolMap.get(symbolKey) ?? {
        symbol: symbolKey,
        trades: 0,
        wins: 0,
        losses: 0,
        projectedPnlUsd: 0,
        notionalSum: 0,
        leverageSum: 0,
        leverageCount: 0,
      } satisfies MutableSymbolAccumulator;
      if (executed) {
        symbol.trades += 1;
        symbol.projectedPnlUsd += pnl;
        symbol.notionalSum += notional;
        if (entry.success) {
          symbol.wins += 1;
        } else {
          symbol.losses += 1;
        }
        if (Number.isFinite(leverage ?? NaN)) {
          symbol.leverageSum += leverage as number;
          symbol.leverageCount += 1;
        }
      }
      symbolMap.set(symbolKey, symbol);

      if (dateKey === todayKey) {
        if (executed) {
          if (pnl < 0) {
            dailyLossUsd += Math.abs(pnl);
          }
          dailyVolumeUsd += notional;
        }
      }
    }

    const totalTrades = this.entries.length;
    const winRate = executedTrades > 0 ? (wins / executedTrades) * 100 : 0;
    const averageLeverage = leverageCount > 0 ? leverageAccum / leverageCount : null;
    const averageNotional = executedTrades > 0 ? notionalAccum / executedTrades : 0;
    const projectedRoiPercent = roiCount > 0 ? roiAccum / roiCount : 0;

    const symbols: SymbolPerformance[] = Array.from(symbolMap.values()).map((item) => ({
      symbol: item.symbol,
      trades: item.trades,
      wins: item.wins,
      losses: item.losses,
      winRate: item.trades > 0 ? (item.wins / item.trades) * 100 : 0,
      projectedPnlUsd: item.projectedPnlUsd,
      averageLeverage: item.leverageCount > 0 ? item.leverageSum / item.leverageCount : null,
      averageNotionalUsd: item.trades > 0 ? item.notionalSum / item.trades : 0,
    }));

    const daily: DailyPerformance[] = Array.from(dailyMap.values()).map((item) => ({
      date: item.date,
      trades: item.trades,
      projectedPnlUsd: item.projectedPnlUsd,
      projectedRoiPercent: item.volumeUsd > 0 ? (item.projectedPnlUsd / item.volumeUsd) * 100 : 0,
      wins: item.wins,
      losses: item.losses,
      volumeUsd: item.volumeUsd,
    }));

    daily.sort((a, b) => a.date.localeCompare(b.date));
    symbols.sort((a, b) => b.trades - a.trades);

    return {
      totals: {
        trades: totalTrades,
        executedTrades,
        wins,
        losses,
        winRate,
        projectedPnlUsd: projectedPnl,
        projectedRoiPercent,
        averageLeverage,
        averageNotionalUsd: averageNotional,
        dailyLossUsd,
        dailyVolumeUsd,
      },
      symbols,
      daily,
      pnlSeries,
      leverageSeries,
    } satisfies ExecutionMetrics;
  }

  private async loadFromDisk(): Promise<void> {
    try {
      await fs.mkdir(path.dirname(this.storagePath), { recursive: true });
      const buffer = await fs.readFile(this.storagePath, "utf8");
      if (!buffer) {
        return;
      }
      const parsed = JSON.parse(buffer);
      if (!Array.isArray(parsed)) {
        return;
      }
      parsed.forEach((item) => {
        if (item && typeof item === "object" && typeof item.id === "string") {
          this.entries.push(item as ExecutionLogEntry);
        }
      });
      if (this.entries.length > this.maxEntries) {
        this.entries.splice(0, this.entries.length - this.maxEntries);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return;
      }
      console.warn("[telemetry] Unable to load execution log", error);
    }
  }

  private async persist(): Promise<void> {
    if (this.pendingWrite) {
      await this.pendingWrite;
    }
    const data = JSON.stringify(this.entries, null, 2);
    this.pendingWrite = fs.writeFile(this.storagePath, data, "utf8").catch((error) => {
      console.warn("[telemetry] Failed to persist execution log", error);
    });
    await this.pendingWrite;
    this.pendingWrite = undefined;
  }
}
