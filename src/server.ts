import path from "node:path";
import { fileURLToPath } from "node:url";

import express, { type Request, type Response } from "express";

import { parseTradeSignal } from "./trading/tradeSignalParser.js";
import {
  DEFAULT_SIGNAL,
  getMarketDataSnapshot,
  instantiateTradingBot,
} from "./runtime/botRuntime.js";
import { buildRecommendations } from "./insights/recommendationService.js";

const app = express();
const port = Number.parseInt(process.env.PORT ?? "3000", 10);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, "..", "public");

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(publicDir));

app.get("/", (_req: Request, res: Response) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

app.get("/api/default-signal", (_req: Request, res: Response) => {
  res.json({ defaultSignal: DEFAULT_SIGNAL });
});

function buildPriceLayers(text: string | undefined) {
  if (!text?.trim()) {
    return undefined;
  }

  try {
    const parsed = parseTradeSignal(text);
    const entries: number[] = [];
    if (parsed.entryPrice && parsed.entryPrice > 0) {
      entries.push(parsed.entryPrice);
    }
    const takeProfits = parsed.takeProfits
      .map((level) => level.price)
      .filter((price): price is number => Number.isFinite(price) && price > 0);
    const stopLosses = parsed.stopLosses
      .map((level) => level.price)
      .filter((price): price is number => Number.isFinite(price) && price > 0);

    if (parsed.stopLoss && parsed.stopLoss > 0 && stopLosses.length === 0) {
      stopLosses.push(parsed.stopLoss);
    }

    return {
      entries,
      takeProfits,
      stopLosses,
      rawSymbol: parsed.symbol,
    };
  } catch {
    return undefined;
  }
}

app.post("/api/market-data", async (req: Request, res: Response) => {
  try {
    const body = req.body ?? {};
    const signalText = typeof body.signal === "string" ? body.signal : undefined;
    const symbolOverride = typeof body.symbol === "string" ? body.symbol : undefined;

    const layers = buildPriceLayers(signalText);
    const targetSymbol = symbolOverride ?? layers?.rawSymbol ?? "BTC";
    const snapshot = await getMarketDataSnapshot(targetSymbol);

    res.json({
      ...snapshot,
      layers: layers
        ? {
            entries: layers.entries,
            takeProfits: layers.takeProfits,
            stopLosses: layers.stopLosses,
          }
        : undefined,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load market data";
    res.status(400).json({ error: message });
  }
});

app.post("/api/hints", (req: Request, res: Response) => {
  const text = typeof req.body?.text === "string" ? req.body.text : "";
  if (!text.trim()) {
    res.status(400).json({ error: "Signal text is required" });
    return;
  }

  try {
    const hints = buildRecommendations({ text, market: req.body?.market });
    res.json(hints);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ error: message });
  }
});

app.post("/api/execute", async (req: Request, res: Response) => {
  try {
    const rawText = typeof req.body?.text === "string" ? req.body.text : "";
    const text = rawText.trim();
    if (!text) {
      res.status(400).json({ error: "Signal text is required" });
      return;
    }

    const signal = parseTradeSignal(text);
    const { bot, demoMode } = instantiateTradingBot();
    const result = await bot.executeSignal(signal);

    res.json({
      demoMode,
      signal: result.signal,
      payload: result.payload,
      response: result.response,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(400).json({ error: message });
  }
});

if (!process.env.VITEST_WORKER_ID) {
  app.listen(port, () => {
    console.log(`[bot] UI available at http://localhost:${port}`);
  });
}

export { app };
