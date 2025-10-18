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
import type { SignalHardRuleEvaluation } from "./types.js";

function formatBound(value: number): string {
  return value.toFixed(2).replace(/\.0+$/u, (match) => (match === ".00" ? "" : match.replace(/0+$/u, "")));
}

export interface HardRuleContext {
  readonly signal: TradeSignal;
  readonly advice: SignalAdvice;
  readonly options: SignalAdviceOptions;
}

export function evaluateHardRules(context: HardRuleContext): SignalHardRuleEvaluation[] {
  const { signal, advice, options } = context;
  const timeframe = deriveDominantTimeframe(signal.timeframeHints);
  const { minLeverage, maxLeverage } = resolveLeverageBounds(options);

  const evaluations: SignalHardRuleEvaluation[] = [
    {
      id: "leverage-bounds",
      description: "Recommended leverage must stay inside configured bounds.",
      rationale: "Protects from accidental over-sizing when signals request extreme leverage.",
      severity: "critical",
      triggered:
        advice.recommendedLeverage <= minLeverage + 1e-2 || advice.recommendedLeverage >= maxLeverage - 1e-2,
      details: `Clamp range [${formatBound(minLeverage)}, ${formatBound(maxLeverage)}] enforced.`,
    },
    {
      id: "extreme-risk-limit-order",
      description: "Extreme-risk signals are downgraded to limit execution.",
      rationale: "Avoids market slippage when volatility spikes under extreme risk labels.",
      severity: "warning",
      triggered: signal.riskLabel === "extreme" && advice.execution === "limit",
      details: signal.riskLabel === "extreme" ? "Execution forced to limit due to risk policy." : undefined,
    },
    {
      id: "fast-timeframe-market",
      description: "Scalp or intraday signals within 15 minutes execute as market orders.",
      rationale: "Ensures fills on rapidly moving markets when the planning window is tiny.",
      severity: "warning",
      triggered: Boolean(timeframe !== undefined && timeframe <= 15 && advice.execution === "market"),
      details: timeframe !== undefined ? `Dominant timeframe ${timeframe}m triggers market execution.` : undefined,
    },
    {
      id: "slow-timeframe-limit",
      description: "Swing trades (≥4h) revert to limit execution for better entry precision.",
      rationale: "Gives orders time to rest on order book when setup horizon is long.",
      severity: "info",
      triggered: Boolean(timeframe !== undefined && timeframe >= 240 && advice.execution === "limit"),
      details: timeframe !== undefined ? `Dominant timeframe ${timeframe}m keeps execution on limit.` : undefined,
    },
  ];

  return evaluations;
}

export function adviseWithHardRules(
  signal: TradeSignal,
  options: SignalAdviceOptions = {},
): { advice: SignalAdvice; rules: SignalHardRuleEvaluation[] } {
  const advice = adviseSignal(signal, options);
  const rules = evaluateHardRules({ signal, advice, options });
  return { advice, rules };
}
