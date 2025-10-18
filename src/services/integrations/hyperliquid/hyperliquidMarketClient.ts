import type { HttpClientConfig } from "../../../config/configManager.js";
import { RetryingHttpClient, type Logger, type MetricsRecorder } from "./retryingHttpClient.js";

export interface HyperliquidCredentials {
  readonly apiKey?: string;
  readonly apiSecret?: string;
}

export interface MarketMetadataRequest {
  readonly includeUniverse?: boolean;
}

export interface MarketMetadataResponse {
  readonly universe: Array<{
    readonly name: string;
    readonly maxLeverage: number;
    readonly szDecimals: number;
  }>;
  readonly collateralToken?: number;
  readonly marginTables?: unknown;
}

export interface OrderBookResponse {
  readonly coin: string;
  readonly bids: Array<[number, number]>;
  readonly asks: Array<[number, number]>;
  readonly time: number;
}

export interface SubmitOrderRequest {
  readonly coin: string;
  readonly isBuy: boolean;
  readonly size: number;
  readonly limitPrice?: number;
  readonly reduceOnly?: boolean;
  readonly postOnly?: boolean;
}

export interface SubmitOrderResponse {
  readonly status: "accepted" | "rejected";
  readonly reason?: string;
  readonly id?: string;
}

export interface HyperliquidMarketClientOptions {
  readonly marketHttpConfig: HttpClientConfig;
  readonly orderHttpConfig: HttpClientConfig;
  readonly credentials: HyperliquidCredentials;
  readonly logger?: Logger;
  readonly metrics?: MetricsRecorder;
}

function withAuthHeaders(credentials: HyperliquidCredentials): HeadersInit | undefined {
  const headers: Record<string, string> = {};
  if (credentials.apiKey) {
    headers["X-API-KEY"] = credentials.apiKey;
  }
  if (credentials.apiSecret) {
    headers["X-API-SECRET"] = credentials.apiSecret;
  }
  return Object.keys(headers).length > 0 ? headers : undefined;
}

export class HyperliquidMarketClient {
  private readonly marketHttp: RetryingHttpClient;
  private readonly orderHttp: RetryingHttpClient;
  private readonly credentials: HyperliquidCredentials;

  constructor(options: HyperliquidMarketClientOptions) {
    this.marketHttp = new RetryingHttpClient({
      http: options.marketHttpConfig,
      logger: options.logger,
      metrics: options.metrics,
    });
    this.orderHttp = new RetryingHttpClient({
      http: options.orderHttpConfig,
      logger: options.logger,
      metrics: options.metrics,
    });
    this.credentials = options.credentials;
  }

  async getMetadata(request: MarketMetadataRequest = {}): Promise<MarketMetadataResponse> {
    const headers: HeadersInit = { "Content-Type": "application/json" };
    return this.marketHttp.post<MarketMetadataResponse>("info", {
      headers,
      body: JSON.stringify({
        type: "meta",
        includeUniverse: request.includeUniverse ?? true,
      }),
    });
  }

  async getOrderBook(symbol: string): Promise<OrderBookResponse> {
    if (!symbol) {
      throw new Error("Symbol is required to request order book");
    }
    const headers: HeadersInit = { "Content-Type": "application/json" };
    return this.marketHttp.post<OrderBookResponse>("info", {
      headers,
      body: JSON.stringify({
        type: "l2Book",
        coin: symbol,
      }),
    });
  }

  async submitOrder(order: SubmitOrderRequest): Promise<SubmitOrderResponse> {
    const headers: HeadersInit = {
      "Content-Type": "application/json",
      ...(withAuthHeaders(this.credentials) ?? {}),
    };
    return this.orderHttp.post<SubmitOrderResponse>("exchange", {
      headers,
      body: JSON.stringify({
        type: "order",
        order,
      }),
    });
  }
}
