export type TradeSide = "long" | "short";
export type ExecutionType = "market" | "limit";

export type DistanceMode = "percent" | "absolute";

export interface DistanceConfig {
  readonly value: number;
  readonly mode: DistanceMode;
}

export interface TrailingStopConfig extends DistanceConfig {}

export type RiskLabel = "low" | "medium" | "high" | "extreme";

export type TimeframeHint = string;

export interface TargetAllocation {
  readonly price: number;
  readonly sizeFraction?: number;
  readonly label?: string;
}

export interface StopLossLevel extends TargetAllocation {}

export interface TakeProfitLevel extends TargetAllocation {}

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
  readonly stopLosses: readonly StopLossLevel[];
  readonly takeProfits: readonly TakeProfitLevel[];
  readonly leverage?: number;
  readonly execution: ExecutionType;
  readonly trailingStop?: TrailingStopConfig;
  readonly entryStrategy: EntryStrategy;
  readonly riskLabel?: RiskLabel;
  readonly timeframeHints: readonly TimeframeHint[];
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
  "risk",
  "risklabel",
  "timeframe",
  "tf",
];

const VALUE_KEYWORD_SET = new Set(VALUE_KEYWORDS);

const CURRENCY_SYMBOLS = "\\$€£¥₩₿₹₽₺₫₴₦₱";
const OPTIONAL_CURRENCY = `(?:[${CURRENCY_SYMBOLS}])?`;
const NUMBER_CAPTURE = "(-?\\d+(?:[.,]\\d+)?)";
const VALUE_WITH_PERCENT_PATTERN = new RegExp(
  `^\\s*(?:=|:|@|at)?\\s*${OPTIONAL_CURRENCY}\\s*${NUMBER_CAPTURE}` +
    `(?:\\s*(?:\\(|\\[)?\\s*(\\d+(?:[.,]\\d+)?)\\s*(?:%|pct|percent)\\s*(?:\\)|\\])?)?`,
  "i",
);
const PERCENT_FINDER_PATTERN = /(\\d+(?:[.,]\\d+)?)\\s*(%|pct|percent)/i;
const URL_PATTERN = /https?:/i;

const SPLIT_REGEX = /[\s,;]+/g;

const TAKE_PROFIT_TOKEN_PATTERN = /\b(?:tp\d*|tp|take\s*profit\d*|take\s*profit|target\d*|target)\b/gi;
const STOP_LEVEL_TOKEN_PATTERN = /\b(?:sl\d*|stoploss\d*|stoplosses\d*|stop(?:\s*loss(?:es)?)?\d*|psl\d*)\b/gi;

const RISK_PATTERNS = [
  /\brisk(?:\s*level|\s*profile|\s*label)?\b\s*(?:=|:)?\s*([a-z\-]+)/i,
  /\b([a-z\-]+)\s*risk\b/i,
];

const RISK_KEYWORD_MAP: Record<string, RiskLabel> = {
  low: "low",
  conservative: "low",
  defensive: "low",
  safe: "low",
  medium: "medium",
  mid: "medium",
  moderate: "medium",
  balanced: "medium",
  neutral: "medium",
  base: "medium",
  high: "high",
  aggressive: "high",
  elevated: "high",
  risky: "high",
  offensive: "high",
  extreme: "extreme",
  degen: "extreme",
  insane: "extreme",
  ultrahigh: "extreme",
  ballistic: "extreme",
};

const TIMEFRAME_KEYWORD_NORMALIZATION: Record<string, string> = {
  scalp: "scalp",
  scalping: "scalp",
  scalper: "scalp",
  swing: "swing",
  swingtrade: "swing",
  swingtrading: "swing",
  intraday: "intraday",
  daytrade: "intraday",
  daytrading: "intraday",
  daytrader: "intraday",
  position: "position",
  positional: "position",
  positiontrade: "position",
  positiontrading: "position",
  longterm: "position",
  longtermhold: "position",
  investor: "position",
};

const WORD_TIMEFRAME_PATTERN = /\b(\d+)\s*(minute|minutes|min|hour|hours|hr|day|days|week|weeks)\b/gi;

const SIZE_PATTERNS = [
  new RegExp(`\\b(?:size|qty|quantity|amount|volume)\\b\\s*(?:=|:)?\\s*${OPTIONAL_CURRENCY}\\s*${NUMBER_CAPTURE}`, "i"),
];

const ENTRY_PATTERNS = [
  new RegExp(`\\bentry\\b\\s*(?:=|:)?\\s*${OPTIONAL_CURRENCY}\\s*${NUMBER_CAPTURE}`, "i"),
  new RegExp(`\\bprice\\b\\s*(?:=|:)?\\s*${OPTIONAL_CURRENCY}\\s*${NUMBER_CAPTURE}`, "i"),
  new RegExp(`(?:^|\\s)@\\s*${OPTIONAL_CURRENCY}\\s*${NUMBER_CAPTURE}`, "i"),
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

function limitValueSlice(slice: string): string {
  const newlineIndex = slice.search(/[\r\n]/);
  if (newlineIndex >= 0) {
    return slice.slice(0, newlineIndex);
  }
  const limit = Math.min(slice.length, 120);
  return slice.slice(0, limit);
}

function normalizeLevelLabel(raw: string): string | undefined {
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) {
    return undefined;
  }
  const normalized = trimmed.replace(/[^a-z0-9]+/g, "");
  return normalized || undefined;
}

function normalizePercentValue(value: number | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!(value > 0)) {
    return undefined;
  }
  const normalized = value / 100;
  if (normalized > 1) {
    return 1;
  }
  return normalized;
}

function extractFractionFromSlice(slice: string, inlinePercent?: string): number | undefined {
  if (inlinePercent !== undefined) {
    const inlineNumeric = parseNumeric(inlinePercent);
    const normalized = normalizePercentValue(inlineNumeric);
    if (normalized !== undefined) {
      return normalized;
    }
  }

  const limited = limitValueSlice(slice);
  const percentMatch = PERCENT_FINDER_PATTERN.exec(limited);
  if (percentMatch) {
    const percentNumeric = parseNumeric(percentMatch[1]);
    const normalized = normalizePercentValue(percentNumeric);
    if (normalized !== undefined) {
      return normalized;
    }
  }
  return undefined;
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

function extractTakeProfitLevels(text: string): TakeProfitLevel[] {
  const pattern = TAKE_PROFIT_TOKEN_PATTERN;
  pattern.lastIndex = 0;
  const levels: TakeProfitLevel[] = [];
  const seen = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const labelRaw = match[0];
    const slice = text.slice(match.index + labelRaw.length);
    const limited = limitValueSlice(slice);
    const valueMatch = VALUE_WITH_PERCENT_PATTERN.exec(limited);
    if (!valueMatch) {
      continue;
    }
    const price = parseNumeric(valueMatch[1]);
    if (price === undefined) {
      continue;
    }
    const fraction = extractFractionFromSlice(limited, valueMatch[2]);
    const label = normalizeLevelLabel(labelRaw);
    const key = `${label ?? ""}:${price}:${fraction ?? ""}`;
    if (seen.has(key)) {
      continue;
    }
    levels.push({
      price,
      sizeFraction: fraction,
      label,
    });
    seen.add(key);
  }
  return levels;
}

function extractStopLevels(text: string): StopLossLevel[] {
  const pattern = STOP_LEVEL_TOKEN_PATTERN;
  pattern.lastIndex = 0;
  const levels: StopLossLevel[] = [];
  const seen = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const raw = match[0];
    const slice = text.slice(match.index + raw.length);
    const limited = limitValueSlice(slice);
    const valueMatch = VALUE_WITH_PERCENT_PATTERN.exec(limited);
    if (!valueMatch) {
      continue;
    }
    const price = parseNumeric(valueMatch[1]);
    if (price === undefined) {
      continue;
    }
    const fraction = extractFractionFromSlice(limited, valueMatch[2]);
    const label = normalizeLevelLabel(raw);
    const key = `${label ?? ""}:${price}:${fraction ?? ""}`;
    if (seen.has(key)) {
      continue;
    }
    levels.push({
      price,
      sizeFraction: fraction,
      label,
    });
    seen.add(key);
  }
  return levels;
}

function normalizeRiskDescriptor(raw: string | undefined): RiskLabel | undefined {
  if (!raw) {
    return undefined;
  }
  const normalized = raw.toLowerCase().replace(/[^a-z]/g, "");
  if (!normalized) {
    return undefined;
  }
  return RISK_KEYWORD_MAP[normalized];
}

function extractRiskLabel(text: string): RiskLabel | undefined {
  for (const pattern of RISK_PATTERNS) {
    pattern.lastIndex = 0;
    const match = pattern.exec(text);
    if (!match) {
      continue;
    }
    const candidate = normalizeRiskDescriptor(match[1]);
    if (candidate) {
      return candidate;
    }
  }
  return undefined;
}

function normalizeTimeframeToken(token: string): string | undefined {
  const trimmed = token.trim().toLowerCase();
  if (!trimmed) {
    return undefined;
  }
  const compactMatch = /^([0-9]+)([mhdw])$/.exec(trimmed);
  if (compactMatch) {
    return `${compactMatch[1]}${compactMatch[2].toLowerCase()}`;
  }

  const aliasMatch = /^([0-9]+)(?:min|mins|minute|minutes)$/.exec(trimmed);
  if (aliasMatch) {
    return `${aliasMatch[1]}m`;
  }
  const hourMatch = /^([0-9]+)(?:h|hr|hrs|hour|hours)$/.exec(trimmed);
  if (hourMatch) {
    return `${hourMatch[1]}h`;
  }
  const dayMatch = /^([0-9]+)(?:d|day|days)$/.exec(trimmed);
  if (dayMatch) {
    return `${dayMatch[1]}d`;
  }
  const weekMatch = /^([0-9]+)(?:w|week|weeks)$/.exec(trimmed);
  if (weekMatch) {
    return `${weekMatch[1]}w`;
  }

  if (TIMEFRAME_KEYWORD_NORMALIZATION[trimmed]) {
    return TIMEFRAME_KEYWORD_NORMALIZATION[trimmed];
  }

  if (trimmed === "daily") {
    return "1d";
  }
  if (trimmed === "weekly") {
    return "1w";
  }
  if (trimmed === "monthly") {
    return "4w";
  }
  if (trimmed === "hourly") {
    return "1h";
  }

  return undefined;
}

function extractTimeframeHints(text: string, tokens: readonly string[]): string[] {
  const hints = new Set<string>();

  let match: RegExpExecArray | null;
  const explicitPattern = /\b([0-9]+)\s*([mhdw])\b/gi;
  explicitPattern.lastIndex = 0;
  while ((match = explicitPattern.exec(text)) !== null) {
    hints.add(`${match[1]}${match[2].toLowerCase()}`);
  }

  const compactPattern = /\b([0-9]+)([mhdw])\b/gi;
  compactPattern.lastIndex = 0;
  while ((match = compactPattern.exec(text)) !== null) {
    hints.add(`${match[1]}${match[2].toLowerCase()}`);
  }

  WORD_TIMEFRAME_PATTERN.lastIndex = 0;
  while ((match = WORD_TIMEFRAME_PATTERN.exec(text)) !== null) {
    const [, valueRaw, unitRaw] = match;
    const numeric = parseInt(valueRaw, 10);
    if (!Number.isFinite(numeric) || numeric <= 0) {
      continue;
    }
    const unit = unitRaw.toLowerCase();
    if (unit.startsWith("min")) {
      hints.add(`${numeric}m`);
    } else if (unit.startsWith("hr") || unit.startsWith("hour")) {
      hints.add(`${numeric}h`);
    } else if (unit.startsWith("day")) {
      hints.add(`${numeric}d`);
    } else if (unit.startsWith("week")) {
      hints.add(`${numeric}w`);
    }
  }

  const lowerTokens = tokens.map((token) => token.toLowerCase());
  for (let i = 0; i < lowerTokens.length; ++i) {
    const token = lowerTokens[i];
    const normalized = normalizeTimeframeToken(token);
    if (normalized) {
      hints.add(normalized);
      continue;
    }

    if (token === "tf" || token === "timeframe" || token === "horizon") {
      const next = lowerTokens[i + 1];
      if (next) {
        const direct = normalizeTimeframeToken(next);
        if (direct) {
          hints.add(direct);
        } else if (/^[0-9]+$/.test(next)) {
          const following = lowerTokens[i + 2];
          if (following) {
            const combined = normalizeTimeframeToken(`${next}${following}`);
            if (combined) {
              hints.add(combined);
            }
          }
        }
      }
    }
  }

  for (const token of lowerTokens) {
    const normalized = TIMEFRAME_KEYWORD_NORMALIZATION[token];
    if (normalized) {
      hints.add(normalized);
    }
  }

  return Array.from(hints);
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

  const riskLabel = extractRiskLabel(trimmed);
  const timeframeHints = extractTimeframeHints(trimmed, tokens);

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
  const stopLossLevels = extractStopLevels(stopScanText);
  const stopLoss = stopLossLevels[0]?.price;
  const takeProfits = extractTakeProfitLevels(trimmed);
  const leverage = extractSingle(trimmed, LEVERAGE_PATTERNS);
  const trailingStop = trailingStopMatch?.config;
  const entryStrategy: EntryStrategy = extractEntryStrategy(trimmed) ?? { type: "single" };

  if (execution === "limit" && entryPrice === undefined) {
    execution = "market";
  }

  if (stopLossLevels.length === 0 && !trailingStop) {
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
    stopLosses: stopLossLevels,
    takeProfits,
    leverage,
    execution,
    trailingStop,
    entryStrategy,
    riskLabel,
    timeframeHints,
    text: trimmed,
  };
}
