import {
  getHyperliquidConfig,
  type HyperliquidIntegrationConfig,
} from "../../../config/configManager.js";
import { HyperliquidMarketClient } from "./hyperliquidMarketClient.js";
import { HyperliquidSignalClient } from "./hyperliquidSignalClient.js";
import { type Logger, type MetricsRecorder } from "./retryingHttpClient.js";

export interface HyperliquidClients {
  readonly signal: HyperliquidSignalClient;
  readonly market: HyperliquidMarketClient;
}

export interface CreateHyperliquidClientsOptions {
  readonly config?: HyperliquidIntegrationConfig;
  readonly logger?: Logger;
  readonly metrics?: MetricsRecorder;
}

export function createHyperliquidClients(
  options: CreateHyperliquidClientsOptions = {},
): HyperliquidClients {
  const config = options.config ?? getHyperliquidConfig();
  const logger = options.logger;
  const metrics = options.metrics;

  const signal = new HyperliquidSignalClient({
    httpConfig: config.signalApi,
    apiKey: config.credentials.apiKey,
    logger,
    metrics,
  });

  const market = new HyperliquidMarketClient({
    marketHttpConfig: config.marketApi,
    orderHttpConfig: config.orderApi,
    credentials: config.credentials,
    logger,
    metrics,
  });

  return { signal, market };
}

export { HyperliquidMarketClient } from "./hyperliquidMarketClient.js";
export { HyperliquidSignalClient } from "./hyperliquidSignalClient.js";
export { RetryingHttpClient } from "./retryingHttpClient.js";
