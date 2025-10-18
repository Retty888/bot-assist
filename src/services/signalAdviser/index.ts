export { adviseWithHardRules, evaluateHardRules } from "./hardRules.js";
export { adviseWithAdaptiveRules } from "./adaptiveEngine.js";
export { generateAdaptiveAdvice } from "./service.js";
export type {
  AdaptiveAdjustment,
  AdaptiveSignalAdvice,
  MarketKpiSnapshot,
  SignalHardRuleDefinition,
  SignalHardRuleEvaluation,
} from "./types.js";
