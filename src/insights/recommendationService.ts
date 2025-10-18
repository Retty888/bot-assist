import { parseTradeSignal, type TradeSignal } from "../trading/tradeSignalParser.js";

type RecommendationFeatureKey = "trailingStop" | "grid" | "trailEntry";

type HintSeverity = "info" | "success" | "warning" | "danger";

type HintSlot = "signal" | "trailingStop" | "grid" | "trailEntry" | "global";

export interface RecommendationHintAction {
  readonly feature: RecommendationFeatureKey;
  readonly enable?: boolean;
  readonly params?: Record<string, number | string | boolean>;
  readonly disable?: readonly RecommendationFeatureKey[];
  readonly label?: string;
}

export interface RecommendationHint {
  readonly id: string;
  readonly slot: HintSlot;
  readonly title: string;
  readonly message: string;
  readonly badge: string;
  readonly tooltip?: string;
  readonly severity: HintSeverity;
  readonly action?: RecommendationHintAction;
}

export interface MarketSnapshot {
  readonly price: number;
  readonly atr: number;
  readonly volatility: number;
  readonly liquidityScore: number;
  readonly fundingRate: number;
}

export interface RecommendationContext {
  readonly symbol?: string;
  readonly rawSymbol?: string;
  readonly positionSize?: number;
  readonly notionalUsd?: number;
  readonly price?: number;
  readonly atrPercent?: number;
  readonly volatility?: number;
  readonly fundingRate?: number;
}

export interface RecommendationRequest {
  readonly text: string;
  readonly market?: Partial<MarketSnapshot>;
}

export interface RecommendationResponse {
  readonly hints: readonly RecommendationHint[];
  readonly context: RecommendationContext;
}

const MARKET_REFERENCE: Record<string, MarketSnapshot> = {
  BTC: { price: 62000, atr: 980, volatility: 3.8, liquidityScore: 850, fundingRate: 0.018 },
  ETH: { price: 3100, atr: 120, volatility: 4.6, liquidityScore: 520, fundingRate: 0.021 },
  SOL: { price: 150, atr: 8.8, volatility: 6.9, liquidityScore: 210, fundingRate: 0.024 },
  OP: { price: 2.4, atr: 0.19, volatility: 8.4, liquidityScore: 42, fundingRate: 0.027 },
  ARB: { price: 1.1, atr: 0.08, volatility: 7.5, liquidityScore: 36, fundingRate: 0.025 },
  AVAX: { price: 38, atr: 2.1, volatility: 5.7, liquidityScore: 160, fundingRate: 0.02 },
};

function inferSymbolFromText(text: string): string | undefined {
  const match = text.match(/\b([A-Z]{3,5})\b/);
  if (!match) {
    return undefined;
  }
  const symbol = match[1].toUpperCase();
  if (symbol in MARKET_REFERENCE) {
    return symbol;
  }
  return symbol;
}

function resolveMarketSnapshot(
  symbol: string | undefined,
  overrides: Partial<MarketSnapshot> | undefined,
): MarketSnapshot | undefined {
  const baseSymbol = symbol?.toUpperCase();
  const reference = baseSymbol ? MARKET_REFERENCE[baseSymbol] : undefined;
  if (!reference && !overrides) {
    return undefined;
  }
  const price = overrides?.price ?? reference?.price;
  const atr = overrides?.atr ?? reference?.atr;
  if (!(price && atr)) {
    return undefined;
  }
  return {
    price,
    atr,
    volatility: overrides?.volatility ?? reference?.volatility ?? 3.5,
    liquidityScore: overrides?.liquidityScore ?? reference?.liquidityScore ?? 75,
    fundingRate: overrides?.fundingRate ?? reference?.fundingRate ?? 0.015,
  };
}

function computeAtrPercent(snapshot: MarketSnapshot): number {
  return (snapshot.atr / snapshot.price) * 100;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function roundTo(value: number, digits: number): number {
  const multiplier = 10 ** digits;
  return Math.round(value * multiplier) / multiplier;
}

function calculateNotional(signal: TradeSignal | undefined, snapshot: MarketSnapshot | undefined): number | undefined {
  if (!signal) {
    return undefined;
  }
  const size = signal.size;
  if (!(size > 0)) {
    return undefined;
  }
  const price = signal.entryPrice ?? snapshot?.price;
  if (!(price && price > 0)) {
    return undefined;
  }
  return size * price;
}

function buildTrailingStopHint(
  symbol: string | undefined,
  snapshot: MarketSnapshot,
): RecommendationHint {
  const atrPercent = computeAtrPercent(snapshot);
  const suggested = clamp(atrPercent * 1.35, 0.15, 12);
  return {
    id: `trailing-${symbol ?? "unknown"}`,
    slot: "trailingStop",
    title: "ATR-based trailing stop",
    message: `ATR near ${(atrPercent).toFixed(2)}% implies a ${suggested.toFixed(2)}% trailing stop keeps room for volatility.`,
    badge: "ATR",
    tooltip: `ATR ${snapshot.atr.toFixed(2)} ≈ ${(atrPercent).toFixed(2)}% of price ${snapshot.price.toFixed(2)}.`,
    severity: "info",
    action: {
      feature: "trailingStop",
      enable: true,
      params: { value: roundTo(suggested, 2), unit: "percent" },
    },
  };
}

function buildGridHint(symbol: string | undefined, snapshot: MarketSnapshot): RecommendationHint {
  const volatility = snapshot.volatility;
  const levels = clamp(Math.round(clamp(volatility / 1.8, 2, 6)), 2, 6);
  const spacingPercent = clamp(volatility / (levels * 1.6), 0.15, 6);
  return {
    id: `grid-${symbol ?? "unknown"}`,
    slot: "grid",
    title: "Scale entries with a ladder",
    message: `${levels} levels at ~${spacingPercent.toFixed(2)}% spacing balance ${volatility.toFixed(1)}% volatility.`,
    badge: "Grid",
    tooltip: `Volatility ${volatility.toFixed(1)}% → spacing ${spacingPercent.toFixed(2)}%.`,
    severity: "info",
    action: {
      feature: "grid",
      enable: true,
      params: { levels, spacingValue: roundTo(spacingPercent, 2), unit: "percent" },
      disable: ["trailEntry"],
    },
  };
}

function buildTrailingEntryHint(symbol: string | undefined, snapshot: MarketSnapshot): RecommendationHint {
  const volatility = snapshot.volatility;
  const levels = clamp(Math.round(clamp(volatility / 1.4, 3, 8)), 3, 8);
  const stepPercent = clamp(volatility / (levels * 1.4), 0.1, 4);
  return {
    id: `trail-entry-${symbol ?? "unknown"}`,
    slot: "trailEntry",
    title: "Follow momentum with trailing entries",
    message: `${levels} trailing levels at ${stepPercent.toFixed(2)}% step react to ${volatility.toFixed(1)}% swings.`,
    badge: "Flow",
    tooltip: `Momentum ${volatility.toFixed(1)}% → step ${stepPercent.toFixed(2)}%.`,
    severity: "success",
    action: {
      feature: "trailEntry",
      enable: true,
      params: { levels, stepValue: roundTo(stepPercent, 2), unit: "percent" },
      disable: ["grid"],
    },
  };
}

function buildPositionRiskHint(
  symbol: string | undefined,
  notionalUsd: number,
  snapshot: MarketSnapshot,
): RecommendationHint | undefined {
  const liquidityUsd = snapshot.liquidityScore * 1_000_000;
  if (!(liquidityUsd > 0)) {
    return undefined;
  }
  const utilization = (notionalUsd / liquidityUsd) * 100;
  if (!(utilization > 5)) {
    return undefined;
  }
  const severity: HintSeverity = utilization > 18 ? "danger" : "warning";
  const badge = severity === "danger" ? "Risk" : "Size";
  const title = severity === "danger" ? "Position dominates venue liquidity" : "Large relative position";
  return {
    id: `position-${symbol ?? "unknown"}`,
    slot: "signal",
    title,
    message: `Notional ≈ $${notionalUsd.toFixed(0)} consumes ${utilization.toFixed(1)}% of daily liquidity. Consider scaling down.`,
    badge,
    severity,
    tooltip: `Liquidity score ${snapshot.liquidityScore.toFixed(0)}M vs. position $${notionalUsd.toFixed(0)}.`,
  };
}

function buildFundingHint(symbol: string | undefined, snapshot: MarketSnapshot): RecommendationHint | undefined {
  const funding = snapshot.fundingRate;
  if (!Number.isFinite(funding)) {
    return undefined;
  }
  if (Math.abs(funding) < 0.02) {
    return undefined;
  }
  const severity: HintSeverity = Math.abs(funding) > 0.05 ? "danger" : "warning";
  const direction = funding > 0 ? "paying" : "earning";
  return {
    id: `funding-${symbol ?? "unknown"}`,
    slot: "global",
    title: "Funding pressure",
    message: `Funding ${funding > 0 ? "cost" : "rebate"} at ${(funding * 100).toFixed(2)}% — you're ${direction} funding every 8h.`,
    badge: "Funding",
    severity,
    tooltip: `Current funding ${(funding * 100).toFixed(2)}%.`,
  };
}

function buildParseWarning(message: string): RecommendationHint {
  return {
    id: "unparsed-signal",
    slot: "global",
    title: "Could not fully parse signal",
    message,
    badge: "Parse",
    severity: "warning",
    tooltip: message,
  };
}

export function buildRecommendations(request: RecommendationRequest): RecommendationResponse {
  const text = request.text.trim();
  const hints: RecommendationHint[] = [];
  if (!text) {
    return {
      hints,
      context: {},
    };
  }

  let parsed: TradeSignal | undefined;
  let parseErrorMessage: string | undefined;
  try {
    parsed = parseTradeSignal(text);
  } catch (error) {
    parseErrorMessage = error instanceof Error ? error.message : "Unable to parse signal.";
    hints.push(buildParseWarning(parseErrorMessage));
  }

  const symbol = parsed?.symbol ?? inferSymbolFromText(text);
  const market = resolveMarketSnapshot(symbol, request.market);

  const notionalUsd = calculateNotional(parsed, market);

  const context: RecommendationContext = {
    symbol,
    rawSymbol: parsed?.rawSymbol,
    positionSize: parsed?.size,
    price: market?.price,
    atrPercent: market ? roundTo(computeAtrPercent(market), 2) : undefined,
    volatility: market?.volatility,
    fundingRate: market?.fundingRate,
    notionalUsd: notionalUsd ? roundTo(notionalUsd, 2) : undefined,
  };

  if (market) {
    hints.push(buildTrailingStopHint(symbol, market));

    if (market.volatility >= 5.5) {
      hints.push(buildTrailingEntryHint(symbol, market));
    } else {
      hints.push(buildGridHint(symbol, market));
    }

    const positionHint = notionalUsd ? buildPositionRiskHint(symbol, notionalUsd, market) : undefined;
    if (positionHint) {
      hints.push(positionHint);
    }

    const fundingHint = buildFundingHint(symbol, market);
    if (fundingHint) {
      hints.push(fundingHint);
    }
  }

  if (!market && !parseErrorMessage) {
    hints.push({
      id: "missing-market-data",
      slot: "global",
      title: "No market reference data",
      message: "Unable to locate reference metrics for the provided symbol.",
      badge: "Data",
      severity: "warning",
    });
  }

  return { hints, context };
}
