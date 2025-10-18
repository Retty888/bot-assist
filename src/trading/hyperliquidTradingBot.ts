import { ExchangeClient, HttpTransport, InfoClient, type OrderParameters } from "@nktkas/hyperliquid";

import type { ExecutionMode } from "../storage/historyStore.js";
import { ExecutionLogger, type ExecutionLogStatus } from "../telemetry/executionLogger.js";
import { NotificationService } from "../telemetry/notificationService.js";
import { RiskEngine } from "../risk/riskEngine.js";
import type { RiskViolation } from "../risk/types.js";
import {
  computeNotionalUsd,
  estimateLeverage,
  estimateMaxRiskUsd,
  resolveEntryPrice,
} from "./executionMath.js";

import {
  normalizeSymbol,
  parseTradeSignal,
  type DistanceConfig,
  type TargetAllocation,
  type TradeSignal,
} from "./tradeSignalParser.js";

type MetaAndAssetCtxsTuple = Awaited<ReturnType<InfoClient["metaAndAssetCtxs"]>>;
type AssetContexts = MetaAndAssetCtxsTuple[1];

export interface HyperliquidBotOptions {
  readonly privateKey?: string;
  readonly isTestnet?: boolean;
  readonly slippageBps?: number;
  readonly metaRefreshIntervalMs?: number;
  readonly infoClient?: InfoClient;
  readonly exchangeClient?: ExchangeClient;
  readonly transport?: HttpTransport;
  readonly executionLogger?: ExecutionLogger;
  readonly riskEngine?: RiskEngine;
  readonly notificationService?: NotificationService;
}

type ExchangeOrderResponse = Awaited<ReturnType<ExchangeClient["order"]>>;

export interface ExecutionResult {
  readonly signal: TradeSignal;
  readonly payload: OrderParameters;
  readonly response: ExchangeOrderResponse;
}

export interface ExecutionContext {
  readonly mode?: ExecutionMode;
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

interface EntryContext {
  readonly basePrice: number;
  readonly tif: "Gtc" | "Ioc";
  readonly midPrice: number;
}

interface EntryOrderPlan {
  readonly price: number;
  readonly tif: "Gtc" | "Ioc";
  readonly size: string;
}

const DEFAULT_SLIPPAGE_BPS = 50; // 0.5%
const DEFAULT_CACHE_TTL_MS = 5_000;
const FRACTION_TOLERANCE = 1e-6;

function assertNever(value: never): never {
  throw new Error(`Unexpected value: ${value as unknown as string}`);
}

function oppositeSide(side: TradeSignal["side"]): boolean {
  if (side === "long") {
    return false;
  }
  if (side === "short") {
    return true;
  }
  return assertNever(side);
}

function entrySide(side: TradeSignal["side"]): boolean {
  if (side === "long") {
    return true;
  }
  if (side === "short") {
    return false;
  }
  return assertNever(side);
}

export class HyperliquidTradingBot {
  private readonly info: InfoClient;
  private readonly exchange: ExchangeClient;
  private readonly slippageBps: number;
  private readonly cacheTtlMs: number;
  private readonly logger?: ExecutionLogger;
  private readonly riskEngine?: RiskEngine;
  private readonly notifier?: NotificationService;

  private cache?: CachedAssets;

  constructor(options: HyperliquidBotOptions) {
    if (!options.exchangeClient && !options.privateKey) {
      throw new Error("Either exchangeClient or privateKey must be provided");
    }

    const transport = options.transport ?? new HttpTransport({ isTestnet: options.isTestnet ?? false });
    this.info = options.infoClient ?? new InfoClient({ transport });
    this.exchange =
      options.exchangeClient ?? new ExchangeClient({ wallet: options.privateKey as string, transport });
    this.slippageBps = options.slippageBps ?? DEFAULT_SLIPPAGE_BPS;
    this.cacheTtlMs = options.metaRefreshIntervalMs ?? DEFAULT_CACHE_TTL_MS;
    this.logger = options.executionLogger;
    this.riskEngine = options.riskEngine;
    this.notifier = options.notificationService;
  }

  async executeSignalText(text: string, context?: ExecutionContext): Promise<ExecutionResult> {
    const signal = parseTradeSignal(text);
    return this.executeSignal(signal, context);
  }

  async executeSignal(signal: TradeSignal, context: ExecutionContext = {}): Promise<ExecutionResult> {
    const mode: ExecutionMode = context.mode ?? "test";
    const cache = await this.ensureCache();
    const asset = this.resolveAsset(cache, signal.symbol);
    const entryContext = this.resolveEntryContext(signal, asset, cache);
    const payload = this.buildOrderPayload(signal, asset, entryContext);
    const riskAssessment = await this.evaluateRisk(signal, payload, mode);
    if (!riskAssessment.allowed) {
      const reason = riskAssessment.violations.map((violation) => violation.message).join("; ")
        || "Risk guard rejected execution";
      await this.logger?.logFailure({
        signal,
        payload,
        mode,
        status: "blocked",
        message: reason,
        riskViolations: riskAssessment.violations,
      });
      await this.notifier?.notify({
        type: "risk-guard",
        severity: "critical",
        message: `Risk guard blocked ${signal.side} ${signal.symbol}`,
        details: {
          reason,
          violations: riskAssessment.violations,
        },
      });
      throw new Error(reason);
    }

    let response: ExchangeOrderResponse;
    try {
      response = await this.exchange.order(payload);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Exchange order failed";
      await this.logger?.logFailure({
        signal,
        payload,
        mode,
        status: "error",
        message,
      });
      await this.notifier?.notify({
        type: "exchange-error",
        severity: "critical",
        message,
        details: {
          symbol: signal.symbol,
          side: signal.side,
        },
      });
      throw error;
    }

    const derived = deriveExecutionStatus(response);
    if (derived.status === "error" || derived.status === "rejected") {
      await this.notifier?.notify({
        type: "exchange-error",
        severity: derived.status === "error" ? "critical" : "warning",
        message: derived.message ?? `Unexpected response for ${signal.symbol}`,
        details: {
          symbol: signal.symbol,
          side: signal.side,
          status: derived.status,
        },
      });
    }

    await this.logger?.logExecution({
      signal,
      payload,
      response,
      mode,
      status: derived.status,
      message: derived.message,
      riskViolations: riskAssessment.violations,
    });

    return { signal, payload, response };
  }

  private async evaluateRisk(
    signal: TradeSignal,
    payload: OrderParameters,
    mode: ExecutionMode,
  ): Promise<{ allowed: boolean; violations: readonly RiskViolation[] }> {
    if (!this.riskEngine) {
      return { allowed: true, violations: [] };
    }
    const entryPrice = resolveEntryPrice(signal, payload);
    const notionalUsd = computeNotionalUsd(signal.size, entryPrice);
    const estimatedRiskUsd = estimateMaxRiskUsd(signal, entryPrice);
    const leverage = estimateLeverage(
      notionalUsd,
      this.riskEngine.getConfig().accountEquityUsd,
    );
    const assessment = await this.riskEngine.evaluate({
      signal,
      payload,
      mode,
      entryPriceUsd: entryPrice,
      notionalUsd,
      leverage,
      estimatedRiskUsd,
    });
    return { allowed: assessment.allowed, violations: assessment.violations };
  }

  private async ensureCache(): Promise<CachedAssets> {
    const now = Date.now();
    if (this.cache && now - this.cache.timestamp < this.cacheTtlMs) {
      return this.cache;
    }

    const [meta, contexts] = await this.info.metaAndAssetCtxs();
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

    this.cache = {
      timestamp: now,
      assetsBySymbol,
      contexts,
    };
    return this.cache;
  }

  private resolveAsset(cache: CachedAssets, symbol: string): AssetMeta {
    const key = normalizeSymbol(symbol);
    const asset = cache.assetsBySymbol.get(key);
    if (!asset) {
      throw new Error(`Symbol "${symbol}" is not available on Hyperliquid`);
    }
    return asset;
  }

  private resolveEntryContext(signal: TradeSignal, asset: AssetMeta, cache: CachedAssets): EntryContext {
    const context = cache.contexts[asset.id];
    if (!context || context.midPx === null) {
      throw new Error("Unable to fetch mid price from Hyperliquid");
    }

    const mid = Number(context.midPx);
    if (!Number.isFinite(mid) || mid <= 0) {
      throw new Error("Received invalid mid price from Hyperliquid");
    }

    if (signal.execution === "limit" && signal.entryPrice !== undefined) {
      return {
        basePrice: signal.entryPrice,
        tif: "Gtc",
        midPrice: mid,
      } satisfies EntryContext;
    }

    const slippage = this.slippageBps / 10_000;
    const factor = signal.side === "long" ? 1 + slippage : 1 - slippage;
    const price = mid * factor;
    const tif: "Gtc" | "Ioc" = signal.execution === "market" ? "Ioc" : "Gtc";

    return {
      basePrice: price,
      tif,
      midPrice: mid,
    } satisfies EntryContext;
  }

  private buildOrderPayload(
    signal: TradeSignal,
    asset: AssetMeta,
    entryContext: EntryContext,
  ): OrderParameters {
    const entryPlans = this.buildEntryPlans(signal, asset, entryContext);
    if (entryPlans.length === 0) {
      throw new Error("No entry orders generated for signal");
    }

    const orders: OrderParameters["orders"] = [];
    const entryFlag = entrySide(signal.side);

    entryPlans.forEach((plan) => {
      const price = this.formatPrice(plan.price);
      orders.push({
        a: asset.id,
        b: entryFlag,
        p: price,
        s: plan.size,
        r: false,
        t: {
          limit: {
            tif: plan.tif,
          },
        },
      } as OrderParameters["orders"][number]);
    });

    const exitSide = oppositeSide(signal.side);
    const takeProfitUnits = this.allocateLevelUnits(signal.size, signal.takeProfits, asset.sizeDecimals);
    const factor = 10 ** asset.sizeDecimals;
    let takeProfitOrders = 0;
    signal.takeProfits.forEach((target, index) => {
      const units = takeProfitUnits[index];
      if (!(units > 0)) {
        throw new Error("Unable to allocate size for take profit levels with current precision");
      }
      const formattedTarget = this.formatPrice(target.price);
      const sizeValue = units / factor;
      const formattedSize = this.formatSize(sizeValue, asset.sizeDecimals);
      orders.push({
        a: asset.id,
        b: exitSide,
        p: formattedTarget,
        s: formattedSize,
        r: true,
        t: {
          trigger: {
            isMarket: true,
            triggerPx: formattedTarget,
            tpsl: "tp",
          },
        },
      } as OrderParameters["orders"][number]);
      takeProfitOrders += 1;
    });

    const stopOrders = this.buildStopOrders(signal, asset, entryPlans);
    stopOrders.forEach((order) => orders.push(order));

    if (takeProfitOrders === 0) {
      throw new Error("No take profit orders generated for signal");
    }

    const grouping = takeProfitOrders > 0 ? "positionTpsl" : "na";
    return {
      orders,
      grouping,
    };
  }

  private buildEntryPlans(
    signal: TradeSignal,
    asset: AssetMeta,
    entryContext: EntryContext,
  ): EntryOrderPlan[] {
    if (signal.entryStrategy.type === "single") {
      return [
        {
          price: entryContext.basePrice,
          tif: entryContext.tif,
          size: this.formatSize(signal.size, asset.sizeDecimals),
        },
      ];
    }

    const levels = signal.entryStrategy.levels;
    if (!(levels > 0)) {
      throw new Error("Entry strategy levels must be positive");
    }

    const referencePrice = signal.entryPrice ?? entryContext.basePrice;
    if (!(referencePrice > 0)) {
      throw new Error("Entry reference price must be positive");
    }

    const sizeUnits = this.allocateLevelUnits(
      signal.size,
      Array.from({ length: levels }, () => ({})),
      asset.sizeDecimals,
    );
    const factor = 10 ** asset.sizeDecimals;
    const stepConfig: DistanceConfig =
      signal.entryStrategy.type === "grid"
        ? signal.entryStrategy.spacing
        : signal.entryStrategy.step;
    const accumulate = signal.entryStrategy.type === "trailing";
    const direction = signal.side === "long" ? -1 : 1;

    const plans: EntryOrderPlan[] = [];
    for (let i = 0; i < levels; ++i) {
      const price = this.computeStrategyPrice(referencePrice, stepConfig, direction, i, accumulate);
      const units = sizeUnits[i];
      if (!(units > 0)) {
        throw new Error("Entry strategy levels result in zero-sized order due to precision constraints");
      }
      const sizeValue = units / factor;
      plans.push({
        price,
        tif: "Gtc",
        size: this.formatSize(sizeValue, asset.sizeDecimals),
      });
    }
    return plans;
  }

  private computeStrategyPrice(
    referencePrice: number,
    spacing: DistanceConfig,
    direction: number,
    levelIndex: number,
    accumulate: boolean,
  ): number {
    if (levelIndex === 0) {
      return referencePrice;
    }

    if (spacing.mode === "percent") {
      const percent = spacing.value / 100;
      const factor = accumulate
        ? Math.pow(1 + direction * percent, levelIndex)
        : 1 + direction * percent * levelIndex;
      const price = referencePrice * factor;
      if (!(price > 0)) {
        throw new Error("Computed entry price is not positive");
      }
      return price;
    }

    const baseStep = spacing.value;
    const multiplier = accumulate ? (levelIndex * (levelIndex + 1)) / 2 : levelIndex;
    const price = referencePrice + direction * baseStep * multiplier;
    if (!(price > 0)) {
      throw new Error("Computed entry price is not positive");
    }
    return price;
  }

  private buildStopOrders(
    signal: TradeSignal,
    asset: AssetMeta,
    entryPlans: EntryOrderPlan[],
  ): OrderParameters["orders"] {
    const baseLevels = signal.stopLosses.map<TargetAllocation>((level) => ({
      price: level.price,
      sizeFraction: level.sizeFraction,
      label: level.label,
    }));
    const trailingPrice = this.computeTrailingStopPrice(signal, entryPlans);

    if (trailingPrice !== undefined) {
      if (baseLevels.length === 0) {
        baseLevels.push({ price: trailingPrice });
      } else {
        const index = this.getExtremeStopIndex(baseLevels, signal.side);
        const current = baseLevels[index];
        const adjustedPrice =
          signal.side === "long"
            ? Math.max(current.price, trailingPrice)
            : Math.min(current.price, trailingPrice);
        baseLevels[index] = {
          ...current,
          price: adjustedPrice,
        };
      }
    }

    if (baseLevels.length === 0) {
      throw new Error("Stop loss must be provided");
    }

    const units = this.allocateLevelUnits(signal.size, baseLevels, asset.sizeDecimals);
    const exitSide = oppositeSide(signal.side);
    const orders: OrderParameters["orders"] = [];
    const factor = 10 ** asset.sizeDecimals;

    for (let i = 0; i < baseLevels.length; ++i) {
      const unitsForLevel = units[i];
      if (!(unitsForLevel > 0)) {
        throw new Error("Unable to allocate size for stop levels with current precision");
      }
      const sizeValue = unitsForLevel / factor;
      const formattedSize = this.formatSize(sizeValue, asset.sizeDecimals);
      const formattedPrice = this.formatPrice(baseLevels[i].price);
      orders.push({
        a: asset.id,
        b: exitSide,
        p: formattedPrice,
        s: formattedSize,
        r: true,
        t: {
          trigger: {
            isMarket: true,
            triggerPx: formattedPrice,
            tpsl: "sl",
          },
        },
      } as OrderParameters["orders"][number]);
    }

    return orders;
  }

  private computeTrailingStopPrice(
    signal: TradeSignal,
    entryPlans: EntryOrderPlan[],
  ): number | undefined {
    const trailing = signal.trailingStop;
    if (!trailing) {
      return undefined;
    }

    if (entryPlans.length === 0) {
      throw new Error("Entry plans are required to resolve trailing stop price");
    }

    const reference =
      signal.side === "long"
        ? Math.max(...entryPlans.map((plan) => plan.price))
        : Math.min(...entryPlans.map((plan) => plan.price));

    const offset = trailing.mode === "percent" ? reference * (trailing.value / 100) : trailing.value;
    const price = signal.side === "long" ? reference - offset : reference + offset;

    if (!(price > 0)) {
      throw new Error("Trailing stop offset results in non-positive price");
    }

    if (signal.side === "long" && price >= reference) {
      throw new Error("Trailing stop must remain below entry price for long positions");
    }
    if (signal.side === "short" && price <= reference) {
      throw new Error("Trailing stop must remain above entry price for short positions");
    }

    return price;
  }

  private getExtremeStopIndex(
    levels: ReadonlyArray<{ price: number }>,
    side: TradeSignal["side"],
  ): number {
    if (levels.length === 0) {
      throw new Error("Stop levels are required");
    }
    let index = 0;
    for (let i = 1; i < levels.length; ++i) {
      if (side === "long") {
        if (levels[i].price > levels[index].price) {
          index = i;
        }
      } else {
        if (levels[i].price < levels[index].price) {
          index = i;
        }
      }
    }
    return index;
  }

  private allocateLevelUnits(
    total: number,
    levels: ReadonlyArray<{ sizeFraction?: number }>,
    decimals: number,
  ): number[] {
    if (!(total > 0)) {
      throw new Error("Position size must be positive to allocate levels");
    }
    if (levels.length === 0) {
      return [];
    }

    const factor = 10 ** decimals;
    const totalUnits = Math.round(total * factor);
    if (!(totalUnits > 0)) {
      throw new Error("Position size is too small for the given precision");
    }

    const fractions = new Array(levels.length).fill(0);
    let specifiedSum = 0;
    let unspecifiedCount = 0;

    for (let i = 0; i < levels.length; ++i) {
      const fraction = levels[i].sizeFraction;
      if (fraction === undefined) {
        unspecifiedCount += 1;
        continue;
      }
      if (!(fraction > 0)) {
        throw new Error("Level fraction must be positive when provided");
      }
      fractions[i] = fraction;
      specifiedSum += fraction;
    }

    if (specifiedSum > 1 + FRACTION_TOLERANCE) {
      throw new Error("Allocated fractions exceed 100% of position size");
    }

    if (unspecifiedCount > 0) {
      const remaining = 1 - specifiedSum;
      if (remaining <= FRACTION_TOLERANCE) {
        throw new Error("No remaining size available for unspecified levels");
      }
      const share = remaining / unspecifiedCount;
      for (let i = 0; i < levels.length; ++i) {
        if (levels[i].sizeFraction === undefined) {
          fractions[i] = share;
        }
      }
    } else {
      if (specifiedSum <= FRACTION_TOLERANCE) {
        const equal = 1 / levels.length;
        fractions.fill(equal);
      } else if (Math.abs(specifiedSum - 1) > FRACTION_TOLERANCE) {
        const scale = 1 / specifiedSum;
        for (let i = 0; i < fractions.length; ++i) {
          fractions[i] *= scale;
        }
      }
    }

    const rawUnits = fractions.map((fraction) => fraction * totalUnits);
    const units = rawUnits.map((value) => Math.floor(value));
    let allocated = units.reduce((sum, value) => sum + value, 0);
    let remainderUnits = totalUnits - allocated;

    const remainderOrder = rawUnits
      .map((value, index) => ({ index, remainder: value - units[index] }))
      .sort((a, b) => b.remainder - a.remainder);

    for (const item of remainderOrder) {
      if (remainderUnits <= 0) {
        break;
      }
      units[item.index] += 1;
      remainderUnits -= 1;
    }

    if (remainderUnits > 0) {
      for (let i = 0; i < units.length && remainderUnits > 0; ++i) {
        units[i] += 1;
        remainderUnits -= 1;
      }
    }

    return units;
  }

  private formatSize(value: number, decimals: number): string {
    if (!(value > 0)) {
      throw new Error("Position size must be positive");
    }
    const factor = 10 ** decimals;
    const rounded = Math.round(value * factor) / factor;
    return rounded.toFixed(decimals).replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
  }

  private formatPrice(value: number): string {
    if (!(value > 0)) {
      throw new Error("Price must be positive");
    }
    const str = value.toFixed(6);
    return str.replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
  }
}

function deriveExecutionStatus(
  response: ExchangeOrderResponse,
): { status: ExecutionLogStatus; message?: string } {
  const topLevelStatus = typeof (response as { status?: unknown }).status === "string"
    ? ((response as { status: string }).status.toLowerCase())
    : undefined;
  const orderStatuses = Array.isArray((response as { data?: { statuses?: unknown } }).data?.statuses)
    ? (response as { data: { statuses: Array<{ status?: string }> } }).data.statuses
        .map((item) => (typeof item?.status === "string" ? item.status.toLowerCase() : undefined))
        .filter((value): value is string => Boolean(value))
    : [];

  if (topLevelStatus && topLevelStatus !== "ok") {
    return { status: "error", message: `Exchange responded with status ${topLevelStatus}` };
  }

  if (orderStatuses.some((status) => status.includes("reject") || status.includes("fail"))) {
    return { status: "rejected", message: "One or more orders were rejected by the exchange" };
  }

  if (orderStatuses.some((status) => status.includes("partial"))) {
    return { status: "partial", message: "Order partially filled" };
  }

  if (orderStatuses.some((status) => status.includes("error"))) {
    return { status: "error", message: "Exchange returned error status for order" };
  }

  return { status: "fulfilled" };
}
