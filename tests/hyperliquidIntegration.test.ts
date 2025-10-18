import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { HyperliquidIntegrationConfig } from "../src/config/configManager.js";
import { createHyperliquidClients } from "../src/services/integrations/hyperliquid/index.js";
import type { HyperliquidSignal } from "../src/services/integrations/hyperliquid/hyperliquidSignalClient.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function loadFixture<T>(relativePath: string): T {
  const fullPath = join(__dirname, "fixtures", "hyperliquid", relativePath);
  const content = readFileSync(fullPath, "utf-8");
  return JSON.parse(content) as T;
}

const signalsFixture = loadFixture<HyperliquidSignal[]>("signals.json");
const metaFixture = loadFixture("meta.json") as unknown as Record<string, unknown>;
const orderBookFixture = loadFixture("orderbook.json") as unknown as Record<string, unknown>;
const orderResponseFixture = loadFixture("order-response.json") as unknown as Record<string, unknown>;

function createJsonResponse(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
    text: async () => JSON.stringify(data),
    headers: new Headers({ "Content-Type": "application/json" }),
  } as Response;
}

describe("Hyperliquid integration clients", () => {
  const config: HyperliquidIntegrationConfig = {
    signalApi: {
      baseUrl: "https://hyperliquid.test/",
      timeoutMs: 1_000,
      rateLimitPerSecond: 100,
      retry: {
        maxAttempts: 3,
        initialDelayMs: 20,
        backoffMultiplier: 2,
        maxDelayMs: 200,
      },
    },
    marketApi: {
      baseUrl: "https://hyperliquid.test/",
      timeoutMs: 1_000,
      rateLimitPerSecond: 100,
      retry: {
        maxAttempts: 3,
        initialDelayMs: 20,
        backoffMultiplier: 2,
        maxDelayMs: 200,
      },
    },
    orderApi: {
      baseUrl: "https://hyperliquid.test/",
      timeoutMs: 1_000,
      rateLimitPerSecond: 100,
      retry: {
        maxAttempts: 3,
        initialDelayMs: 20,
        backoffMultiplier: 2,
        maxDelayMs: 200,
      },
    },
    credentials: {
      apiKey: "test-key",
      apiSecret: "test-secret",
    },
    websocketSignalUrl: "wss://hyperliquid.test/signals",
  };

  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("fetches market and signal data successfully", async () => {
    fetchMock
      .mockResolvedValueOnce(createJsonResponse(signalsFixture))
      .mockResolvedValueOnce(createJsonResponse({ acknowledged: true, id: "sig-1" }))
      .mockResolvedValueOnce(createJsonResponse(metaFixture))
      .mockResolvedValueOnce(createJsonResponse(orderBookFixture))
      .mockResolvedValueOnce(createJsonResponse(orderResponseFixture));

    const { signal, market } = createHyperliquidClients({ config });

    const signals = await signal.fetchSignals({ limit: 2 });
    expect(signals).toEqual(signalsFixture);

    const ack = await signal.acknowledge("sig-1");
    expect(ack.acknowledged).toBe(true);

    const metadata = await market.getMetadata();
    expect(metadata).toMatchObject(metaFixture);

    const orderBook = await market.getOrderBook("BTC");
    expect(orderBook).toMatchObject(orderBookFixture);

    const orderResult = await market.submitOrder({ coin: "BTC", isBuy: true, size: 0.25 });
    expect(orderResult).toMatchObject(orderResponseFixture);

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://hyperliquid.test/signals?limit=2",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({ Authorization: "Bearer test-key" }),
      }),
    );

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://hyperliquid.test/signals/sig-1/ack",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          Authorization: "Bearer test-key",
        }),
      }),
    );

    expect(fetchMock).toHaveBeenNthCalledWith(
      5,
      "https://hyperliquid.test/exchange",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          "X-API-KEY": "test-key",
          "X-API-SECRET": "test-secret",
        }),
      }),
    );
  });

  it("retries transient network failures", async () => {
    vi.useFakeTimers();
    fetchMock
      .mockRejectedValueOnce(new TypeError("Network disconnected"))
      .mockResolvedValueOnce(createJsonResponse(signalsFixture));

    const { signal } = createHyperliquidClients({ config });

    const requestPromise = signal.fetchSignals();
    await vi.runAllTimersAsync();
    const signals = await requestPromise;

    expect(signals).toEqual(signalsFixture);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("fails after exhausting retries on server error", async () => {
    vi.useFakeTimers();
    fetchMock
      .mockResolvedValue(createJsonResponse({ error: "bad gateway" }, 502));

    const { signal } = createHyperliquidClients({ config });

    const requestPromise = signal.fetchSignals();
    const expectation = expect(requestPromise).rejects.toThrow();
    await vi.runAllTimersAsync();
    await expectation;

    expect(fetchMock).toHaveBeenCalledTimes(config.signalApi.retry.maxAttempts);
  });
});
