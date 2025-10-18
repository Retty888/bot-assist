import { defaultSecretStore, type SecretStore } from "../storage/secretStore.js";

export interface RetryPolicyConfig {
  readonly maxAttempts: number;
  readonly initialDelayMs: number;
  readonly backoffMultiplier: number;
  readonly maxDelayMs: number;
}

export interface HttpClientConfig {
  readonly baseUrl: string;
  readonly timeoutMs: number;
  readonly rateLimitPerSecond: number;
  readonly retry: RetryPolicyConfig;
}

export interface HyperliquidIntegrationConfig {
  readonly signalApi: HttpClientConfig;
  readonly marketApi: HttpClientConfig;
  readonly orderApi: HttpClientConfig;
  readonly credentials: {
    readonly apiKey?: string;
    readonly apiSecret?: string;
  };
  readonly websocketSignalUrl?: string;
}

export interface ConfigProvider {
  getHyperliquidConfig(): HyperliquidIntegrationConfig;
}

function parseNumber(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function buildHttpConfig(
  env: NodeJS.ProcessEnv,
  prefix: string,
  defaults: HttpClientConfig,
): HttpClientConfig {
  const baseUrl = env[`${prefix}_BASE_URL`] ?? defaults.baseUrl;
  const timeoutMs = parseNumber(env[`${prefix}_TIMEOUT_MS`], defaults.timeoutMs);
  const rateLimitPerSecond = parseNumber(
    env[`${prefix}_RATE_LIMIT_PER_SECOND`],
    defaults.rateLimitPerSecond,
  );
  const maxAttempts = parseNumber(env[`${prefix}_RETRY_MAX_ATTEMPTS`], defaults.retry.maxAttempts);
  const initialDelayMs = parseNumber(
    env[`${prefix}_RETRY_INITIAL_DELAY_MS`],
    defaults.retry.initialDelayMs,
  );
  const backoffMultiplier = parseNumber(
    env[`${prefix}_RETRY_BACKOFF_MULTIPLIER`],
    defaults.retry.backoffMultiplier,
  );
  const maxDelayMs = parseNumber(
    env[`${prefix}_RETRY_MAX_DELAY_MS`],
    defaults.retry.maxDelayMs,
  );

  return {
    baseUrl,
    timeoutMs,
    rateLimitPerSecond,
    retry: {
      maxAttempts,
      initialDelayMs,
      backoffMultiplier,
      maxDelayMs,
    },
  };
}

const DEFAULT_SIGNAL_HTTP: HttpClientConfig = {
  baseUrl: "https://signals.hyperliquid.local",
  timeoutMs: 5_000,
  rateLimitPerSecond: 4,
  retry: {
    maxAttempts: 3,
    initialDelayMs: 250,
    backoffMultiplier: 2,
    maxDelayMs: 4_000,
  },
};

const DEFAULT_MARKET_HTTP: HttpClientConfig = {
  baseUrl: "https://api.hyperliquid.xyz/",
  timeoutMs: 7_500,
  rateLimitPerSecond: 6,
  retry: {
    maxAttempts: 4,
    initialDelayMs: 200,
    backoffMultiplier: 2,
    maxDelayMs: 5_000,
  },
};

const DEFAULT_ORDER_HTTP: HttpClientConfig = {
  baseUrl: "https://api.hyperliquid.xyz/",
  timeoutMs: 10_000,
  rateLimitPerSecond: 3,
  retry: {
    maxAttempts: 4,
    initialDelayMs: 400,
    backoffMultiplier: 2,
    maxDelayMs: 6_000,
  },
};

export class ConfigManager implements ConfigProvider {
  constructor(
    private readonly secretStore: SecretStore = defaultSecretStore,
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {}

  getHyperliquidConfig(): HyperliquidIntegrationConfig {
    const signalApi = buildHttpConfig(this.env, "HYPERLIQUID_SIGNAL", DEFAULT_SIGNAL_HTTP);
    const marketApi = buildHttpConfig(this.env, "HYPERLIQUID_MARKET", DEFAULT_MARKET_HTTP);
    const orderApi = buildHttpConfig(this.env, "HYPERLIQUID_ORDER", DEFAULT_ORDER_HTTP);

    const apiKey = this.secretStore.getSecret("HYPERLIQUID_API_KEY");
    const apiSecret = this.secretStore.getSecret("HYPERLIQUID_API_SECRET");

    const websocketSignalUrl = this.env.HYPERLIQUID_SIGNAL_WS_URL;

    return {
      signalApi,
      marketApi,
      orderApi,
      credentials: {
        apiKey,
        apiSecret,
      },
      websocketSignalUrl,
    };
  }
}

export const defaultConfigManager = new ConfigManager();

export function getHyperliquidConfig(): HyperliquidIntegrationConfig {
  return defaultConfigManager.getHyperliquidConfig();
}
