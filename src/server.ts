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
import {
  appendSignalHistory,
  appendTradeHistory,
  getSignalHistory,
  getTradeHistory,
} from "./storage/historyStore.js";
import type { ExecutionMode } from "./storage/historyStore.js";
import {
  createPosition,
  deletePosition,
  listPositions,
  type PositionInput,
  type PositionSide,
  updatePosition,
} from "./storage/positionStore.js";
import { getExecutionLogger, getRiskEngine } from "./runtime/serviceRegistry.js";

type MutablePositionInput = { -readonly [K in keyof PositionInput]: PositionInput[K] };

const app = express();
const port = Number.parseInt(process.env.PORT ?? "3000", 10);
const executionLogger = getExecutionLogger();
const riskEngine = getRiskEngine();

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
    const mode: ExecutionMode = demoMode ? "demo" : "live";
    const result = await bot.executeSignal(signal, { mode });

    void appendSignalHistory({
      text,
      parsedSymbol: signal.symbol,
      size: signal.size,
      mode,
    }).catch((error) => {
      console.warn("[history] failed to append signal", error);
    });

    const firstOrderPrice = result.payload.orders[0]?.p;
    const fallbackPrice = typeof firstOrderPrice === "string"
      ? Number.parseFloat(firstOrderPrice)
      : typeof firstOrderPrice === "number"
        ? firstOrderPrice
        : 0;
    const entryPrice = signal.entryPrice ?? fallbackPrice;
    const notionalUsd = Number.isFinite(entryPrice) ? signal.size * entryPrice : undefined;

    void appendTradeHistory({
      mode,
      symbol: signal.symbol,
      notionalUsd,
      payload: result.payload,
      response: result.response,
    }).catch((error) => {
      console.warn("[history] failed to append trade", error);
    });

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

app.get("/api/metrics", async (_req: Request, res: Response) => {
  try {
    const [metrics, risk] = await Promise.all([
      executionLogger.getMetrics(),
      riskEngine.describe(),
    ]);
    res.json({ metrics, risk });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load metrics";
    res.status(500).json({ error: message });
  }
});

app.get("/api/history", async (req: Request, res: Response) => {
  const limit = Number.parseInt(String(req.query.limit ?? "50"), 10);
  try {
    const history = await executionLogger.getHistory(Number.isFinite(limit) ? limit : undefined);
    res.json({ items: history });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load execution history";
    res.status(500).json({ error: message });
  }
});

app.get("/api/history/signals", async (req: Request, res: Response) => {
  const limit = Number.parseInt(String(req.query.limit ?? "20"), 10);
  try {
    const history = await getSignalHistory(Number.isFinite(limit) ? limit : undefined);
    res.json({ items: history });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load signal history";
    res.status(500).json({ error: message });
  }
});

app.get("/api/history/trades", async (req: Request, res: Response) => {
  const limit = Number.parseInt(String(req.query.limit ?? "20"), 10);
  try {
    const history = await getTradeHistory(Number.isFinite(limit) ? limit : undefined);
    res.json({ items: history });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load trade history";
    res.status(500).json({ error: message });
  }
});

function parsePositionBody(
  body: unknown,
  { partial = false }: { partial?: boolean } = {},
): PositionInput | Partial<PositionInput> {
  const payload = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  const symbolRaw = typeof payload.symbol === "string" ? payload.symbol.trim().toUpperCase() : undefined;
  const sideRaw = typeof payload.side === "string" ? payload.side.toLowerCase() : undefined;
  const side = sideRaw === "long" || sideRaw === "short" ? (sideRaw as PositionSide) : undefined;
  const size = payload.size === undefined ? undefined : Number(payload.size);
  const entryPrice = payload.entryPrice === undefined ? undefined : Number(payload.entryPrice);
  const stopLoss = payload.stopLoss === undefined ? undefined : Number(payload.stopLoss);
  const takeProfit = payload.takeProfit === undefined ? undefined : Number(payload.takeProfit);
  const tags = Array.isArray(payload.tags)
    ? (payload.tags.filter((value): value is string => typeof value === "string" && value.trim() !== "") as string[])
    : undefined;
  const notes = typeof payload.notes === "string" ? payload.notes : undefined;
  const source = typeof payload.source === "string" ? payload.source : undefined;

  if (!partial && !symbolRaw) {
    throw new Error("Position symbol is required");
  }
  if (!partial && !side) {
    throw new Error("Position side must be either long or short");
  }
  if (!partial && !(Number(size) > 0)) {
    throw new Error("Position size must be positive");
  }
  if (!partial && !(Number(entryPrice) > 0)) {
    throw new Error("Entry price must be positive");
  }

  const base: Partial<MutablePositionInput> = {};
  if (symbolRaw) {
    base.symbol = symbolRaw;
  }
  if (side) {
    base.side = side;
  }
  if (size !== undefined && Number.isFinite(size) && size > 0) {
    base.size = size;
  }
  if (entryPrice !== undefined && Number.isFinite(entryPrice) && entryPrice > 0) {
    base.entryPrice = entryPrice;
  }
  if (stopLoss !== undefined && Number.isFinite(stopLoss)) {
    base.stopLoss = stopLoss;
  }
  if (takeProfit !== undefined && Number.isFinite(takeProfit)) {
    base.takeProfit = takeProfit;
  }
  if (tags && tags.length > 0) {
    base.tags = tags;
  }
  if (notes) {
    base.notes = notes;
  }
  if (source === "test" || source === "live" || source === "manual") {
    base.source = source;
  }

  if (partial) {
    return base;
  }

  return {
    symbol: base.symbol!,
    side: base.side!,
    size: base.size!,
    entryPrice: base.entryPrice!,
    stopLoss: base.stopLoss,
    takeProfit: base.takeProfit,
    tags: base.tags,
    notes: base.notes,
    source: base.source,
  } satisfies PositionInput;
}

app.get("/api/positions", async (_req: Request, res: Response) => {
  const positions = await listPositions();
  res.json({ items: positions });
});

app.post("/api/positions", async (req: Request, res: Response) => {
  try {
    const input = parsePositionBody(req.body) as PositionInput;
    const created = await createPosition(input);
    res.status(201).json(created);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to create position";
    res.status(400).json({ error: message });
  }
});

app.put("/api/positions/:id", async (req: Request, res: Response) => {
  try {
    const id = req.params.id;
    if (!id) {
      res.status(400).json({ error: "Position id is required" });
      return;
    }
    const patch = parsePositionBody(req.body, { partial: true }) as Partial<PositionInput>;
    if (Object.keys(patch).length === 0) {
      res.status(400).json({ error: "At least one field must be provided" });
      return;
    }
    const updated = await updatePosition(id, patch);
    if (!updated) {
      res.status(404).json({ error: "Position not found" });
      return;
    }
    res.json(updated);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to update position";
    res.status(400).json({ error: message });
  }
});

app.delete("/api/positions/:id", async (req: Request, res: Response) => {
  const id = req.params.id;
  if (!id) {
    res.status(400).json({ error: "Position id is required" });
    return;
  }
  const deleted = await deletePosition(id);
  if (!deleted) {
    res.status(404).json({ error: "Position not found" });
    return;
  }
  res.status(204).send();
});

if (!process.env.VITEST_WORKER_ID) {
  app.listen(port, () => {
    console.log(`[bot] UI available at http://localhost:${port}`);
  });
}

export { app };
