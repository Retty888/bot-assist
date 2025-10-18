import type { EntryStrategy } from "../../trading/tradeSignalParser.js";
import {
  adviseSignal,
  deriveDominantTimeframe,
  resolveLeverageBounds,
} from "../../trading/signalAdviser.js";
import type {
  SignalAdvice,
  SignalAdviceOptions,
  TradeSignal,
} from "../../trading/signalAdviser.js";
import { evaluateHardRules } from "./hardRules.js";
import type {
  AdaptiveAdjustment,
  AdaptiveSignalAdvice,
  MarketKpiSnapshot,
  SignalHardRuleEvaluation,
} from "./types.js";

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function buildTrailingEntryFromTrend(
  baseline: EntryStrategy,
  kpis: MarketKpiSnapshot,
): EntryStrategy {
  const levels = clamp(Math.round(3 + kpis.trendStrength * 4), 3, 7);
  const stepPercent = clamp(kpis.volatilityScore / (levels * 1.8), 0.15, 1.2);
  if (baseline.type === "trailing") {
    return {
      ...baseline,
      levels,
      step: {
        mode: "percent",
        value: Number(stepPercent.toFixed(2)),
      },
    };
  }
  return {
    type: "trailing",
    levels,
    step: {
      mode: "percent",
      value: Number(stepPercent.toFixed(2)),
    },
  } satisfies EntryStrategy;
}

function buildGridFromLiquidity(
  baseline: EntryStrategy,
  kpis: MarketKpiSnapshot,
): EntryStrategy {
  const levels = clamp(Math.round(2 + (kpis.liquidityScore / 150) * 2), 2, 5);
  const spacing = clamp(kpis.volatilityScore / (levels * 2.4), 0.1, 1.5);
  if (baseline.type === "grid") {
    return {
      ...baseline,
      levels,
      spacing: {
        mode: "percent",
        value: Number(spacing.toFixed(2)),
      },
    };
  }
  return {
    type: "grid",
    levels,
    spacing: {
      mode: "percent",
      value: Number(spacing.toFixed(2)),
    },
  } satisfies EntryStrategy;
}

function computeRiskScore(kpis: MarketKpiSnapshot): number {
  const volatilityComponent = clamp(kpis.volatilityScore / 10, 0, 1);
  const drawdownComponent = clamp(kpis.drawdownPercent / 35, 0, 1);
  const slippageComponent = clamp(kpis.slippageBps / 150, 0, 1);
  const combined = volatilityComponent * 0.45 + drawdownComponent * 0.35 + slippageComponent * 0.2;
  return Number(combined.toFixed(4));
}

function adjustLeverage(
  advice: SignalAdvice,
  kpis: MarketKpiSnapshot,
  options: SignalAdviceOptions,
  adjustments: AdaptiveAdjustment[],
  riskScore: number,
): number {
  const { minLeverage, maxLeverage } = resolveLeverageBounds(options);
  let leverage = advice.recommendedLeverage;

  if (riskScore >= 0.55) {
    const reductionFactor = clamp(1 - (riskScore - 0.55) * 0.8, 0.35, 0.95);
    const reduced = clamp(leverage * reductionFactor, minLeverage, maxLeverage);
    adjustments.push({
      id: "dynamic-risk-threshold",
      description: "Dynamic risk pressure reduced leverage.",
      rationale: "High volatility/drawdown combo requires deleveraging.",
      applied: reduced !== leverage,
      delta: Number((reduced - leverage).toFixed(4)),
      details: `Risk score ${riskScore.toFixed(2)} with volatility ${kpis.volatilityScore.toFixed(2)}.`,
    });
    leverage = reduced;
  } else if (riskScore <= 0.35 && kpis.winRate >= 0.6) {
    const boostFactor = clamp(1 + (kpis.winRate - 0.6) * 0.4, 1, 1.18);
    const boosted = clamp(leverage * boostFactor, minLeverage, maxLeverage);
    adjustments.push({
      id: "performance-bonus",
      description: "Positive KPI regime allows a minor leverage boost.",
      rationale: "Sustained win-rate with low risk lets the strategy scale up slightly.",
      applied: boosted !== leverage,
      delta: Number((boosted - leverage).toFixed(4)),
      details: `Win-rate ${(kpis.winRate * 100).toFixed(1)}% with risk ${riskScore.toFixed(2)}.`,
    });
    leverage = boosted;
  }

  return Number(leverage.toFixed(2));
}

function adjustExecution(
  advice: SignalAdvice,
  kpis: MarketKpiSnapshot,
  adjustments: AdaptiveAdjustment[],
): "market" | "limit" {
  const { execution } = advice;
  if (kpis.liquidityScore < 120) {
    const applied = execution !== "limit";
    adjustments.push({
      id: "liquidity-guard",
      description: "Low liquidity enforces limit execution.",
      rationale: "Avoid high slippage on illiquid pairs.",
      applied,
      details: `Liquidity score ${kpis.liquidityScore.toFixed(1)} < 120`,
    });
    return applied ? "limit" : execution;
  }
  if (kpis.trendStrength >= 0.7) {
    const applied = execution !== "market";
    adjustments.push({
      id: "trend-urgency",
      description: "Strong trend urges market execution for immediacy.",
      rationale: "Momentum setups benefit from immediate fills.",
      applied,
      details: `Trend strength ${kpis.trendStrength.toFixed(2)} ≥ 0.70`,
    });
    return applied ? "market" : execution;
  }
  adjustments.push({
    id: "execution-stable",
    description: "No execution change required.",
    rationale: "Market conditions support current execution mode.",
    applied: false,
  });
  return execution;
}

function adjustEntryStrategy(
  baseline: EntryStrategy,
  execution: "market" | "limit",
  kpis: MarketKpiSnapshot,
  adjustments: AdaptiveAdjustment[],
): EntryStrategy {
  if (kpis.trendStrength >= 0.65) {
    adjustments.push({
      id: "trend-trailing-entry",
      description: "Momentum-driven trailing entry applied.",
      rationale: "High trend strength rewards adaptive trailing entries.",
      applied: true,
      details: `Trend strength ${kpis.trendStrength.toFixed(2)}.`,
    });
    return buildTrailingEntryFromTrend(baseline, kpis);
  }
  if (execution === "limit" && kpis.liquidityScore >= 150) {
    adjustments.push({
      id: "liquidity-grid-entry",
      description: "Grid entry tuned for book depth.",
      rationale: "Healthy liquidity enables staged limit orders.",
      applied: true,
      details: `Liquidity score ${kpis.liquidityScore.toFixed(1)} supports grid entries.`,
    });
    return buildGridFromLiquidity(baseline, kpis);
  }

  adjustments.push({
    id: "entry-unchanged",
    description: "Entry strategy kept as-is.",
    rationale: "Market KPIs do not mandate entry modifications.",
    applied: false,
  });
  return baseline;
}

export function adviseWithAdaptiveRules(
  signal: TradeSignal,
  options: SignalAdviceOptions = {},
  kpis?: MarketKpiSnapshot,
): AdaptiveSignalAdvice {
  const baseAdvice = adviseSignal(signal, options);
  const hardRules: SignalHardRuleEvaluation[] = evaluateHardRules({ signal, advice: baseAdvice, options });

  if (!kpis) {
    return {
      ...baseAdvice,
      hardRules,
      adaptiveAdjustments: [],
      riskScore: 0,
    };
  }

  const adjustments: AdaptiveAdjustment[] = [];
  const riskScore = computeRiskScore(kpis);
  const leverage = adjustLeverage(baseAdvice, kpis, options, adjustments, riskScore);
  const execution = adjustExecution(baseAdvice, kpis, adjustments);
  const entryStrategy = adjustEntryStrategy(baseAdvice.entryStrategy, execution, kpis, adjustments);

  const timeframe = deriveDominantTimeframe(signal.timeframeHints);
  const notes = [...baseAdvice.notes];
  notes.push(
    `Risk score ${riskScore.toFixed(2)} derived from volatility ${kpis.volatilityScore.toFixed(2)}, drawdown ${kpis.drawdownPercent.toFixed(1)}%, slippage ${kpis.slippageBps.toFixed(1)}bps.`,
  );
  if (execution !== baseAdvice.execution) {
    notes.push(`Execution adjusted from ${baseAdvice.execution} to ${execution} using market KPIs.`);
  }
  if (leverage !== baseAdvice.recommendedLeverage) {
    notes.push(`Leverage adjusted from ${baseAdvice.recommendedLeverage.toFixed(2)} to ${leverage.toFixed(2)} due to adaptive rules.`);
  }
  if (entryStrategy.type !== baseAdvice.entryStrategy.type || timeframe === undefined) {
    notes.push(`Entry strategy recalibrated (${baseAdvice.entryStrategy.type} → ${entryStrategy.type}).`);
  }

  const clone: <T>(value: T) => T =
    typeof globalThis.structuredClone === "function"
      ? globalThis.structuredClone
      : ((value: unknown) => JSON.parse(JSON.stringify(value))) as <T>(value: T) => T;

  const adjustedSignal: TradeSignal = clone({ ...signal, leverage, execution, entryStrategy });

  return {
    recommendedLeverage: leverage,
    execution,
    entryStrategy,
    adjustedSignal,
    notes,
    hardRules,
    adaptiveAdjustments: adjustments,
    riskScore,
    kpis,
  } satisfies AdaptiveSignalAdvice;
}
