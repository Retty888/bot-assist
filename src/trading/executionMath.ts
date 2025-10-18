import type { OrderParameters } from "@nktkas/hyperliquid";

import type { TradeSignal } from "./tradeSignalParser.js";

function parseNumeric(value: string | number | undefined): number | undefined {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

export function resolveEntryPrice(signal: TradeSignal, payload: OrderParameters): number | undefined {
  if (signal.entryPrice && signal.entryPrice > 0) {
    return signal.entryPrice;
  }
  const entryOrder = payload.orders.find((order) => order.r === false);
  return parseNumeric(entryOrder?.p);
}

export function computeNotionalUsd(size: number | undefined, price: number | undefined): number | undefined {
  if (!(size && price) || size <= 0 || price <= 0) {
    return undefined;
  }
  return size * price;
}

export function estimateMaxRiskUsd(signal: TradeSignal, entryPrice: number | undefined): number | undefined {
  if (!(entryPrice && entryPrice > 0)) {
    return undefined;
  }
  const stopCandidates: number[] = [];
  if (signal.stopLoss && signal.stopLoss > 0) {
    stopCandidates.push(signal.stopLoss);
  }
  signal.stopLosses.forEach((level) => {
    if (level.price > 0) {
      stopCandidates.push(level.price);
    }
  });
  if (stopCandidates.length === 0) {
    return undefined;
  }
  const extreme = signal.side === "long" ? Math.max(...stopCandidates) : Math.min(...stopCandidates);
  const delta = signal.side === "long" ? entryPrice - extreme : extreme - entryPrice;
  if (!(delta > 0)) {
    return undefined;
  }
  return delta * signal.size;
}

export function estimateTargetPnlUsd(signal: TradeSignal, entryPrice: number | undefined): number | undefined {
  if (!(entryPrice && entryPrice > 0)) {
    return undefined;
  }
  if (signal.takeProfits.length === 0) {
    return undefined;
  }
  const weights: number[] = [];
  const prices: number[] = [];
  let specifiedSum = 0;
  let unspecified = 0;
  signal.takeProfits.forEach((target) => {
    prices.push(target.price);
    if (target.sizeFraction !== undefined) {
      weights.push(target.sizeFraction);
      specifiedSum += target.sizeFraction;
    } else {
      weights.push(0);
      unspecified += 1;
    }
  });
  if (unspecified > 0) {
    const remaining = Math.max(0, 1 - specifiedSum);
    const share = unspecified > 0 ? remaining / unspecified : 0;
    weights.forEach((value, index) => {
      if (value === 0) {
        weights[index] = share > 0 ? share : 1 / weights.length;
      }
    });
  }
  const normalizedWeights = weights.map((value) => (value > 0 ? value : 1 / weights.length));
  const sumWeights = normalizedWeights.reduce((sum, value) => sum + value, 0);
  if (!(sumWeights > 0)) {
    return undefined;
  }
  const averageTarget =
    normalizedWeights.reduce((sum, weight, index) => sum + weight * prices[index]!, 0) / sumWeights;
  const delta = signal.side === "long" ? averageTarget - entryPrice : entryPrice - averageTarget;
  if (!Number.isFinite(delta)) {
    return undefined;
  }
  return delta * signal.size;
}

export function estimateLeverage(notionalUsd: number | undefined, equityUsd: number | undefined): number | undefined {
  if (!(notionalUsd && equityUsd)) {
    return undefined;
  }
  if (!(equityUsd > 0)) {
    return undefined;
  }
  return notionalUsd / equityUsd;
}
