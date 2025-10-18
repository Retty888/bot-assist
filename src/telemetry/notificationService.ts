import type { OrderParameters } from "@nktkas/hyperliquid";

import type { TradeSignal } from "../trading/tradeSignalParser.js";
import type { RiskCheckResult } from "../risk/riskEngine.js";

export type NotificationEvent =
  | {
      readonly type: "risk_block";
      readonly signal: TradeSignal;
      readonly risk: RiskCheckResult;
      readonly demoMode: boolean;
    }
  | {
      readonly type: "risk_warning";
      readonly signal: TradeSignal;
      readonly risk: RiskCheckResult;
      readonly demoMode: boolean;
    }
  | {
      readonly type: "exchange_error";
      readonly signal: TradeSignal;
      readonly payload: OrderParameters;
      readonly response: unknown;
      readonly message: string;
      readonly demoMode: boolean;
    };

export interface NotificationServiceOptions {
  readonly webhookUrl?: string;
  readonly emitToConsole?: boolean;
  readonly timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 5_000;

export class NotificationService {
  private readonly webhookUrl?: string;
  private readonly emitToConsole: boolean;
  private readonly timeoutMs: number;

  constructor(options?: NotificationServiceOptions) {
    this.webhookUrl = options?.webhookUrl;
    this.emitToConsole = options?.emitToConsole ?? true;
    this.timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async notify(event: NotificationEvent): Promise<void> {
    if (this.emitToConsole) {
      this.logToConsole(event);
    }
    if (!this.webhookUrl) {
      return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    if (typeof timeout !== "number") {
      timeout.unref?.();
    }

    try {
      await fetch(this.webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          event: event.type,
          timestamp: Date.now(),
          signal: {
            side: event.signal.side,
            symbol: event.signal.symbol,
            size: event.signal.size,
            leverage: event.signal.leverage,
            execution: event.signal.execution,
          },
          risk:
            event.type === "risk_block" || event.type === "risk_warning"
              ? {
                  passed: event.risk.passed,
                  reasons: event.risk.reasons,
                  warnings: event.risk.warnings,
                  usage: event.risk.usage,
                }
              : undefined,
          payload: event.type === "exchange_error" ? event.payload : undefined,
          response: event.type === "exchange_error" ? event.response : undefined,
          message: event.type === "exchange_error" ? event.message : undefined,
          demoMode: event.demoMode,
        }),
        signal: controller.signal,
      });
    } catch (error) {
      console.warn("[notify] Failed to deliver webhook notification", error);
    } finally {
      clearTimeout(timeout as NodeJS.Timeout);
    }
  }

  private logToConsole(event: NotificationEvent): void {
    if (event.type === "exchange_error") {
      console.warn("[notify] Exchange anomaly", {
        symbol: event.signal.symbol,
        side: event.signal.side,
        message: event.message,
        response: event.response,
        demoMode: event.demoMode,
      });
      return;
    }

    const label = event.type === "risk_block" ? "Risk guard blocked trade" : "Risk guard warning";
    console.warn(`[notify] ${label}`, {
      symbol: event.signal.symbol,
      side: event.signal.side,
      reasons: event.risk.reasons,
      warnings: event.risk.warnings,
      usage: event.risk.usage,
      demoMode: event.demoMode,
    });
  }
}
