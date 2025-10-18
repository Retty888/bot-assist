import path from "node:path";
import { fileURLToPath } from "node:url";

import express, { type Request, type Response } from "express";

import { parseTradeSignal } from "./trading/tradeSignalParser.js";
import { DEFAULT_SIGNAL, instantiateTradingBot } from "./runtime/botRuntime.js";

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

app.listen(port, () => {
  console.log(`[bot] UI available at http://localhost:${port}`);
});
