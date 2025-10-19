import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  ExchangeClient,
  InfoClient,
  OrderParameters,
  OrderResponseSuccess,
} from "@nktkas/hyperliquid";
import { HyperliquidTradingBot } from "../src/trading/hyperliquidTradingBot.js";

type MetaAndAssetCtxsTuple = Awaited<ReturnType<InfoClient["metaAndAssetCtxs"]>>;
type MetaResponse = MetaAndAssetCtxsTuple[0];
type AssetContexts = MetaAndAssetCtxsTuple[1];

const baseMeta: MetaResponse = {
  universe: [
    {
      name: "BTC",
      szDecimals: 3,
      maxLeverage: 100,
      marginTableId: 0,
    },
  ],
  marginTables: [
    [
      0,
      {
        description: "default",
        marginTiers: [],
      },
    ],
  ],
};

const baseContexts: AssetContexts = [
  {
    prevDayPx: "60000",
    dayNtlVlm: "0",
    markPx: "60500",
    midPx: "60500",
    funding: "0",
    openInterest: "0",
    premium: "0",
    oraclePx: "60500",
    impactPxs: null,
    dayBaseVlm: "0",
  },
];

class FakeInfoClient {
  public calls = 0;
  constructor(private readonly meta: MetaResponse, private readonly contexts: AssetContexts) {}

  async metaAndAssetCtxs(): Promise<MetaAndAssetCtxsTuple> {
    this.calls += 1;
    return [this.meta, this.contexts] as MetaAndAssetCtxsTuple;
  }
}

class FakeExchangeClient {
  public orders: OrderParameters[] = [];

  async order(payload: OrderParameters): Promise<OrderResponseSuccess> {
    this.orders.push(payload);
    return {
      status: "ok",
      data: {
        statuses: payload.orders.map(() => ({ status: "fulfilled" })),
      },
    } as OrderResponseSuccess;
  }
}

describe("HyperliquidTradingBot", () => {
  beforeEach(() => {
    Reflect.set(HyperliquidTradingBot as unknown as Record<string, unknown>, "sharedCache", undefined);
    Reflect.set(HyperliquidTradingBot as unknown as Record<string, unknown>, "inflightCachePromise", undefined);
    vi.useRealTimers();
  });

  it("creates market entry with grouped TP/SL", async () => {
    const info = new FakeInfoClient(baseMeta, baseContexts);
    const exchange = new FakeExchangeClient();
    const bot = new HyperliquidTradingBot({
      infoClient: info as unknown as InfoClient,
      exchangeClient: exchange as unknown as ExchangeClient,
      slippageBps: 100,
      metaRefreshIntervalMs: 100_000,
    });

    const result = await bot.executeSignalText("Long BTC 2 stop 58000 tp1 62000 tp2 63000 market");

    expect(info.calls).toBe(1);
    expect(result.payload.grouping).toBe("positionTpsl");
    expect(exchange.orders).toHaveLength(1);
    const [entry, tp1, tp2, stop] = exchange.orders[0].orders;
    expect(entry.t?.limit?.tif).toBe("Ioc");
    expect(Number(entry.p)).toBeCloseTo(60500 * 1.01, 3);
    expect(tp1.t?.trigger?.tpsl).toBe("tp");
    expect(tp1.r).toBe(true);
    expect(tp1.s).toBe("1");
    expect(tp2.s).toBe("1");
    expect(stop.t?.trigger?.tpsl).toBe("sl");
    expect(stop.s).toBe("2");
  });

  it("respects explicit limit price", async () => {
    const info = new FakeInfoClient(baseMeta, baseContexts);
    const exchange = new FakeExchangeClient();
    const bot = new HyperliquidTradingBot({
      infoClient: info as unknown as InfoClient,
      exchangeClient: exchange as unknown as ExchangeClient,
    });

    await bot.executeSignalText("Short BTC size 1 entry 60000 stop 62000 tp 58000");
    const [entry, tp, stop] = exchange.orders[0].orders;
    expect(entry.t?.limit?.tif).toBe("Gtc");
    expect(entry.b).toBe(false);
    expect(entry.p).toBe("60000");
    expect(tp.t?.trigger?.tpsl).toBe("tp");
    expect(stop.t?.trigger?.tpsl).toBe("sl");
  });

  it("builds multi-level grid entry orders", async () => {
    const info = new FakeInfoClient(baseMeta, baseContexts);
    const exchange = new FakeExchangeClient();
    const bot = new HyperliquidTradingBot({
      infoClient: info as unknown as InfoClient,
      exchangeClient: exchange as unknown as ExchangeClient,
    });

    await bot.executeSignalText(
      "Long BTC 3 entry 60000 stop 58500 tp1 62500 tp2 63500 grid 3 150",
    );

    const payload = exchange.orders[0];
    const [entry1, entry2, entry3] = payload.orders.slice(0, 3);
    expect(payload.orders).toHaveLength(6);
    expect(entry1.t?.limit?.tif).toBe("Gtc");
    expect(entry2.t?.limit?.tif).toBe("Gtc");
    expect(entry3.t?.limit?.tif).toBe("Gtc");
    expect(entry1.p).toBe("60000");
    expect(entry2.p).toBe("59850");
    expect(entry3.p).toBe("59700");
    expect(entry1.s).toBe("1");
    expect(entry3.s).toBe("1");
  });

  it("derives trailing stop price when configured", async () => {
    const info = new FakeInfoClient(baseMeta, baseContexts);
    const exchange = new FakeExchangeClient();
    const bot = new HyperliquidTradingBot({
      infoClient: info as unknown as InfoClient,
      exchangeClient: exchange as unknown as ExchangeClient,
    });

    await bot.executeSignalText("Long BTC 1 entry 60000 tp 63000 trailing stop 500");

    const payload = exchange.orders[0];
    const stopOrder = payload.orders[payload.orders.length - 1];
    expect(stopOrder.t?.trigger?.tpsl).toBe("sl");
    expect(stopOrder.p).toBe("59500");
  });

  it("coalesces concurrent cache refresh requests", async () => {
    const info = new FakeInfoClient(baseMeta, baseContexts);
    const bot = new HyperliquidTradingBot({
      infoClient: info as unknown as InfoClient,
      exchangeClient: new FakeExchangeClient() as unknown as ExchangeClient,
      metaCacheRefreshMode: "blocking",
    });

    const ensureCache = (bot as unknown as {
      ensureCache: (options?: { forceRefresh?: boolean }) => Promise<unknown>;
    }).ensureCache.bind(bot);

    await Promise.all([
      ensureCache({ forceRefresh: true }),
      ensureCache({ forceRefresh: true }),
      ensureCache({ forceRefresh: true }),
    ]);

    expect(info.calls).toBe(1);
  });

  it("refreshes metadata at most once per TTL window", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:00:00Z").valueOf());

    const info = new FakeInfoClient(baseMeta, baseContexts);
    const exchange = new FakeExchangeClient();
    const bot = new HyperliquidTradingBot({
      infoClient: info as unknown as InfoClient,
      exchangeClient: exchange as unknown as ExchangeClient,
      metaRefreshIntervalMs: 1_000,
      metaCacheRefreshMode: "background",
    });

    await bot.executeSignalText("Long BTC 1 stop 59000 tp 61000 market");
    expect(info.calls).toBe(1);

    await bot.executeSignalText("Long BTC 1 stop 59000 tp 61000 market");
    expect(info.calls).toBe(1);

    vi.advanceTimersByTime(1_100);

    await Promise.all([
      bot.executeSignalText("Long BTC 1 stop 59000 tp 61000 market"),
      bot.executeSignalText("Long BTC 1 stop 59000 tp 61000 market"),
    ]);

    expect(info.calls).toBe(2);
  });
});
