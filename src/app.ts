import { parseTradeSignal } from "./trading/tradeSignalParser.js";
import { DEFAULT_SIGNAL, instantiateTradingBot } from "./runtime/botRuntime.js";
import type { ExecutionMode } from "./storage/historyStore.js";

function getSignalText(): string {
  const override = process.env.TRADING_SIGNAL?.trim();
  if (override) {
    return override;
  }
  const fromArgs = process.argv.slice(2).join(" ").trim();
  if (fromArgs.length > 0) {
    return fromArgs;
  }
  return DEFAULT_SIGNAL;
}

async function main() {
  const signalText = getSignalText();
  console.log("[bot] raw signal:", signalText);

  const parsed = parseTradeSignal(signalText);
  console.log("[bot] parsed signal:", JSON.stringify(parsed, null, 2));

  const { bot, demoMode } = instantiateTradingBot();
  if (demoMode) {
    console.log("[bot] HYPERLIQUID_PRIVATE_KEY not provided; running in demo mode with mocked clients.");
  }

  const mode: ExecutionMode = demoMode ? "demo" : "live";
  const result = await bot.executeSignal(parsed, { mode });
  console.log("[bot] order payload:", JSON.stringify(result.payload, null, 2));
  console.log("[bot] exchange response:", JSON.stringify(result.response, null, 2));

  if (demoMode) {
    console.log("[bot] demo mode completed successfully.");
  } else {
    console.log("[bot] live order submitted to Hyperliquid.");
  }
}

main().catch((error) => {
  console.error("[bot] fatal error:", error);
  process.exitCode = 1;
});
