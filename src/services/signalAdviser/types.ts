import type { EntryStrategy } from "../../trading/tradeSignalParser.js";
import type { SignalAdvice, SignalAdviceOptions, TradeSignal } from "../../trading/signalAdviser.js";

export interface SignalHardRuleDefinition {
  readonly id: string;
  readonly description: string;
  readonly rationale: string;
  readonly severity: "info" | "warning" | "critical";
}

export interface SignalHardRuleEvaluation extends SignalHardRuleDefinition {
  readonly triggered: boolean;
  readonly details?: string;
}

export interface AdaptiveAdjustment {
  readonly id: string;
  readonly description: string;
  readonly rationale: string;
  readonly applied: boolean;
  readonly delta?: number;
  readonly details?: string;
}

export interface MarketKpiSnapshot {
  readonly symbol: string;
  readonly timestamp: number;
  readonly volatilityScore: number; // 0-10 scale
  readonly trendStrength: number; // 0-1
  readonly drawdownPercent: number; // 0-100
  readonly winRate: number; // 0-1
  readonly liquidityScore: number; // venue-specific score
  readonly slippageBps: number; // estimated slippage in basis points
}

export interface AdaptiveSignalAdvice extends SignalAdvice {
  readonly hardRules: readonly SignalHardRuleEvaluation[];
  readonly adaptiveAdjustments: readonly AdaptiveAdjustment[];
  readonly riskScore: number;
  readonly kpis?: MarketKpiSnapshot;
}

export interface AdaptiveAdviceContext {
  readonly signal: TradeSignal;
  readonly options: SignalAdviceOptions;
  readonly baselineEntryStrategy: EntryStrategy;
}
