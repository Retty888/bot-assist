import type { HttpClientConfig, RetryPolicyConfig } from "../../../config/configManager.js";

export interface MetricsRecorder {
  increment(metric: string, tags?: Record<string, string>): void;
  observe(metric: string, value: number, tags?: Record<string, string>): void;
}

export interface Logger {
  info(message: string, metadata?: Record<string, unknown>): void;
  warn(message: string, metadata?: Record<string, unknown>): void;
  error(message: string, metadata?: Record<string, unknown>): void;
}

export type RequestMethod = "GET" | "POST" | "PUT" | "DELETE";

export interface RequestOptions extends RequestInit {
  readonly method?: RequestMethod;
  readonly timeoutMs?: number;
  readonly searchParams?: Record<string, string | number | boolean | undefined>;
  readonly expectedStatuses?: number[];
  readonly parseJson?: boolean;
}

const DEFAULT_EXPECTED_STATUSES = [200];

interface InternalRequestOptions extends RequestOptions {
  readonly method: RequestMethod;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

function buildUrl(baseUrl: string, path: string, params?: RequestOptions["searchParams"]): string {
  const url = new URL(path, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (value === undefined) {
        return;
      }
      url.searchParams.set(key, String(value));
    });
  }
  return url.toString();
}

function shouldRetry(status: number, expectedStatuses: number[]): boolean {
  if (expectedStatuses.includes(status)) {
    return false;
  }
  if (status === 429) {
    return true;
  }
  if (status >= 500) {
    return true;
  }
  return false;
}

function computeDelay(attempt: number, retry: RetryPolicyConfig): number {
  const exponentialDelay = retry.initialDelayMs * Math.pow(retry.backoffMultiplier, attempt - 1);
  const boundedDelay = Math.min(exponentialDelay, retry.maxDelayMs);
  const jitter = boundedDelay * 0.2 * Math.random();
  return Math.round(boundedDelay + jitter);
}

class ConsoleLogger implements Logger {
  info(message: string, metadata?: Record<string, unknown>): void {
    console.info(message, metadata);
  }

  warn(message: string, metadata?: Record<string, unknown>): void {
    console.warn(message, metadata);
  }

  error(message: string, metadata?: Record<string, unknown>): void {
    console.error(message, metadata);
  }
}

class NoopMetrics implements MetricsRecorder {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  increment(_metric: string, _tags?: Record<string, string>): void {}
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  observe(_metric: string, _value: number, _tags?: Record<string, string>): void {}
}

export interface RetryingHttpClientOptions {
  readonly http: HttpClientConfig;
  readonly logger?: Logger;
  readonly metrics?: MetricsRecorder;
}

export class RetryingHttpClient {
  private readonly logger: Logger;
  private readonly metrics: MetricsRecorder;
  private readonly expectedStatuses: number[];
  private readonly minIntervalMs: number;
  private readonly retry: RetryPolicyConfig;
  private rateLimiter = Promise.resolve();
  private nextAvailableTimestamp = 0;

  constructor(private readonly options: RetryingHttpClientOptions) {
    this.logger = options.logger ?? new ConsoleLogger();
    this.metrics = options.metrics ?? new NoopMetrics();
    this.expectedStatuses = DEFAULT_EXPECTED_STATUSES;
    this.retry = options.http.retry;
    this.minIntervalMs = options.http.rateLimitPerSecond > 0
      ? Math.floor(1000 / options.http.rateLimitPerSecond)
      : 0;
  }

  async get<T>(path: string, options: RequestOptions = {}): Promise<T> {
    return this.request<T>(path, { ...options, method: "GET" });
  }

  async post<T>(path: string, options: RequestOptions = {}): Promise<T> {
    return this.request<T>(path, { ...options, method: "POST" });
  }

  async request<T>(path: string, options: InternalRequestOptions): Promise<T> {
    const requestUrl = buildUrl(this.options.http.baseUrl, path, options.searchParams);
    const expectedStatuses = options.expectedStatuses ?? this.expectedStatuses;

    await this.applyRateLimit();

    const startedAt = Date.now();
    for (let attempt = 1; attempt <= this.retry.maxAttempts; attempt += 1) {
      const controller = new AbortController();
      const timeoutMs = options.timeoutMs ?? this.options.http.timeoutMs;
      const timeout = setTimeout(() => controller.abort(`Request timeout after ${timeoutMs}ms`), timeoutMs);

      try {
        const response = await fetch(requestUrl, {
          ...options,
          method: options.method,
          signal: controller.signal,
        });
        clearTimeout(timeout);

        if (!response) {
          throw new Error("Empty response");
        }

        if (!expectedStatuses.includes(response.status)) {
          const retryable = shouldRetry(response.status, expectedStatuses);
          const body = await response.text();
          const metadata = { attempt, status: response.status, body };
          if (!retryable) {
            this.logger.error("Hyperliquid request failed", metadata);
            this.metrics.increment("hyperliquid_http_error", {
              path,
              status: String(response.status),
            });
            throw new Error(`Unexpected status ${response.status}`);
          }
          if (attempt >= this.retry.maxAttempts) {
            this.logger.error("Hyperliquid request exhausted retries", metadata);
            this.metrics.increment("hyperliquid_http_retry_exhausted", {
              path,
              status: String(response.status),
            });
            throw new Error(`Failed after ${attempt} attempts with status ${response.status}`);
          }
          this.logger.warn("Hyperliquid request retry", metadata);
          this.metrics.increment("hyperliquid_http_retry", {
            path,
            status: String(response.status),
          });
          const delay = computeDelay(attempt, this.retry);
          await sleep(delay);
          continue;
        }

        const latency = Date.now() - startedAt;
        this.metrics.observe("hyperliquid_http_latency_ms", latency, { path });

        if (options.parseJson === false) {
          return await (response.text() as unknown as Promise<T>);
        }

        const json = (await response.json()) as T;
        return json;
      } catch (error) {
        clearTimeout(timeout);
        const retryable = error instanceof Error && error.name === "AbortError";
        const metadata = {
          attempt,
          error: error instanceof Error ? error.message : String(error),
        };
        if (!retryable && !(error instanceof Error && /network/i.test(error.message))) {
          if (attempt >= this.retry.maxAttempts) {
            this.logger.error("Hyperliquid request failed without retry", metadata);
          } else {
            this.logger.warn("Hyperliquid request error", metadata);
          }
        }
        if (attempt >= this.retry.maxAttempts) {
          this.metrics.increment("hyperliquid_http_failure", { path });
          throw error;
        }
        const delay = computeDelay(attempt, this.retry);
        await sleep(delay);
      }
    }

    throw new Error("Retry loop exited unexpectedly");
  }

  private applyRateLimit(): Promise<void> {
    if (this.minIntervalMs <= 0) {
      return Promise.resolve();
    }
    const limiter = this.rateLimiter.then(async () => {
      const now = Date.now();
      const waitTime = Math.max(0, this.nextAvailableTimestamp - now);
      if (waitTime > 0) {
        await sleep(waitTime);
      }
      this.nextAvailableTimestamp = Date.now() + this.minIntervalMs;
    });
    this.rateLimiter = limiter.catch((error) => {
      this.logger.error("Rate limiter failure", { error });
    });
    return limiter;
  }
}
