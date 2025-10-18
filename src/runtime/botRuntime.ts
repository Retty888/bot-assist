import {
  HttpTransport,
  InfoClient,
  type ExchangeClient,
  type OrderParameters,
} from "@nktkas/hyperliquid";

import {
  HyperliquidTradingBot,
  type HyperliquidBotOptions,
} from "../trading/hyperliquidTradingBot.js";
import { normalizeSymbol } from "../trading/tradeSignalParser.js";
import { getExecutionLogger, getNotificationService, getRiskEngine } from "./serviceRegistry.js";

export const DEFAULT_SIGNAL =
  "Long BTC size 2 entry 60420 stop 58650 tp1 63100 tp2 64250 30m risk medium trailing stop 0.6%";

type MetaAndAssetCtxsTuple = Awaited<ReturnType<InfoClient["metaAndAssetCtxs"]>>;
type MetaResponse = MetaAndAssetCtxsTuple[0];
type AssetContexts = MetaAndAssetCtxsTuple[1];

type NumericLike = string | number | null | undefined;

interface DemoProfile {
  readonly basePrice: number;
  readonly volatility: number;
  readonly dayBaseVolume: number;
  readonly funding: number;
  readonly openInterest: number;
  readonly premium: number;
  readonly periodMinutes: number;
  readonly phase: number;
}

const DEMO_PROFILES: Record<string, DemoProfile> = {
  BTC: {
    basePrice: 60850,
    volatility: 0.022,
    dayBaseVolume: 34_500,
    funding: 0.00018,
    openInterest: 1_950_000_000,
    premium: 0.0006,
    periodMinutes: 45,
    phase: 0,
  },
  ETH: {
    basePrice: 3525,
    volatility: 0.028,
    dayBaseVolume: 215_000,
    funding: 0.00023,
    openInterest: 740_000_000,
    premium: 0.0009,
    periodMinutes: 60,
    phase: Math.PI / 3,
  },
  SOL: {
    basePrice: 148.5,
    volatility: 0.035,
    dayBaseVolume: 5_800_000,
    funding: 0.00032,
    openInterest: 185_000_000,
    premium: 0.0012,
    periodMinutes: 35,
    phase: Math.PI / 1.7,
  },
};

const demoMeta: MetaResponse = {
  universe: [
    {
      name: "BTC",
      szDecimals: 3,
      maxLeverage: 125,
      marginTableId: 0,
    },
    {
      name: "ETH",
      szDecimals: 3,
      maxLeverage: 100,
      marginTableId: 0,
    },
    {
      name: "SOL",
      szDecimals: 2,
      maxLeverage: 60,
      marginTableId: 0,
    },
  ],
  marginTables: [
    [
      0,
      {
        description: "default",
        marginTiers: [],
      },
    ],
  ],
  collateralToken: 0,
};

function getDemoProfile(symbol: string): DemoProfile {
  const normalized = symbol.toUpperCase();
  return DEMO_PROFILES[normalized] ?? DEMO_PROFILES.BTC;
}

function formatNumeric(value: number, fractionDigits = 8): string {
  if (!Number.isFinite(value)) {
    return "0";
  }
  if (Math.abs(value) >= 1_000_000) {
    return Math.round(value).toString();
  }
  return value
    .toFixed(fractionDigits)
    .replace(/\.0+$/, "")
    .replace(/(\.\d*?)0+$/, "$1");
}

function buildDemoContexts(meta: MetaResponse): AssetContexts {
  const nowMs = Date.now();
  const contexts: AssetContexts = [];

  meta.universe.forEach((asset, index) => {
    const profile = getDemoProfile(asset.name);
    const periodSeconds = profile.periodMinutes * 60;
    const basePrice = profile.basePrice;
    const phase = profile.phase + index * 0.45;
    const timeFactor = (nowMs / 1000) / periodSeconds;
    const wave = Math.sin(timeFactor + phase);
    const drift = Math.cos(timeFactor * 1.4 + phase * 0.75);

    const midPrice = basePrice * (1 + wave * profile.volatility);
    const markPrice = midPrice * (1 + drift * profile.volatility * 0.05);
    const prevDayPx = basePrice * (1 - profile.volatility * 0.4);
    const dayBaseVolume = profile.dayBaseVolume * (1 + 0.25 * wave + 0.15 * drift);
    const dayNotionalVolume = dayBaseVolume * midPrice;
    const fundingRate = profile.funding * (1 + 0.5 * drift);
    const openInterest = profile.openInterest * (1 + 0.18 * wave);
    const premium = profile.premium * (1 + 0.4 * wave);

    contexts.push({
      prevDayPx: formatNumeric(prevDayPx, 4),
      dayNtlVlm: formatNumeric(dayNotionalVolume, 2),
      markPx: formatNumeric(markPrice, 4),
      midPx: formatNumeric(midPrice, 4),
      funding: formatNumeric(fundingRate, 6),
      openInterest: formatNumeric(openInterest, 2),
      premium: formatNumeric(premium, 6),
      oraclePx: formatNumeric(midPrice * (1 + 0.01 * wave), 4),
      impactPxs: null,
      dayBaseVlm: formatNumeric(dayBaseVolume, 2),
    });
  });

  return contexts;
}

class DemoInfoClient {
  constructor(private readonly meta: MetaResponse) {}

  async metaAndAssetCtxs(): Promise<MetaAndAssetCtxsTuple> {
    return [this.meta, buildDemoContexts(this.meta)] as MetaAndAssetCtxsTuple;
  }
}

class DemoExchangeClient {
  async order(payload: OrderParameters) {
    return {
      status: "ok",
      data: {
        statuses: payload.orders.map(() => ({ status: "fulfilled" })),
      },
    } as unknown as Awaited<ReturnType<ExchangeClient["order"]>>;
  }
}

interface AssetMeta {
  readonly id: number;
  readonly name: string;
  readonly sizeDecimals: number;
}

interface CachedAssets {
  readonly timestamp: number;
  readonly assetsBySymbol: Map<string, AssetMeta>;
  readonly contexts: AssetContexts;
}

export interface MarketVolumeBucket {
  readonly price: number;
  readonly volume: number;
  readonly relativeIntensity: number;
}

export interface CandleDatum {
  readonly time: number;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly volume: number;
}

export interface MarketDataSnapshot {
  readonly symbol: string;
  readonly normalizedSymbol: string;
  readonly midPrice: number;
  readonly markPrice: number;
  readonly spreadUsd: number;
  readonly spreadBps: number;
  readonly fundingRate: number;
  readonly volatilityPercent: number;
  readonly dayBaseVolume: number;
  readonly dayNotionalVolume: number;
  readonly volatilityHint: string;
  readonly candles: readonly CandleDatum[];
  readonly volumeDistribution: readonly MarketVolumeBucket[];
  readonly layers?: {
    readonly entries: readonly number[];
    readonly takeProfits: readonly number[];
    readonly stopLosses: readonly number[];
  };
  readonly timestamp: number;
  readonly demoMode: boolean;
}

export interface RuntimeConfig {
  readonly options: HyperliquidBotOptions;
  readonly demoMode: boolean;
}

const DEFAULT_CACHE_TTL_MS = 5_000;

let sharedTransport: HttpTransport | undefined;
let sharedInfoClient: InfoClient | DemoInfoClient | undefined;
let sharedDemoMode = false;
let sharedAssetsCache: CachedAssets | undefined;

function parseNumeric(value: NumericLike): number | undefined {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === "string") {
    const numeric = Number.parseFloat(value);
    return Number.isFinite(numeric) ? numeric : undefined;
  }
  return undefined;
}

function buildVolatilityHint(volatility: number): string {
  if (volatility < 1.2) {
    return "Calm regime — expect tight ranges and favor limit entries.";
  }
  if (volatility < 3.5) {
    return "Moderate volatility — layered entries with conservative stops are effective.";
  }
  if (volatility < 6.5) {
    return "Elevated volatility — widen stops and scale take-profits across multiple tiers.";
  }
  return "Explosive volatility — prioritize risk controls and avoid oversized positions.";
}

function seededRandom(seed: number): number {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

function hashSymbol(symbol: string): number {
  let hash = 0;
  for (let index = 0; index < symbol.length; index += 1) {
    hash = (hash * 31 + symbol.charCodeAt(index)) % 1_000_000;
  }
  return hash;
}

function generateSyntheticCandles(
  midPrice: number,
  volatilityPercent: number,
  volume: number,
  points = 60,
  symbol = "BTC",
): CandleDatum[] {
  const candles: CandleDatum[] = [];
  if (!(midPrice > 0)) {
    return candles;
  }

  const baseVolatility = Math.max(volatilityPercent / 100, 0.0025);
  const now = Math.floor(Date.now() / 1000);
  let lastClose = midPrice;
  const symbolHash = hashSymbol(symbol);
  const trendBias = (symbolHash % 9) / 10000 - 0.0004;

  for (let index = points - 1; index >= 0; index -= 1) {
    const time = now - index * 60;
    const seed = seededRandom(time + symbolHash);
    const drift = (seed - 0.5) * baseVolatility * 2 + trendBias;
    const open = lastClose * (1 + drift * 0.35);
    const high = open * (1 + Math.abs(drift) * 1.25 + seededRandom(time + symbolHash + 1) * baseVolatility);
    const low = open * (1 - Math.abs(drift) * 1.1 - seededRandom(time + symbolHash + 2) * baseVolatility * 0.8);
    const close = (open + high + low + lastClose) / 4;
    lastClose = close;

    const normalizedVolume = volume > 0 ? volume / points : midPrice * 0.45;
    candles.push({
      time,
      open,
      high,
      low,
      close,
      volume: normalizedVolume * (0.6 + seededRandom(time + symbolHash + 3) * 0.9),
    });
  }

  return candles;
}

async function fetchRealCandles(
  infoClient: InfoClient,
  assetName: string,
  points: number,
): Promise<CandleDatum[] | undefined> {
  try {
    const endTime = Date.now();
    const intervalMinutes = 1;
    const startTime = endTime - points * intervalMinutes * 60_000;
    const response = await infoClient.candleSnapshot({
      coin: assetName,
      interval: "1m",
      startTime,
      endTime,
    });
    if (!Array.isArray(response) || response.length === 0) {
      return undefined;
    }
    const candles = response
      .map((item) => ({
        time: Number(item.t) / 1000,
        open: Number(item.o),
        high: Number(item.h),
        low: Number(item.l),
        close: Number(item.c),
        volume: Number(item.v),
      }))
      .filter((item) =>
        Number.isFinite(item.time) &&
        Number.isFinite(item.open) &&
        Number.isFinite(item.high) &&
        Number.isFinite(item.low) &&
        Number.isFinite(item.close) &&
        Number.isFinite(item.volume),
      );
    if (candles.length === 0) {
      return undefined;
    }
    candles.sort((a, b) => a.time - b.time);
    return candles.slice(-points);
  } catch (error) {
    console.warn(`Failed to fetch real candles for ${assetName}:`, error);
    return undefined;
  }
}

function buildVolumeDistribution(
  midPrice: number,
  volatilityPercent: number,
  baseVolume: number,
  symbol = "BTC",
): MarketVolumeBucket[] {
  const buckets: MarketVolumeBucket[] = [];
  if (!(midPrice > 0)) {
    return buckets;
  }

  const levels = 9;
  const volatilityFactor = Math.max(volatilityPercent / 100, 0.005);
  const volumeBase = baseVolume > 0 ? baseVolume : midPrice * 12;
  const offsetPhase = hashSymbol(symbol) / 1_000_000;

  for (let index = -Math.floor(levels / 2); index <= Math.floor(levels / 2); index += 1) {
    const offsetFactor = index / Math.max(Math.floor(levels / 2), 1);
    const price = midPrice * (1 + offsetFactor * volatilityFactor * 0.85 + offsetPhase * 0.01);
    const relative = Math.exp(-Math.abs(offsetFactor) * 1.45);
    buckets.push({
      price,
      volume: volumeBase * relative,
      relativeIntensity: relative,
    });
  }

  return buckets;
}

function buildVolumeDistributionFromCandles(candles: CandleDatum[], bucketCount = 9): MarketVolumeBucket[] {
  if (!Array.isArray(candles) || candles.length === 0) {
    return [];
  }
  const closes = candles.map((candle) => candle.close);
  const volumes = candles.map((candle) => candle.volume ?? 0);
  const minPrice = Math.min(...closes);
  const maxPrice = Math.max(...closes);
  const range = maxPrice - minPrice || minPrice * 0.01;
  const buckets: MarketVolumeBucket[] = [];
  const step = range / bucketCount;
  for (let index = 0; index < bucketCount; index += 1) {
    const lower = minPrice + step * index;
    const upper = index === bucketCount - 1 ? maxPrice + step : lower + step;
    let volume = 0;
    candles.forEach((candle, candleIndex) => {
      const price = closes[candleIndex];
      if (price >= lower && price < upper) {
        volume += volumes[candleIndex] ?? 0;
      }
    });
    buckets.push({
      price: (lower + upper) / 2,
      volume,
      relativeIntensity: 1, // placeholder; will normalize below
    });
  }
  const maxVolume = Math.max(...buckets.map((bucket) => bucket.volume), 1);
  return buckets.map((bucket) => ({
    ...bucket,
    relativeIntensity: bucket.volume / maxVolume,
  }));
}

export function ensureMarketClients(): { infoClient: InfoClient; demoMode: boolean } {
  const privateKey = process.env.HYPERLIQUID_PRIVATE_KEY?.trim();
  const isTestnet = (process.env.HYPERLIQUID_TESTNET ?? "true").toLowerCase() !== "false";

  if (!privateKey) {
    if (!(sharedInfoClient instanceof DemoInfoClient)) {
      sharedInfoClient = new DemoInfoClient(demoMeta);
    }
    sharedDemoMode = true;
    return { infoClient: sharedInfoClient as unknown as InfoClient, demoMode: true };
  }

  if (!sharedTransport) {
    sharedTransport = new HttpTransport({ isTestnet });
  }
  if (!(sharedInfoClient instanceof InfoClient)) {
    sharedInfoClient = new InfoClient({ transport: sharedTransport });
  }
  sharedDemoMode = false;
  return { infoClient: sharedInfoClient as InfoClient, demoMode: false };
}

async function ensureAssetsCache(): Promise<{ cache: CachedAssets; demoMode: boolean }> {
  const now = Date.now();
  if (sharedAssetsCache && now - sharedAssetsCache.timestamp < DEFAULT_CACHE_TTL_MS) {
    return { cache: sharedAssetsCache, demoMode: sharedDemoMode };
  }

  const { infoClient, demoMode } = ensureMarketClients();
  const [meta, contexts] = await infoClient.metaAndAssetCtxs();
  const assetsBySymbol = new Map<string, AssetMeta>();
  meta.universe.forEach((item, index) => {
    const baseSymbol = normalizeSymbol(item.name);
    if (baseSymbol) {
      assetsBySymbol.set(baseSymbol, {
        id: index,
        name: item.name,
        sizeDecimals: item.szDecimals,
      });
    }
  });

  sharedAssetsCache = {
    timestamp: now,
    assetsBySymbol,
    contexts,
  } satisfies CachedAssets;

  return { cache: sharedAssetsCache, demoMode };
}

export async function getMarketDataSnapshot(symbol: string): Promise<MarketDataSnapshot> {
  const normalized = normalizeSymbol(symbol);
  if (!normalized) {
    throw new Error("Symbol is required to fetch market data");
  }

  const { cache, demoMode } = await ensureAssetsCache();
  const asset = cache.assetsBySymbol.get(normalized);
  if (!asset) {
    throw new Error(`Symbol "${symbol}" is not available on Hyperliquid`);
  }

  const context = (cache.contexts[asset.id] ?? {}) as Record<string, NumericLike>;
  const midPrice = parseNumeric(context.midPx) ?? parseNumeric(context.markPx);
  if (!(midPrice && midPrice > 0)) {
    throw new Error("Unable to resolve mid price for market data snapshot");
  }

  const markPrice = parseNumeric(context.markPx) ?? midPrice;
  const prevDayPx = parseNumeric(context.prevDayPx) ?? midPrice;
  const dayBaseVolume = parseNumeric(context.dayBaseVlm) ?? 0;
  const dayNotionalVolume = parseNumeric(context.dayNtlVlm) ?? 0;
  const fundingRate = parseNumeric(context.funding) ?? 0;

  const spreadUsd = Math.abs(markPrice - midPrice);
  const spreadBps = midPrice > 0 ? (spreadUsd / midPrice) * 10_000 : 0;
  const volatilityPercent = prevDayPx > 0 ? (Math.abs(midPrice - prevDayPx) / prevDayPx) * 100 : 0;

  const { infoClient } = ensureMarketClients();
  const candleCount = 90;
  let candles = demoMode
    ? generateSyntheticCandles(midPrice, volatilityPercent, dayBaseVolume, candleCount, normalized)
    : await fetchRealCandles(infoClient, asset.name, candleCount);

  if (!candles || candles.length === 0) {
    candles = generateSyntheticCandles(midPrice, volatilityPercent, dayBaseVolume, candleCount, normalized);
  }

  const volumeDistribution = demoMode
    ? buildVolumeDistribution(midPrice, volatilityPercent, dayBaseVolume, normalized)
    : buildVolumeDistributionFromCandles(candles);

  return {
    symbol: asset.name,
    normalizedSymbol: normalized,
    midPrice,
    markPrice,
    spreadUsd,
    spreadBps,
    fundingRate,
    volatilityPercent,
    dayBaseVolume,
    dayNotionalVolume,
    volatilityHint: buildVolatilityHint(volatilityPercent),
    candles,
    volumeDistribution,
    timestamp: Date.now(),
    demoMode,
  } satisfies MarketDataSnapshot;
}

export function resolveBotOptions(): RuntimeConfig {
  const privateKey = process.env.HYPERLIQUID_PRIVATE_KEY?.trim();
  const slippageBps = process.env.HYPERLIQUID_SLIPPAGE_BPS;

  if (!privateKey) {
    const { infoClient } = ensureMarketClients();
    const exchange = new DemoExchangeClient();
    return {
      options: {
        infoClient: infoClient as unknown as InfoClient,
        exchangeClient: exchange as unknown as ExchangeClient,
        slippageBps: slippageBps ? Number(slippageBps) : undefined,
        metaRefreshIntervalMs: 120_000,
      },
      demoMode: true,
    } satisfies RuntimeConfig;
  }

  return {
    options: {
      privateKey,
      isTestnet: (process.env.HYPERLIQUID_TESTNET ?? "true").toLowerCase() !== "false",
      slippageBps: slippageBps ? Number(slippageBps) : undefined,
    },
    demoMode: false,
  } satisfies RuntimeConfig;
}

export function instantiateTradingBot(): { bot: HyperliquidTradingBot; demoMode: boolean } {
  const { options, demoMode } = resolveBotOptions();
  const executionLogger = getExecutionLogger();
  const riskEngine = getRiskEngine();
  const notifier = getNotificationService();
  return {
    bot: new HyperliquidTradingBot({
      ...options,
      executionLogger,
      riskEngine,
      notificationService: notifier,
    }),
    demoMode,
  };
}
