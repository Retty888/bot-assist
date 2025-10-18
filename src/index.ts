export const hello = (name: string) => `Hello, ${name}`;

export * from "./trading/tradeSignalParser.js";
export { HyperliquidTradingBot } from "./trading/hyperliquidTradingBot.js";
export { ExecutionLogger } from "./telemetry/executionLogger.js";
export { RiskEngine } from "./risk/riskEngine.js";
export { NotificationService } from "./telemetry/notificationService.js";
