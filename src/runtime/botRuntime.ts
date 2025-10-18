import type {
  ExchangeClient,
  InfoClient,
  OrderParameters,
} from "@nktkas/hyperliquid";

import {
  HyperliquidTradingBot,
  type HyperliquidBotOptions,
} from "../trading/hyperliquidTradingBot.js";

export const DEFAULT_SIGNAL = "Long BTC 2 stop 58000 tp1 62000 tp2 63000 market";

type MetaAndAssetCtxsTuple = Awaited<ReturnType<InfoClient["metaAndAssetCtxs"]>>;
type MetaResponse = MetaAndAssetCtxsTuple[0];
type AssetContexts = MetaAndAssetCtxsTuple[1];

const demoMeta: MetaResponse = {
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
  collateralToken: 0,
};

const demoContexts: AssetContexts = [
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

class DemoInfoClient {
  constructor(private readonly meta: MetaResponse, private readonly contexts: AssetContexts) {}

  async metaAndAssetCtxs(): Promise<MetaAndAssetCtxsTuple> {
    return [this.meta, this.contexts] as MetaAndAssetCtxsTuple;
  }
}

class DemoExchangeClient {
  async order(payload: OrderParameters) {
    return {
      status: "ok",
      data: {
        statuses: payload.orders.map(() => ({ status: "fulfilled" })),
      },
    } as unknown as Awaited<ReturnType<ExchangeClient["order"]>>;
  }
}

export interface RuntimeConfig {
  readonly options: HyperliquidBotOptions;
  readonly demoMode: boolean;
}

export function resolveBotOptions(): RuntimeConfig {
  const privateKey = process.env.HYPERLIQUID_PRIVATE_KEY?.trim();
  const slippageBps = process.env.HYPERLIQUID_SLIPPAGE_BPS;

  if (!privateKey) {
    const info = new DemoInfoClient(demoMeta, demoContexts);
    const exchange = new DemoExchangeClient();
    return {
      options: {
        infoClient: info as unknown as InfoClient,
        exchangeClient: exchange as unknown as ExchangeClient,
        slippageBps: slippageBps ? Number(slippageBps) : undefined,
        metaRefreshIntervalMs: 120_000,
      },
      demoMode: true,
    } satisfies RuntimeConfig;
  }

  return {
    options: {
      privateKey,
      isTestnet: (process.env.HYPERLIQUID_TESTNET ?? "true").toLowerCase() !== "false",
      slippageBps: slippageBps ? Number(slippageBps) : undefined,
    },
    demoMode: false,
  } satisfies RuntimeConfig;
}

export function instantiateTradingBot(): { bot: HyperliquidTradingBot; demoMode: boolean } {
  const { options, demoMode } = resolveBotOptions();
  return {
    bot: new HyperliquidTradingBot(options),
    demoMode,
  };
}
