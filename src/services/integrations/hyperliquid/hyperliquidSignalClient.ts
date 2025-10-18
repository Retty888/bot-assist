import type { HttpClientConfig } from "../../../config/configManager.js";
import { RetryingHttpClient, type Logger, type MetricsRecorder } from "./retryingHttpClient.js";

export interface HyperliquidSignal {
  readonly id: string;
  readonly symbol: string;
  readonly side: "buy" | "sell";
  readonly size: number;
  readonly strategy: string;
  readonly receivedAt: string;
  readonly metadata?: Record<string, unknown>;
}

export interface FetchSignalsOptions {
  readonly limit?: number;
  readonly since?: string;
}

export interface AcknowledgeSignalResponse {
  readonly acknowledged: boolean;
  readonly id: string;
}

export interface HyperliquidSignalClientOptions {
  readonly httpConfig: HttpClientConfig;
  readonly apiKey?: string;
  readonly logger?: Logger;
  readonly metrics?: MetricsRecorder;
}

function buildAuthHeaders(apiKey?: string): HeadersInit | undefined {
  if (!apiKey) {
    return undefined;
  }
  return {
    Authorization: `Bearer ${apiKey}`,
  } satisfies HeadersInit;
}

export class HyperliquidSignalClient {
  private readonly http: RetryingHttpClient;
  private readonly apiKey?: string;

  constructor(options: HyperliquidSignalClientOptions) {
    this.http = new RetryingHttpClient({
      http: options.httpConfig,
      logger: options.logger,
      metrics: options.metrics,
    });
    this.apiKey = options.apiKey;
  }

  async fetchSignals(options: FetchSignalsOptions = {}): Promise<HyperliquidSignal[]> {
    const headers = buildAuthHeaders(this.apiKey);
    return this.http.get<HyperliquidSignal[]>("signals", {
      searchParams: {
        limit: options.limit,
        since: options.since,
      },
      headers,
    });
  }

  async acknowledge(signalId: string): Promise<AcknowledgeSignalResponse> {
    if (!signalId) {
      throw new Error("Signal identifier is required");
    }
    const authHeaders = buildAuthHeaders(this.apiKey);
    const headers: HeadersInit = {
      "Content-Type": "application/json",
      ...(authHeaders ?? {}),
    };
    return this.http.post<AcknowledgeSignalResponse>(`signals/${signalId}/ack`, {
      headers,
      body: JSON.stringify({ id: signalId }),
    });
  }
}
