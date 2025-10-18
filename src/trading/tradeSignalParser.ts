export type TradeSide = "long" | "short";
export type ExecutionType = "market" | "limit";

export type DistanceMode = "percent" | "absolute";

export interface DistanceConfig {
  readonly value: number;
  readonly mode: DistanceMode;
}

export interface TrailingStopConfig extends DistanceConfig {}

export interface EntryStrategySingle {
  readonly type: "single";
}

export interface EntryStrategyGrid {
  readonly type: "grid";
  readonly levels: number;
  readonly spacing: DistanceConfig;
}

export interface EntryStrategyTrailing {
  readonly type: "trailing";
  readonly levels: number;
  readonly step: DistanceConfig;
}

export type EntryStrategy = EntryStrategySingle | EntryStrategyGrid | EntryStrategyTrailing;

interface TrailingStopMatch {
  readonly config: TrailingStopConfig;
  readonly sanitizedText: string;
}

export interface TradeSignal {
  readonly side: TradeSide;
  readonly symbol: string;
  readonly rawSymbol: string;
  readonly size: number;
  readonly entryPrice?: number;
  readonly stopLoss?: number;
  readonly takeProfits: number[];
  readonly leverage?: number;
  readonly execution: ExecutionType;
  readonly trailingStop?: TrailingStopConfig;
  readonly entryStrategy: EntryStrategy;
  readonly text: string;
}

export class TradeSignalParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TradeSignalParseError";
  }
}

const SYMBOL_SUFFIXES = ["PERPETUAL", "PERP", "USDT", "USD", "SPOT"] as const;
const SYMBOL_ALIASES: Record<string, string> = {
  XBT: "BTC",
};

const VALUE_KEYWORDS = [
  "size",
  "qty",
  "quantity",
  "amount",
  "volume",
  "entry",
  "price",
  "stop",
  "sl",
  "take",
  "tp",
  "target",
  "at",
  "open",
  "close",
  "closed",
  "tracked",
  "track",
  "trade",
  "trades",
  "signal",
  "update",
  "vault",
  "position",
  "status",
  "margin",
  "utilization",
];

const VALUE_KEYWORD_SET = new Set(VALUE_KEYWORDS);

const CURRENCY_SYMBOLS = "\\$€£¥₩₿₹₽₺₫₴₦₱";
const OPTIONAL_CURRENCY = `(?:[${CURRENCY_SYMBOLS}])?`;
const NUMBER_CAPTURE = "(-?\\d+(?:[.,]\\d+)?)";
const TAKE_PROFIT_VALUE_PATTERN = new RegExp(
  `^\\s*(?:=|:|@|at)?\\s*${OPTIONAL_CURRENCY}\\s*${NUMBER_CAPTURE}`,
  "i",
);
const URL_PATTERN = /https?:/i;

const SPLIT_REGEX = /[\s,;]+/g;

const SIZE_PATTERNS = [
  new RegExp(`\\b(?:size|qty|quantity|amount|volume)\\b\\s*(?:=|:)?\\s*${OPTIONAL_CURRENCY}\\s*${NUMBER_CAPTURE}`, "i"),
];

const ENTRY_PATTERNS = [
  new RegExp(`\\bentry\\b\\s*(?:=|:)?\\s*${OPTIONAL_CURRENCY}\\s*${NUMBER_CAPTURE}`, "i"),
  new RegExp(`\\bprice\\b\\s*(?:=|:)?\\s*${OPTIONAL_CURRENCY}\\s*${NUMBER_CAPTURE}`, "i"),
  new RegExp(`(?:^|\\s)@\\s*${OPTIONAL_CURRENCY}\\s*${NUMBER_CAPTURE}`, "i"),
];

const STOP_PATTERNS = [
  new RegExp(`\\b(?:stop(?:\\s*loss)?|sl)\\b\\s*(?:=|:|@)?\\s*${OPTIONAL_CURRENCY}\\s*${NUMBER_CAPTURE}`, "i"),
];

const LEVERAGE_PATTERNS = [
  /(\d+(?:[.,]\d+)?)\s*x\b/i,
  /\b(?:leverage|lev)\b\s*(?:=|:)?\s*(\d+(?:[.,]\d+)?)/i,
];

const TRAILING_STOP_PATTERNS = [
  /\btrail(?:ing)?\s+stop\b(?:\s*(?:=|:))?\s*(\d+(?:[.,]\d+)?)(?:\s*(%|pct|percent|bps?|bp))?/i,
  /\bts\b\s*(?:=|:)?\s*(\d+(?:[.,]\d+)?)(?:\s*(%|pct|percent|bps?|bp))?/i,
];

const GRID_PATTERNS = [
  /\bgrid\s+(\d+)\s+(?:step\s+)?(\d+(?:[.,]\d+)?)(?:\s*(%|pct|percent|bps?|bp))?/i,
  /\bgrid\s*(\d+)\s*[xX]\s*(\d+(?:[.,]\d+)?)(?:\s*(%|pct|percent|bps?|bp))?/i,
  /\bgrid(\d+)[xX](\d+(?:[.,]\d+)?)(%|pct|percent|bps?|bp)?/i,
];

const TRAIL_ENTRY_PATTERNS = [
  /\btrail(?:ing)?\s+(?:entry|entries)\s+(\d+)\s+(?:step\s+)?(\d+(?:[.,]\d+)?)(?:\s*(%|pct|percent|bps?|bp))?/i,
  /\btrail(?:ing)?\s+(?:entry|entries)\s*(\d+)\s*[xX]\s*(\d+(?:[.,]\d+)?)(?:\s*(%|pct|percent|bps?|bp))?/i,
  /\btrail(?:ing)?(?:entry|entries)?(\d+)[xX](\d+(?:[.,]\d+)?)(%|pct|percent|bps?|bp)?/i,
];

export function normalizeSymbol(raw: string): string {
  let symbol = raw.trim().toUpperCase();
  if (!symbol) {
    return "";
  }

  symbol = symbol.replace(/[^A-Z0-9]/g, "");
  for (const suffix of SYMBOL_SUFFIXES) {
    if (symbol.endsWith(suffix)) {
      symbol = symbol.slice(0, -suffix.length);
    }
  }
  if (symbol in SYMBOL_ALIASES) {
    symbol = SYMBOL_ALIASES[symbol];
  }
  return symbol;
}

function parseNumeric(value: string): number | undefined {
  const normalized = value.replace(/\s+/g, "").replace(",", ".");
  if (!/^[-+]?\d*(?:\.\d+)?$/.test(normalized)) {
    return undefined;
  }
  const result = Number.parseFloat(normalized);
  return Number.isFinite(result) ? result : undefined;
}

function cleanToken(token: string): string {
  return token.replace(/^[^A-Za-z0-9@]+|[^A-Za-z0-9@]+$/g, "");
}

function parsePositiveInteger(raw: string, label: string): number {
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value <= 0) {
    throw new TradeSignalParseError(`${label} must be a positive integer`);
  }
  return value;
}

function parseDistanceConfig(rawValue: string, rawSuffix: string | undefined, label: string): DistanceConfig {
  const numeric = parseNumeric(rawValue);
  if (numeric === undefined || numeric <= 0) {
    throw new TradeSignalParseError(`${label} must be a positive number`);
  }

  if (!rawSuffix) {
    return {
      value: numeric,
      mode: "absolute",
    } satisfies DistanceConfig;
  }

  const suffix = rawSuffix.trim().toLowerCase();
  if (!suffix) {
    return {
      value: numeric,
      mode: "absolute",
    } satisfies DistanceConfig;
  }

  if (suffix === "%" || suffix === "percent" || suffix === "pct") {
    return {
      value: numeric,
      mode: "percent",
    } satisfies DistanceConfig;
  }

  if (suffix === "bp" || suffix === "bps") {
    return {
      value: numeric / 100,
      mode: "percent",
    } satisfies DistanceConfig;
  }

  throw new TradeSignalParseError(`${label} unit "${rawSuffix}" is not supported`);
}

function extractTrailingStop(text: string): TrailingStopMatch | undefined {
  for (const pattern of TRAILING_STOP_PATTERNS) {
    pattern.lastIndex = 0;
    const match = pattern.exec(text);
    if (!match) {
      continue;
    }
    const [, valueRaw, suffixRaw] = match;
    const config = parseDistanceConfig(valueRaw, suffixRaw, "Trailing stop");
    const matchedText = match[0];
    const start = match.index ?? text.indexOf(matchedText);
    const end = start + matchedText.length;
    const sanitizedText = `${text.slice(0, start)} ${text.slice(end)}`;
    return {
      config,
      sanitizedText,
    } satisfies TrailingStopMatch;
  }
  return undefined;
}

function extractEntryStrategy(text: string): EntryStrategy | undefined {
  const strategies: EntryStrategy[] = [];

  for (const pattern of TRAIL_ENTRY_PATTERNS) {
    pattern.lastIndex = 0;
    const match = pattern.exec(text);
    if (!match) {
      continue;
    }
    const [, levelsRaw, stepRaw, suffixRaw] = match;
    const levels = parsePositiveInteger(levelsRaw, "Trailing entry levels");
    const step = parseDistanceConfig(stepRaw, suffixRaw, "Trailing entry step");
    strategies.push({
      type: "trailing",
      levels,
      step,
    });
    break;
  }

  for (const pattern of GRID_PATTERNS) {
    pattern.lastIndex = 0;
    const match = pattern.exec(text);
    if (!match) {
      continue;
    }
    const [, levelsRaw, spacingRaw, suffixRaw] = match;
    const levels = parsePositiveInteger(levelsRaw, "Grid levels");
    const spacing = parseDistanceConfig(spacingRaw, suffixRaw, "Grid spacing");
    strategies.push({
      type: "grid",
      levels,
      spacing,
    });
    break;
  }

  if (strategies.length > 1) {
    throw new TradeSignalParseError("Multiple entry strategies specified; choose either grid or trailing entries");
  }

  return strategies[0];
}

function extractSingle(text: string, patterns: RegExp[]): number | undefined {
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    const match = pattern.exec(text);
    if (match) {
      const raw = match[match.length - 1];
      if (raw !== undefined) {
        const numeric = parseNumeric(raw);
        if (numeric !== undefined) {
          return numeric;
        }
      }
    }
  }
  return undefined;
}

function extractTakeProfits(text: string): number[] {
  const pattern = /\b(?:tp\d*|tp|take\s*profit|target)\b/gi;
  const values: number[] = [];
  const seen = new Set<string>();
  pattern.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const slice = text.slice(match.index + match[0].length);
    const numberMatch = TAKE_PROFIT_VALUE_PATTERN.exec(slice);
    if (!numberMatch) {
      continue;
    }
    const numeric = parseNumeric(numberMatch[1]);
    if (numeric === undefined) {
      continue;
    }
    const key = numeric.toString();
    if (!seen.has(key)) {
      values.push(numeric);
      seen.add(key);
    }
  }
  return values;
}

export function parseTradeSignal(text: string): TradeSignal {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new TradeSignalParseError("Signal text is empty");
  }

  const tokens = trimmed.split(SPLIT_REGEX).map((token) => cleanToken(token)).filter(Boolean);
  if (tokens.length === 0) {
    throw new TradeSignalParseError("Signal does not contain recognizable tokens");
  }

  let side: TradeSide | undefined;
  let sideIndex = -1;
  for (let i = 0; i < tokens.length; ++i) {
    const token = tokens[i].toLowerCase();
    if (token === "long" || token === "buy") {
      side = "long";
      sideIndex = i;
      break;
    }
    if (token === "short" || token === "sell") {
      side = "short";
      sideIndex = i;
      break;
    }
  }
  if (!side) {
    throw new TradeSignalParseError("Signal side (long/short) is missing");
  }

  let rawSymbol = "";
  let fallbackSymbol = "";
  for (let i = sideIndex + 1; i < tokens.length; ++i) {
    const token = tokens[i];
    if (!token) {
      continue;
    }
    if (URL_PATTERN.test(token)) {
      continue;
    }
    const lower = token.toLowerCase();
    if (VALUE_KEYWORD_SET.has(lower)) {
      continue;
    }
    if (/^[\d@]/.test(token)) {
      continue;
    }
    const normalizedCandidate = normalizeSymbol(token);
    if (!normalizedCandidate) {
      continue;
    }
    if (token === token.toUpperCase()) {
      rawSymbol = token;
      break;
    }
    if (!fallbackSymbol) {
      fallbackSymbol = token;
    }
  }
  if (!rawSymbol) {
    rawSymbol = fallbackSymbol;
  }
  if (!rawSymbol) {
    throw new TradeSignalParseError("Trading symbol could not be detected");
  }

  const normalizedSymbol = normalizeSymbol(rawSymbol);
  if (!normalizedSymbol) {
    throw new TradeSignalParseError(`Invalid trading symbol "${rawSymbol}"`);
  }

  let size = extractSingle(trimmed, SIZE_PATTERNS);
  let entryPrice = extractSingle(trimmed, ENTRY_PATTERNS);
  if (size === undefined) {
    for (let i = sideIndex + 1; i < tokens.length; ++i) {
      const token = tokens[i];
      if (!token || token.toLowerCase() === "@") {
        continue;
      }
      if (/^@/.test(token)) {
        const candidate = parseNumeric(token.slice(1));
        if (candidate !== undefined && entryPrice === undefined) {
          entryPrice = candidate;
        }
        continue;
      }
      const numeric = parseNumeric(token);
      if (numeric !== undefined) {
        size = numeric;
        break;
      }
    }
  }
  if (size === undefined || size <= 0) {
    throw new TradeSignalParseError("Position size is missing or invalid");
  }

  let execution: ExecutionType = "limit";
  const hasMarket = /\bmarket\b/i.test(trimmed);
  const hasLimit = /\blimit\b/i.test(trimmed);
  if (hasMarket && !hasLimit) {
    execution = "market";
  } else if (!hasLimit && !hasMarket && entryPrice === undefined) {
    execution = "market";
  }

  const trailingStopMatch = extractTrailingStop(trimmed);
  const stopScanText = trailingStopMatch?.sanitizedText ?? trimmed;
  const stopLoss = extractSingle(stopScanText, STOP_PATTERNS);
  const takeProfits = extractTakeProfits(trimmed);
  const leverage = extractSingle(trimmed, LEVERAGE_PATTERNS);
  const trailingStop = trailingStopMatch?.config;
  const entryStrategy: EntryStrategy = extractEntryStrategy(trimmed) ?? { type: "single" };

  if (execution === "limit" && entryPrice === undefined) {
    execution = "market";
  }

  if (stopLoss === undefined && !trailingStop) {
    throw new TradeSignalParseError("Stop loss is required");
  }
  if (takeProfits.length === 0) {
    throw new TradeSignalParseError("At least one take profit is required");
  }

  return {
    side,
    symbol: normalizedSymbol,
    rawSymbol,
    size,
    entryPrice,
    stopLoss,
    takeProfits,
    leverage,
    execution,
    trailingStop,
    entryStrategy,
    text: trimmed,
  };
}
