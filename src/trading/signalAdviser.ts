import {
  type EntryStrategy,
  type ExecutionType,
  type RiskLabel,
  type TradeSignal,
} from "./tradeSignalParser.js";

export interface SignalAdviceOptions {
  readonly defaultLeverage?: number;
  readonly minLeverage?: number;
  readonly maxLeverage?: number;
  readonly volatilityBias?: number;
}

export interface SignalAdvice {
  readonly recommendedLeverage: number;
  readonly execution: ExecutionType;
  readonly entryStrategy: EntryStrategy;
  readonly adjustedSignal: TradeSignal;
  readonly notes: readonly string[];
}

const RISK_MULTIPLIERS: Record<RiskLabel, number> = {
  low: 1.15,
  medium: 1,
  high: 0.75,
  extreme: 0.55,
};

const TIMEFRAME_KEYWORDS: Record<string, number> = {
  scalp: 5,
  intraday: 240,
  swing: 1_440,
  position: 10_080,
};

export function adviseSignal(signal: TradeSignal, options: SignalAdviceOptions = {}): SignalAdvice {
  const notes: string[] = [];

  const baselineLeverage = signal.leverage ?? options.defaultLeverage ?? 5;
  const volatilityBias = options.volatilityBias ?? 1;
  let leverage = baselineLeverage;

  if (signal.riskLabel && RISK_MULTIPLIERS[signal.riskLabel] !== undefined) {
    const multiplier = RISK_MULTIPLIERS[signal.riskLabel];
    leverage *= multiplier;
    if (multiplier !== 1) {
      notes.push(`Risk profile ${signal.riskLabel} applied multiplier ${multiplier.toFixed(2)}`);
    }
  }

  const dominantMinutes = deriveDominantTimeframe(signal.timeframeHints);
  if (dominantMinutes !== undefined) {
    const timeframeMultiplier = computeTimeframeMultiplier(dominantMinutes);
    leverage *= timeframeMultiplier;
    if (timeframeMultiplier !== 1) {
      notes.push(
        `Timeframe ${dominantMinutes}m adjusted leverage by multiplier ${timeframeMultiplier.toFixed(2)}`,
      );
    }
  }

  if (volatilityBias !== 1) {
    leverage *= volatilityBias;
    notes.push(`Volatility bias ${volatilityBias.toFixed(2)} applied to leverage`);
  }

  const providedMin = sanitizeLeverageBound(options.minLeverage, 1);
  const providedMax = sanitizeLeverageBound(options.maxLeverage, 25);
  const minLeverage = Math.min(providedMin, providedMax);
  const maxLeverage = Math.max(providedMin, providedMax);
  let recommendedLeverage = clamp(leverage, minLeverage, maxLeverage);

  if (recommendedLeverage !== leverage) {
    notes.push(
      `Leverage clamped to range [${minLeverage.toFixed(2)}, ${maxLeverage.toFixed(2)}]`,
    );
  }

  recommendedLeverage = Math.round(recommendedLeverage * 100) / 100;

  let execution: ExecutionType = signal.execution;
  if (signal.riskLabel === "extreme" && execution !== "limit") {
    execution = "limit";
    notes.push("Extreme risk profile prefers limit execution");
  } else if (dominantMinutes !== undefined && dominantMinutes <= 15 && execution !== "market") {
    execution = "market";
    notes.push("Fast timeframe detected; switching to market execution");
  } else if (dominantMinutes !== undefined && dominantMinutes >= 240 && execution !== "limit") {
    execution = "limit";
    notes.push("Slow timeframe detected; switching to limit execution");
  }

  const entryStrategy = deriveEntryStrategy(signal, dominantMinutes, notes);

  const adjustedSignal: TradeSignal = {
    ...signal,
    leverage: recommendedLeverage,
    execution,
    entryStrategy,
  };

  return {
    recommendedLeverage,
    execution,
    entryStrategy,
    adjustedSignal,
    notes,
  };
}

function deriveEntryStrategy(
  signal: TradeSignal,
  dominantMinutes: number | undefined,
  notes: string[],
): EntryStrategy {
  if (signal.entryStrategy.type !== "single") {
    return signal.entryStrategy;
  }

  const takeProfitCount = signal.takeProfits.length;

  if (dominantMinutes !== undefined && dominantMinutes <= 20) {
    const levels = Math.min(3, Math.max(2, takeProfitCount));
    const step = signal.riskLabel === "extreme" ? 0.2 : signal.riskLabel === "high" ? 0.3 : 0.4;
    notes.push(`Applied trailing entry (${levels} levels, ${step}% step) for rapid execution`);
    return {
      type: "trailing",
      levels,
      step: {
        mode: "percent",
        value: step,
      },
    } satisfies EntryStrategy;
  }

  if (dominantMinutes !== undefined && dominantMinutes >= 360) {
    const levels = Math.min(4, Math.max(2, takeProfitCount || 2));
    const spacing = signal.riskLabel === "low" ? 0.8 : signal.riskLabel === "medium" ? 0.6 : 0.5;
    notes.push(`Applied grid entry (${levels} levels, ${spacing}% spacing) for swing trade`);
    return {
      type: "grid",
      levels,
      spacing: {
        mode: "percent",
        value: spacing,
      },
    } satisfies EntryStrategy;
  }

  if (takeProfitCount >= 3) {
    const levels = Math.min(3, takeProfitCount);
    notes.push(`Distributed entries across ${levels} grid levels to align with targets`);
    return {
      type: "grid",
      levels,
      spacing: {
        mode: "percent",
        value: 0.45,
      },
    } satisfies EntryStrategy;
  }

  return signal.entryStrategy;
}

function computeTimeframeMultiplier(minutes: number): number {
  if (minutes <= 5) {
    return 0.8;
  }
  if (minutes <= 30) {
    return 0.9;
  }
  if (minutes <= 240) {
    return 1;
  }
  if (minutes <= 1_440) {
    return 1.1;
  }
  return 1.2;
}

function deriveDominantTimeframe(hints: readonly string[]): number | undefined {
  let best: number | undefined;
  for (const hint of hints) {
    const minutes = timeframeHintToMinutes(hint);
    if (minutes === undefined) {
      continue;
    }
    if (best === undefined || minutes < best) {
      best = minutes;
    }
  }
  return best;
}

function timeframeHintToMinutes(hint: string): number | undefined {
  const normalized = hint.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }

  const directMatch = /^([0-9]+)([mhdw])$/.exec(normalized);
  if (directMatch) {
    const value = Number.parseInt(directMatch[1], 10);
    const unit = directMatch[2];
    if (!(value > 0)) {
      return undefined;
    }
    switch (unit) {
      case "m":
        return value;
      case "h":
        return value * 60;
      case "d":
        return value * 1_440;
      case "w":
        return value * 10_080;
      default:
        return undefined;
    }
  }

  if (TIMEFRAME_KEYWORDS[normalized] !== undefined) {
    return TIMEFRAME_KEYWORDS[normalized];
  }

  return undefined;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
}

function sanitizeLeverageBound(bound: number | undefined, fallback: number): number {
  if (Number.isFinite(bound) && (bound as number) > 0) {
    return bound as number;
  }
  return fallback;
}
