import { randomUUID } from "crypto";

import type { MarketKpiSnapshot } from "../signalAdviser/types.js";

export interface MarketDataPoint {
  readonly symbol: string;
  readonly price: number;
  readonly atr: number;
  readonly volatility: number;
  readonly liquidityScore: number;
  readonly fundingRate: number;
  readonly timestamp: number;
}

export interface MarketDataProvider {
  getSnapshot(symbol: string): Promise<MarketDataPoint | undefined>;
  getKpis(symbol: string): Promise<MarketKpiSnapshot | undefined>;
}

interface InternalSeriesState {
  readonly points: readonly MarketDataPoint[];
  index: number;
  readonly id: string;
}

const SIMULATED_SERIES: Record<string, readonly Omit<MarketDataPoint, "timestamp">[]> = {
  BTC: [
    { symbol: "BTC", price: 62500, atr: 950, volatility: 3.6, liquidityScore: 860, fundingRate: 0.018 },
    { symbol: "BTC", price: 62840, atr: 980, volatility: 4.1, liquidityScore: 855, fundingRate: 0.02 },
    { symbol: "BTC", price: 61820, atr: 1020, volatility: 4.8, liquidityScore: 820, fundingRate: 0.021 },
    { symbol: "BTC", price: 61010, atr: 1105, volatility: 5.4, liquidityScore: 780, fundingRate: 0.024 },
    { symbol: "BTC", price: 60450, atr: 1150, volatility: 6.1, liquidityScore: 755, fundingRate: 0.026 },
  ],
  ETH: [
    { symbol: "ETH", price: 3120, atr: 118, volatility: 4.2, liquidityScore: 520, fundingRate: 0.021 },
    { symbol: "ETH", price: 3185, atr: 126, volatility: 4.8, liquidityScore: 505, fundingRate: 0.023 },
    { symbol: "ETH", price: 3040, atr: 132, volatility: 5.5, liquidityScore: 480, fundingRate: 0.026 },
    { symbol: "ETH", price: 2975, atr: 140, volatility: 6.2, liquidityScore: 455, fundingRate: 0.029 },
  ],
  SOL: [
    { symbol: "SOL", price: 152, atr: 9.2, volatility: 6.8, liquidityScore: 220, fundingRate: 0.024 },
    { symbol: "SOL", price: 148, atr: 9.6, volatility: 7.4, liquidityScore: 205, fundingRate: 0.028 },
    { symbol: "SOL", price: 143, atr: 10.2, volatility: 8.1, liquidityScore: 185, fundingRate: 0.031 },
    { symbol: "SOL", price: 128, atr: 11.4, volatility: 9.2, liquidityScore: 165, fundingRate: 0.036 },
  ],
};

function buildSeries(symbol: string): readonly MarketDataPoint[] {
  const base = SIMULATED_SERIES[symbol.toUpperCase() as keyof typeof SIMULATED_SERIES];
  if (!base) {
    return [];
  }
  const now = Date.now();
  return base.map((point, index) => ({ ...point, timestamp: now - (base.length - index) * 60_000 }));
}

function computeTrendStrength(history: readonly MarketDataPoint[]): number {
  if (history.length < 2) {
    return 0.5;
  }
  const first = history[0];
  const last = history[history.length - 1];
  const change = (last.price - first.price) / first.price;
  return Math.min(1, Math.max(0, 0.5 + change * 3));
}

function computeDrawdown(history: readonly MarketDataPoint[]): number {
  if (history.length === 0) {
    return 0;
  }
  let peak = history[0].price;
  let drawdown = 0;
  for (const point of history) {
    if (point.price > peak) {
      peak = point.price;
    }
    const currentDrawdown = peak > 0 ? ((peak - point.price) / peak) * 100 : 0;
    drawdown = Math.max(drawdown, currentDrawdown);
  }
  return Number(drawdown.toFixed(2));
}

function computeWinRate(history: readonly MarketDataPoint[]): number {
  if (history.length < 2) {
    return 0.5;
  }
  let wins = 0;
  let total = 0;
  for (let index = 1; index < history.length; index += 1) {
    const prev = history[index - 1];
    const current = history[index];
    if (current.price > prev.price) {
      wins += 1;
    }
    total += 1;
  }
  return total === 0 ? 0.5 : Number((wins / total).toFixed(2));
}

export class SimulatedMarketDataProvider implements MarketDataProvider {
  private readonly cache = new Map<string, InternalSeriesState>();

  async getSnapshot(symbol: string): Promise<MarketDataPoint | undefined> {
    const series = this.ensureSeries(symbol);
    if (!series) {
      return undefined;
    }
    const point = series.points[series.index];
    series.index = (series.index + 1) % series.points.length;
    return point;
  }

  async getKpis(symbol: string): Promise<MarketKpiSnapshot | undefined> {
    const state = this.ensureSeries(symbol);
    if (!state) {
      return undefined;
    }
    const history = state.points.slice(0, state.index || state.points.length);
    if (history.length === 0) {
      return undefined;
    }
    const latest = history[history.length - 1];
    const trendStrength = computeTrendStrength(history);
    const drawdownPercent = computeDrawdown(history);
    const winRate = computeWinRate(history);
    const slippageBps = Math.max(10, 200 - latest.liquidityScore / 5);

    return {
      symbol: latest.symbol,
      timestamp: latest.timestamp,
      volatilityScore: latest.volatility,
      trendStrength,
      drawdownPercent,
      winRate,
      liquidityScore: latest.liquidityScore,
      slippageBps: Number(slippageBps.toFixed(2)),
    } satisfies MarketKpiSnapshot;
  }

  reset(symbol?: string): void {
    if (symbol) {
      this.cache.delete(symbol.toUpperCase());
      return;
    }
    this.cache.clear();
  }

  private ensureSeries(symbol: string): InternalSeriesState | undefined {
    const key = symbol.toUpperCase();
    const cached = this.cache.get(key);
    if (cached) {
      return cached;
    }
    const points = buildSeries(key);
    if (points.length === 0) {
      return undefined;
    }
    const state: InternalSeriesState = { points, index: 0, id: randomUUID() };
    this.cache.set(key, state);
    return state;
  }
}

export class HybridMarketDataProvider implements MarketDataProvider {
  constructor(private readonly fallback: MarketDataProvider = new SimulatedMarketDataProvider()) {}

  async getSnapshot(symbol: string): Promise<MarketDataPoint | undefined> {
    return this.fallback.getSnapshot(symbol);
  }

  async getKpis(symbol: string): Promise<MarketKpiSnapshot | undefined> {
    return this.fallback.getKpis(symbol);
  }
}

export const defaultMarketDataProvider = new HybridMarketDataProvider();
