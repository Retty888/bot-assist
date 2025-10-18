import { ExecutionLogger } from "../telemetry/executionLogger.js";
import { NotificationService } from "../telemetry/notificationService.js";
import { RiskEngine, type RiskEngineConfig } from "../risk/riskEngine.js";

function parseNumberEnv(key: string, fallback: number | undefined): number | undefined {
  const raw = process.env[key];
  if (!raw) {
    return fallback;
  }
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

const riskConfig: RiskEngineConfig = {
  accountEquityUsd: parseNumberEnv("RISK_ACCOUNT_EQUITY_USD", 10_000) ?? 10_000,
  maxLeverage: parseNumberEnv("RISK_MAX_LEVERAGE", 10),
  maxPositionNotionalUsd: parseNumberEnv("RISK_MAX_POSITION_USD", 50_000),
  maxPositionRiskUsd: parseNumberEnv("RISK_MAX_RISK_USD", 2_500),
  dailyLossLimitUsd: parseNumberEnv("RISK_DAILY_LOSS_LIMIT_USD", 5_000),
  dailyTradeCountLimit: parseNumberEnv("RISK_DAILY_TRADE_LIMIT", 20),
  dailyNotionalLimitUsd: parseNumberEnv("RISK_DAILY_NOTIONAL_USD", 250_000),
};

const executionLogger = new ExecutionLogger({ accountEquityUsd: riskConfig.accountEquityUsd });
const notificationService = new NotificationService({
  webhookUrl: process.env.NOTIFICATION_WEBHOOK_URL?.trim() || undefined,
});
const riskEngine = new RiskEngine(riskConfig, executionLogger);

export function getExecutionLogger(): ExecutionLogger {
  return executionLogger;
}

export function getNotificationService(): NotificationService {
  return notificationService;
}

export function getRiskEngine(): RiskEngine {
  return riskEngine;
}

export function getRiskConfig(): RiskEngineConfig {
  return riskConfig;
}
