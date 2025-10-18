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
import { ExecutionLogger, type ExecutionHistoryOptions, type ExecutionMetrics } from "../telemetry/executionLogger.js";
import { NotificationService } from "../telemetry/notificationService.js";
import { RiskEngine, type RiskLimits } from "../risk/riskEngine.js";

export const DEFAULT_SIGNAL = "Long BTC 2 stop 58000 tp1 62000 tp2 63000 market";

type MetaAndAssetCtxsTuple = Awaited<ReturnType<InfoClient["metaAndAssetCtxs"]>>;
type MetaResponse = MetaAndAssetCtxsTuple[0];
type AssetContexts = MetaAndAssetCtxsTuple[1];

type NumericLike = string | number | null | undefined;

const demoMeta: MetaResponse = {
  universe: [
    {
      name: "BTC",
      szDecimals: 3,
      maxLeverage: 100,
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

const demoContexts: AssetContexts = [
  {
    prevDayPx: "60000",
    dayNtlVlm: "0",
    markPx: "60500",
    midPx: "60500",
    funding: "0",
    openInterest: "0",
    premium: "0",
    oraclePx: "60500",
    impactPxs: null,
    dayBaseVlm: "0",
  },
];

class DemoInfoClient {
  constructor(private readonly meta: MetaResponse, private readonly contexts: AssetContexts) {}

  async metaAndAssetCtxs(): Promise<MetaAndAssetCtxsTuple> {
    return [this.meta, this.contexts] as MetaAndAssetCtxsTuple;
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
let sharedExecutionLogger: ExecutionLogger | undefined;
let sharedRiskEngine: RiskEngine | undefined;
let sharedNotifier: NotificationService | undefined;

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

function generateSyntheticCandles(
  midPrice: number,
  volatilityPercent: number,
  volume: number,
  points = 60,
): CandleDatum[] {
  const candles: CandleDatum[] = [];
  if (!(midPrice > 0)) {
    return candles;
  }

  const baseVolatility = Math.max(volatilityPercent / 100, 0.0025);
  const now = Math.floor(Date.now() / 1000);
  let lastClose = midPrice;

  for (let index = points - 1; index >= 0; index -= 1) {
    const time = now - index * 60;
    const seed = seededRandom(time);
    const drift = (seed - 0.5) * baseVolatility * 2;
    const open = lastClose * (1 + drift * 0.35);
    const high = open * (1 + Math.abs(drift) * 1.25 + seededRandom(time + 1) * baseVolatility);
    const low = open * (1 - Math.abs(drift) * 1.1 - seededRandom(time + 2) * baseVolatility * 0.8);
    const close = (open + high + low + lastClose) / 4;
    lastClose = close;

    const normalizedVolume = volume > 0 ? volume / points : midPrice * 0.45;
    candles.push({
      time,
      open,
      high,
      low,
      close,
      volume: normalizedVolume * (0.6 + seededRandom(time + 3) * 0.9),
    });
  }

  return candles;
}

function buildVolumeDistribution(midPrice: number, volatilityPercent: number, baseVolume: number): MarketVolumeBucket[] {
  const buckets: MarketVolumeBucket[] = [];
  if (!(midPrice > 0)) {
    return buckets;
  }

  const levels = 9;
  const volatilityFactor = Math.max(volatilityPercent / 100, 0.005);
  const volumeBase = baseVolume > 0 ? baseVolume : midPrice * 12;

  for (let index = -Math.floor(levels / 2); index <= Math.floor(levels / 2); index += 1) {
    const offsetFactor = index / Math.max(Math.floor(levels / 2), 1);
    const price = midPrice * (1 + offsetFactor * volatilityFactor * 0.85);
    const relative = Math.exp(-Math.abs(offsetFactor) * 1.45);
    buckets.push({
      price,
      volume: volumeBase * relative,
      relativeIntensity: relative,
    });
  }

  return buckets;
}

export function ensureMarketClients(): { infoClient: InfoClient; demoMode: boolean } {
  const privateKey = process.env.HYPERLIQUID_PRIVATE_KEY?.trim();
  const isTestnet = (process.env.HYPERLIQUID_TESTNET ?? "true").toLowerCase() !== "false";

  if (!privateKey) {
    if (!(sharedInfoClient instanceof DemoInfoClient)) {
      sharedInfoClient = new DemoInfoClient(demoMeta, demoContexts);
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
    candles: generateSyntheticCandles(midPrice, volatilityPercent, dayBaseVolume),
    volumeDistribution: buildVolumeDistribution(midPrice, volatilityPercent, dayBaseVolume),
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
  const logger = ensureExecutionLogger();
  const notifier = ensureNotificationService();
  const riskEngine = ensureRiskEngine(logger);
  return {
    bot: new HyperliquidTradingBot({ ...options, logger, notifier, riskEngine, demoMode }),
    demoMode,
  };
}

function ensureExecutionLogger(): ExecutionLogger {
  if (!sharedExecutionLogger) {
    sharedExecutionLogger = new ExecutionLogger({
      storagePath: process.env.EXECUTION_LOG_PATH,
    });
    void sharedExecutionLogger.initialize();
  }
  return sharedExecutionLogger;
}

function parseLimit(name: string, fallback?: number): number | undefined {
  const raw = process.env[name]?.trim();
  if (!raw) {
    return fallback;
  }
  const numeric = Number.parseFloat(raw);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function resolveRiskLimits(): RiskLimits {
  return {
    maxLeverage: parseLimit("RISK_MAX_LEVERAGE", 5),
    maxTradeNotionalUsd: parseLimit("RISK_MAX_TRADE_NOTIONAL_USD", 150_000),
    maxTradeRiskUsd: parseLimit("RISK_MAX_TRADE_RISK_USD", 10_000),
    maxDailyLossUsd: parseLimit("RISK_MAX_DAILY_LOSS_USD", 25_000),
    maxDailyVolumeUsd: parseLimit("RISK_MAX_DAILY_VOLUME_USD", 750_000),
  } satisfies RiskLimits;
}

function ensureRiskEngine(logger: ExecutionLogger): RiskEngine {
  if (!sharedRiskEngine) {
    sharedRiskEngine = new RiskEngine({
      limits: resolveRiskLimits(),
      warningThreshold: parseLimit("RISK_WARNING_THRESHOLD", 0.8),
      metricsProvider: () => logger.getMetrics(),
    });
  }
  return sharedRiskEngine;
}

function ensureNotificationService(): NotificationService {
  if (!sharedNotifier) {
    sharedNotifier = new NotificationService({
      webhookUrl: process.env.ALERT_WEBHOOK_URL,
      emitToConsole: (process.env.ALERT_CONSOLE ?? "true").toLowerCase() !== "false",
    });
  }
  return sharedNotifier;
}

export function getExecutionLogger(): ExecutionLogger {
  return ensureExecutionLogger();
}

export function getRiskEngine(): RiskEngine {
  return ensureRiskEngine(ensureExecutionLogger());
}

export function getNotifier(): NotificationService {
  return ensureNotificationService();
}

export async function getExecutionMetrics(): Promise<ExecutionMetrics> {
  return ensureExecutionLogger().getMetrics();
}

export async function getExecutionHistory(options?: ExecutionHistoryOptions) {
  return ensureExecutionLogger().getHistory(options);
}
