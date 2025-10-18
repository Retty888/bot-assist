import { parseTradeSignal, type TradeSignal } from "../../trading/tradeSignalParser.js";
import type { SignalAdviceOptions } from "../../trading/signalAdviser.js";
import { adviseWithAdaptiveRules, type AdaptiveSignalAdvice } from "./adaptiveEngine.js";
import type { MarketKpiSnapshot } from "./types.js";
import {
  defaultMarketDataProvider,
  type MarketDataProvider,
} from "../recommendationService/marketData.js";

export interface AdaptiveAdviceRequest {
  readonly text: string;
  readonly options?: SignalAdviceOptions;
  readonly provider?: MarketDataProvider;
}

export interface AdaptiveAdviceResponse {
  readonly advice: AdaptiveSignalAdvice;
  readonly signal: TradeSignal;
  readonly kpis?: MarketKpiSnapshot;
}

export async function generateAdaptiveAdvice(
  request: AdaptiveAdviceRequest,
): Promise<AdaptiveAdviceResponse> {
  const provider = request.provider ?? defaultMarketDataProvider;
  const signal = parseTradeSignal(request.text);
  const kpis = await provider.getKpis(signal.symbol);
  const advice = adviseWithAdaptiveRules(signal, request.options, kpis ?? undefined);
  return { advice, signal, kpis: kpis ?? undefined };
}
