import { initializeMarketDashboard } from "./charts.js";

const MODE_PLACEHOLDER = "Mode: —";

const body = document.body;

const form = document.getElementById("signal-form");
const textarea = document.getElementById("signal");
const statusMessage = document.getElementById("status-message");
const statusMode = document.getElementById("status-mode");
const parsedBlock = document.getElementById("parsed-signal");
const orderBlock = document.getElementById("order-payload");
const exchangeBlock = document.getElementById("exchange-response");
const resetButton = document.getElementById("btn-reset");
const sampleButton = document.getElementById("btn-sample");
const autoSnippet = document.getElementById("auto-snippet");
const autoError = document.getElementById("auto-error");
const hintStatus = document.getElementById("hint-status");
const hintSummary = document.getElementById("hint-summary");
const themeToggle = document.getElementById("theme-toggle");
const themeToggleLabel = themeToggle?.querySelector(".theme-toggle__label");
const themeToggleIcon = themeToggle?.querySelector(".theme-toggle__icon");

const marketSymbol = document.getElementById("market-symbol");
const marketMid = document.getElementById("market-mid");
const marketSpread = document.getElementById("market-spread");
const marketVolatility = document.getElementById("market-volatility");
const marketFunding = document.getElementById("market-funding");
const marketVolume = document.getElementById("market-volume");
const marketUpdated = document.getElementById("market-updated");
const marketModeBadge = document.getElementById("market-mode-badge");
const chartSnapshotImage = document.getElementById("chart-snapshot");
const snapshotCaption = document.getElementById("snapshot-caption");
const snapshotIntervalSelect = document.getElementById("snapshot-interval");
const snapshotRangeSelect = document.getElementById("snapshot-range");
const snapshotRefreshButton = document.getElementById("snapshot-refresh");
const chartSignalSelect = document.getElementById("chart-signal-select");
const signalSpotlightDetails = document.getElementById("signal-spotlight-details");
const spotlightLoadButton = document.getElementById("spotlight-load");
const hintContextElements = {
  symbol: document.getElementById("hint-symbol"),
  price: document.getElementById("hint-price"),
  atr: document.getElementById("hint-atr"),
  volatility: document.getElementById("hint-volatility"),
  size: document.getElementById("hint-size"),
  notional: document.getElementById("hint-notional"),
  funding: document.getElementById("hint-funding"),
};
const autoRefreshToggle = document.getElementById("auto-refresh-toggle");
const autoRefreshIntervalInput = document.getElementById("auto-refresh-interval");
const autoRefreshLabel = document.getElementById("auto-refresh-label");
const refreshNowButton = document.getElementById("refresh-now");

const sampleSignalList = document.getElementById("sample-signal-list");
const potentialSignalList = document.getElementById("potential-signal-list");
const demoPositionRows = document.getElementById("demo-position-rows");
const symbolChips = Array.from(document.querySelectorAll(".symbol-chip"));
const historyList = document.getElementById("history-list");
const historyEmpty = document.getElementById("history-empty");
const historyClearButton = document.getElementById("history-clear");
const positionForm = document.getElementById("position-form");
const positionSymbolInput = document.getElementById("position-symbol");
const positionSideInput = document.getElementById("position-side");
const positionSizeInput = document.getElementById("position-size");
const positionEntryInput = document.getElementById("position-entry");
const positionStopInput = document.getElementById("position-stop");
const positionTakeProfitInput = document.getElementById("position-tp");
const positionTagsInput = document.getElementById("position-tags");
const positionNotesInput = document.getElementById("position-notes");
const positionNotionalLabel = document.getElementById("position-notional");
const positionRiskLabel = document.getElementById("position-risk");
const positionSelect = document.getElementById("position-select");
const positionNewButton = document.getElementById("position-new");
const positionRefreshButton = document.getElementById("position-refresh");
const positionDeleteButton = document.getElementById("position-delete");

const UI_PLACEHOLDER = "—";
const DEFAULT_SPOTLIGHT_MESSAGE = "Pick a signal to review its context and modules.";
const DEFAULT_SNAPSHOT_CAPTION = "Select a signal to capture its market context.";

const usdFormatter = new Intl.NumberFormat(undefined, {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const priceFormatter = new Intl.NumberFormat(undefined, {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

const sizeFormatter = new Intl.NumberFormat(undefined, {
  minimumFractionDigits: 0,
  maximumFractionDigits: 3,
});

const hintSlotElements = Array.from(document.querySelectorAll("[data-hint-slot]"))
  .filter((element) => element instanceof HTMLElement)
  .reduce((acc, element) => {
    const key = element.getAttribute("data-hint-slot");
    if (key) {
      acc[key] = element;
    }
    return acc;
  }, {});

const toggleButtons = {
  trailingStop: document.querySelector('[data-feature="trailingStop"]'),
  grid: document.querySelector('[data-feature="grid"]'),
  trailEntry: document.querySelector('[data-feature="trailEntry"]'),
};

const featurePanels = {
  trailingStop: document.getElementById("settings-trailingStop"),
  grid: document.getElementById("settings-grid"),
  trailEntry: document.getElementById("settings-trailEntry"),
};

const trailingStopValueInput = document.getElementById("trailing-stop-value");
const trailingStopUnitSelect = document.getElementById("trailing-stop-unit");
const gridLevelsInput = document.getElementById("grid-levels");
const gridSpacingValueInput = document.getElementById("grid-spacing-value");
const gridSpacingUnitSelect = document.getElementById("grid-spacing-unit");
const trailEntryLevelsInput = document.getElementById("trail-entry-levels");
const trailEntryStepValueInput = document.getElementById("trail-entry-step-value");
const trailEntryStepUnitSelect = document.getElementById("trail-entry-step-unit");

let cachedDefaultSignal = "";
let marketDashboard = null;
let focusedSignalId = null;

const THEME_STORAGE_KEY = "hl-theme";
const prefersDark = window.matchMedia("(prefers-color-scheme: dark)");
let manualTheme = null;

function resolveTheme(value) {
  return value === "light" ? "light" : "dark";
}

function updateThemeToggle(theme) {
  if (!themeToggle || !themeToggleLabel || !themeToggleIcon) {
    return;
  }
  if (theme === "light") {
    themeToggleLabel.textContent = "Light";
    themeToggleIcon.textContent = "☀️";
  } else {
    themeToggleLabel.textContent = "Dark";
    themeToggleIcon.textContent = "🌙";
  }
}

function applyTheme(theme, persist = false) {
  const resolved = resolveTheme(theme);
  body.dataset.theme = resolved;
  updateThemeToggle(resolved);
  if (persist) {
    manualTheme = resolved;
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, resolved);
    } catch (error) {
      console.warn("Unable to persist theme preference", error);
    }
  }
  marketDashboard?.setTheme(resolved);
}

function initializeTheme() {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (stored) {
      manualTheme = resolveTheme(stored);
    }
  } catch (error) {
    console.warn("Unable to read stored theme", error);
  }

  const initialTheme = manualTheme ?? resolveTheme(prefersDark.matches ? "dark" : "light");
  applyTheme(initialTheme, Boolean(manualTheme));

  prefersDark.addEventListener("change", (event) => {
    if (manualTheme) {
      return;
    }
    applyTheme(event.matches ? "dark" : "light");
  });

  themeToggle?.addEventListener("click", () => {
    const next = body.dataset.theme === "dark" ? "light" : "dark";
    applyTheme(next, true);
  });
}

function createDefaultFeatureState() {
  return {
    trailingStop: { enabled: false, value: 0.5, unit: "percent" },
    grid: { enabled: false, levels: 3, spacingValue: 150, unit: "absolute" },
    trailEntry: { enabled: false, levels: 4, stepValue: 0.25, unit: "percent" },
  };
}

const featureState = createDefaultFeatureState();

const SIGNAL_LIBRARY = [
  {
    id: "btc-breakout",
    label: "BTC ladder breakout",
    description: "Grid ×3 @ $120 + trailing stop 0.4%",
    symbol: "BTC",
    text:
      "Long BTC 3 entry 60000 stop 58500 tp1 62500 tp2 63500 trailing stop 0.4% grid 3 120 15m risk high",
    preset: {
      trailingStop: { value: 0.4, unit: "percent" },
      grid: { levels: 3, spacingValue: 120, unit: "absolute" },
    },
    category: "playbook",
    origin: "manual",
  },
  {
    id: "eth-momentum",
    label: "ETH momentum fade",
    description: "Trailing entries ×4 @ 0.35% + stop 0.6%",
    symbol: "ETH",
    text:
      "Short ETH size 4 entry 3520 stop 3650 tp1 3300 tp2 3200 trail entry 4 0.35% trailing stop 0.6% scalp risk extreme",
    preset: {
      trailingStop: { value: 0.6, unit: "percent" },
      trailEntry: { levels: 4, stepValue: 0.35, unit: "percent" },
    },
    category: "playbook",
    origin: "manual",
  },
  {
    id: "btc-swing",
    label: "BTC swing reload",
    description: "Single entry + trailing stop 1.0%",
    symbol: "BTC",
    text:
      "Long BTC 1.5 entry 59850 stop 58200 tp1 62400 tp2 63800 trailing stop 1% market swing risk medium",
    preset: {
      trailingStop: { value: 1, unit: "percent" },
    },
    category: "playbook",
    origin: "manual",
  },
  {
    id: "algo-btc-vwap",
    label: "BTC VWAP pullback scout",
    description: "Algo: 15m rejection + grid ×2 @ 0.6% with 0.5% trail stop",
    symbol: "BTC",
    text:
      "Long BTC size 2 entry 60120 stop 59200 tp1 61200 tp2 62000 grid 2 0.6% trailing stop 0.5% watchlist potential",
    preset: {
      trailingStop: { value: 0.5, unit: "percent" },
      grid: { levels: 2, spacingValue: 0.6, unit: "percent" },
    },
    category: "potential",
    origin: "algo",
  },
  {
    id: "desk-eth-news",
    label: "ETH news breakout watch",
    description: "Manual: monitor news impulse with trailing ladder",
    symbol: "ETH",
    text:
      "Long ETH 3 entry 3580 stop 3460 tp1 3740 tp2 3820 trail entry 3 0.25% trailing stop 0.8% news breakout",
    preset: {
      trailingStop: { value: 0.8, unit: "percent" },
      trailEntry: { levels: 3, stepValue: 0.25, unit: "percent" },
    },
    category: "potential",
    origin: "manual",
  },
];

const signalMap = new Map(SIGNAL_LIBRARY.map((signal) => [signal.id, signal]));
const playbookSignals = SIGNAL_LIBRARY.filter((signal) => signal.category === "playbook");
const potentialSignals = SIGNAL_LIBRARY.filter((signal) => signal.category === "potential");

let hintManager = null;
const REFRESH_STORAGE_KEY = "hl-market-refresh";
const HISTORY_STORAGE_KEY = "hl-execution-history";
let executionHistory = [];
let positions = [];
let activePositionId = null;
const refreshState = loadRefreshState();

function syncFeatureUI(feature) {
  const state = featureState[feature];
  const button = toggleButtons[feature];
  const panel = featurePanels[feature];
  if (button) {
    button.classList.toggle("active", state.enabled);
  }
  if (panel) {
    panel.classList.toggle("hidden", !state.enabled);
  }
}

function updateAllFeatureUI() {
  Object.keys(featureState).forEach((feature) => {
    syncFeatureUI(feature);
  });
}

function applyStateToInputs() {
  trailingStopValueInput.value = featureState.trailingStop.value;
  trailingStopUnitSelect.value = featureState.trailingStop.unit;
  gridLevelsInput.value = featureState.grid.levels;
  gridSpacingValueInput.value = featureState.grid.spacingValue;
  gridSpacingUnitSelect.value = featureState.grid.unit;
  trailEntryLevelsInput.value = featureState.trailEntry.levels;
  trailEntryStepValueInput.value = featureState.trailEntry.stepValue;
  trailEntryStepUnitSelect.value = featureState.trailEntry.unit;
}

function getFeatureSnapshot() {
  return {
    trailingStop: { ...featureState.trailingStop },
    grid: { ...featureState.grid },
    trailEntry: { ...featureState.trailEntry },
  };
}

function formatNumeric(value) {
  if (!Number.isFinite(value)) {
    return "";
  }
  const fixed = value.toFixed(6);
  return fixed.replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
}

function formatDistance(value, unit) {
  const numeric = formatNumeric(value);
  if (!numeric) {
    return "";
  }
  if (unit === "percent") {
    return `${numeric}%`;
  }
  if (unit === "bps") {
    return `${numeric} bps`;
  }
  return numeric;
}

function summarizePreset(preset) {
  if (!preset) {
    return "None";
  }
  const parts = [];
  if (preset.trailingStop) {
    const { value, unit } = preset.trailingStop;
    const formatted = formatDistance(value, unit);
    if (formatted) {
      parts.push(`Trailing stop ${formatted}`);
    }
  }
  if (preset.grid) {
    const { levels, spacingValue, unit } = preset.grid;
    const formatted = formatDistance(spacingValue, unit);
    if (formatted) {
      parts.push(`Grid ${levels} @ ${formatted}`);
    }
  }
  if (preset.trailEntry) {
    const { levels, stepValue, unit } = preset.trailEntry;
    const formatted = formatDistance(stepValue, unit);
    if (formatted) {
      parts.push(`Trailing entries ${levels} @ ${formatted}`);
    }
  }
  return parts.length > 0 ? parts.join(" · ") : "None";
}

function loadSignalIntoEditor(signal) {
  if (!signal) {
    return;
  }
  textarea.value = signal.text;
  applyFeaturePreset(signal.preset);
  const symbol = signal.symbol ?? "BTC";
  setActiveSymbolChip(symbol);
  if (signal.symbol) {
    marketDashboard?.setSymbol(signal.symbol);
  } else {
    marketDashboard?.scheduleRefresh();
  }
  textarea.focus();
}

function renderSignalSpotlight(signal) {
  if (!signalSpotlightDetails) {
    return;
  }
  signalSpotlightDetails.innerHTML = "";
  if (!signal) {
    signalSpotlightDetails.textContent = DEFAULT_SPOTLIGHT_MESSAGE;
    return;
  }
  const title = document.createElement("strong");
  title.textContent = signal.label;
  const description = document.createElement("p");
  description.textContent = signal.description ?? "—";
  const meta = document.createElement("ul");
  meta.className = "spotlight-meta";
  const rows = [
    { label: "Symbol", value: signal.symbol ?? UI_PLACEHOLDER },
    {
      label: "Source",
      value: signal.origin === "algo" ? "Algorithmic suggestion" : "Manual idea",
    },
    { label: "Preset", value: summarizePreset(signal.preset) },
  ];

  rows.forEach((row) => {
    const item = document.createElement("li");
    const label = document.createElement("strong");
    label.textContent = row.label;
    const value = document.createElement("span");
    value.textContent = row.value;
    item.append(label, document.createTextNode(": "), value);
    meta.appendChild(item);
  });

  signalSpotlightDetails.append(title, description, meta);
}

function updateSnapshotCaptionText(signal) {
  if (!snapshotCaption) {
    return;
  }
  if (!signal) {
    snapshotCaption.textContent = DEFAULT_SNAPSHOT_CAPTION;
    return;
  }
  const interval = snapshotIntervalSelect?.value ?? "1h";
  const rangeValue = snapshotRangeSelect?.value ?? "";
  const rangeLabels = {
    "1d": "1 day",
    "5d": "5 days",
    "1m": "1 month",
  };
  const rangeLabel = rangeLabels[rangeValue] ?? (rangeValue ? rangeValue : "custom range");
  const symbol = signal.symbol ?? signal.label;
  snapshotCaption.textContent = `${symbol} • ${interval} interval • ${rangeLabel}`;
}

function focusSignal(signalId, options = {}) {
  const { load = false, syncSelect = true, refreshSnapshot = true } = options;
  const signal = signalId ? signalMap.get(signalId) ?? null : null;
  focusedSignalId = signal ? signal.id : null;

  if (chartSignalSelect && syncSelect) {
    chartSignalSelect.value = signal ? signal.id : "";
  }

  renderSignalSpotlight(signal);
  updateSnapshotCaptionText(signal ?? null);

  if (signal?.symbol && !load) {
    setActiveSymbolChip(signal.symbol);
    marketDashboard?.setSymbol(signal.symbol);
  }

  if (signal && load) {
    loadSignalIntoEditor(signal);
  }

  if (refreshSnapshot) {
    marketDashboard?.captureSnapshot({ symbol: signal?.symbol, force: true });
  }

  if (!signal && refreshSnapshot) {
    marketDashboard?.captureSnapshot({ force: true });
  }
}

function buildFeatureSegments() {
  const segments = [];
  const errors = [];

  if (featureState.grid.enabled && featureState.trailEntry.enabled) {
    errors.push("Choose either grid entries or trailing entries.");
  }

  if (featureState.trailingStop.enabled) {
    const { value, unit } = featureState.trailingStop;
    if (!(value > 0)) {
      errors.push("Trailing stop offset must be positive.");
    } else {
      const formatted = formatDistance(value, unit);
      if (!formatted) {
        errors.push("Trailing stop offset is invalid.");
      } else {
        segments.push({ marker: "trailing stop", text: `trailing stop ${formatted}` });
      }
    }
  }

  if (featureState.grid.enabled) {
    const { levels, spacingValue, unit } = featureState.grid;
    const validLevels = Number.isInteger(levels) && levels > 0;
    const validSpacing = spacingValue > 0;
    const formatted = formatDistance(spacingValue, unit);
    if (!validLevels) {
      errors.push("Grid levels must be a positive integer.");
    }
    if (!validSpacing) {
      errors.push("Grid spacing must be positive.");
    }
    if (!formatted) {
      errors.push("Grid spacing is invalid.");
    }
    if (validLevels && validSpacing && formatted) {
      segments.push({ marker: "grid ", text: `grid ${levels} ${formatted}` });
    }
  }

  if (featureState.trailEntry.enabled) {
    const { levels, stepValue, unit } = featureState.trailEntry;
    const validLevels = Number.isInteger(levels) && levels > 0;
    const validStep = stepValue > 0;
    const formatted = formatDistance(stepValue, unit);
    if (!validLevels) {
      errors.push("Trailing entry levels must be a positive integer.");
    }
    if (!validStep) {
      errors.push("Trailing entry step must be positive.");
    }
    if (!formatted) {
      errors.push("Trailing entry step is invalid.");
    }
    if (validLevels && validStep && formatted) {
      segments.push({ marker: "trailing entry", text: `trailing entry ${levels} ${formatted}` });
    }
  }

  return { segments, errors };
}

function updateSnippetPreview(precomputed) {
  const data = precomputed ?? buildFeatureSegments();
  const { segments, errors } = data;

  if (segments.length > 0) {
    autoSnippet.textContent = segments.map((segment) => segment.text).join(" | ");
  } else {
    autoSnippet.textContent = "(none)";
  }

  autoSnippet.classList.toggle("error", errors.length > 0);
  autoError.textContent = errors.join(" ");

  return data;
}

function appendFeatureSegments(baseText, segments) {
  let combined = baseText.trim();
  for (const segment of segments) {
    const marker = segment.marker;
    if (!combined.toLowerCase().includes(marker)) {
      combined = `${combined}\n${segment.text}`.trim();
    }
  }
  return combined;
}

function applyHintAction(action) {
  if (!action || !action.feature || !(action.feature in featureState)) {
    return;
  }

  const target = featureState[action.feature];

  if (Array.isArray(action.disable)) {
    action.disable.forEach((feature) => {
      if (feature in featureState) {
        featureState[feature].enabled = false;
      }
    });
  }

  if (typeof action.enable === "boolean") {
    target.enabled = action.enable;
  }

  if (action.params) {
    Object.entries(action.params).forEach(([key, value]) => {
      if (!(key in target)) {
        return;
      }
      const current = target[key];
      if (typeof current === "number") {
        const numeric = Number.parseFloat(String(value));
        if (Number.isFinite(numeric)) {
          target[key] = numeric;
        }
        return;
      }
      if (typeof current === "boolean") {
        target[key] = Boolean(value);
        return;
      }
      target[key] = value;
    });
  }

  applyStateToInputs();
  updateAllFeatureUI();
  updateSnippetPreview();
  hintManager?.scheduleRefresh();
}

function parseFloatSafe(value) {
  const numeric = Number.parseFloat(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function parseIntSafe(value) {
  const numeric = Number.parseInt(value, 10);
  return Number.isFinite(numeric) ? numeric : 0;
}

function setModePlaceholder() {
  statusMode.textContent = MODE_PLACEHOLDER;
}

function resetFeatures() {
  const defaults = createDefaultFeatureState();
  Object.keys(featureState).forEach((feature) => {
    Object.assign(featureState[feature], defaults[feature]);
  });
  applyStateToInputs();
  updateAllFeatureUI();
  updateSnippetPreview();
  hintManager?.scheduleRefresh();
}


function applyFeaturePreset(preset) {
  resetFeatures();
  if (!preset) {
    return;
  }

  if (preset.trailingStop) {
    featureState.trailingStop.enabled = true;
    featureState.trailingStop.value = preset.trailingStop.value ?? featureState.trailingStop.value;
    featureState.trailingStop.unit = preset.trailingStop.unit ?? featureState.trailingStop.unit;
  }

  if (preset.grid) {
    featureState.grid.enabled = true;
    featureState.grid.levels = preset.grid.levels ?? featureState.grid.levels;
    featureState.grid.spacingValue = preset.grid.spacingValue ?? featureState.grid.spacingValue;
    featureState.grid.unit = preset.grid.unit ?? featureState.grid.unit;
    featureState.trailEntry.enabled = false;
  }

  if (preset.trailEntry) {
    featureState.trailEntry.enabled = true;
    featureState.trailEntry.levels = preset.trailEntry.levels ?? featureState.trailEntry.levels;
    featureState.trailEntry.stepValue = preset.trailEntry.stepValue ?? featureState.trailEntry.stepValue;
    featureState.trailEntry.unit = preset.trailEntry.unit ?? featureState.trailEntry.unit;
    featureState.grid.enabled = false;
  }

  applyStateToInputs();
  updateAllFeatureUI();
  updateSnippetPreview();
  hintManager?.scheduleRefresh();
}


function formatUsd(value, { showSign = false } = {}) {
  if (!Number.isFinite(value)) {
    return UI_PLACEHOLDER;
  }
  const formatted = usdFormatter.format(value);
  if (showSign && value > 0) {
    return `+${formatted}`;
  }
  return formatted;
}


function formatSize(value) {
  if (!Number.isFinite(value)) {
    return UI_PLACEHOLDER;
  }
  return sizeFormatter.format(value);
}


function renderSampleSignals() {
  if (!sampleSignalList) {
    return;
  }
  sampleSignalList.innerHTML = "";
  playbookSignals.forEach((signal) => {
    const button = document.createElement("button");
    button.type = "button";
    button.innerHTML = `<strong>${signal.label}</strong><span>${signal.description}</span>`;
    button.addEventListener("click", () => {
      focusSignal(signal.id, { load: true });
    });
    sampleSignalList.appendChild(button);
  });
}

function renderPotentialSignals() {
  if (!potentialSignalList) {
    return;
  }
  potentialSignalList.innerHTML = "";
  if (potentialSignals.length === 0) {
    const empty = document.createElement("p");
    empty.className = "reference-lede";
    empty.textContent = "No potential signals pending review.";
    potentialSignalList.appendChild(empty);
    return;
  }
  potentialSignals.forEach((signal) => {
    const button = document.createElement("button");
    button.type = "button";
    button.innerHTML = `<strong>${signal.label}</strong><span>${signal.description}</span><small>${
      signal.origin === "algo" ? "Algorithmic suggestion" : "Manual idea"
    }</small>`;
    button.addEventListener("click", () => {
      focusSignal(signal.id, { load: false });
    });
    potentialSignalList.appendChild(button);
  });
}

function renderSignalSelect() {
  if (!chartSignalSelect) {
    return;
  }
  chartSignalSelect.innerHTML = "";
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Select signal";
  if (!focusedSignalId) {
    placeholder.selected = true;
  }
  chartSignalSelect.appendChild(placeholder);

  const groups = [
    { label: "Curated playbook", items: playbookSignals },
    { label: "Potential watchlist", items: potentialSignals },
  ];

  groups.forEach((group) => {
    if (!group.items || group.items.length === 0) {
      return;
    }
    const optgroup = document.createElement("optgroup");
    optgroup.label = group.label;
    group.items.forEach((signal) => {
      const option = document.createElement("option");
      option.value = signal.id;
      const suffix = signal.symbol ? ` (${signal.symbol})` : "";
      option.textContent = `${signal.label}${suffix}`;
      if (focusedSignalId === signal.id) {
        option.selected = true;
      }
      optgroup.appendChild(option);
    });
    chartSignalSelect.appendChild(optgroup);
  });
}


function renderPositionsTable() {
  if (!demoPositionRows) {
    return;
  }
  demoPositionRows.innerHTML = "";
  positions.forEach((position) => {
    const row = document.createElement("tr");
    row.dataset.positionId = position.id;
    if (position.id === activePositionId) {
      row.classList.add("active");
    }

    const symbolCell = document.createElement("td");
    symbolCell.textContent = position.symbol;
    row.appendChild(symbolCell);

    const sideCell = document.createElement("td");
    sideCell.textContent = position.side;
    row.appendChild(sideCell);

    const sizeCell = document.createElement("td");
    sizeCell.textContent = formatSize(position.size);
    row.appendChild(sizeCell);

    const entryCell = document.createElement("td");
    entryCell.textContent = Number.isFinite(position.entryPrice)
      ? priceFormatter.format(position.entryPrice)
      : UI_PLACEHOLDER;
    row.appendChild(entryCell);

    const pnlCell = document.createElement("td");
    pnlCell.textContent = UI_PLACEHOLDER;
    pnlCell.dataset.positive = "true";
    row.appendChild(pnlCell);

    row.addEventListener("click", () => {
      setActivePosition(position.id);
    });

    demoPositionRows.appendChild(row);
  });
}


function renderPositionSelect() {
  if (!positionSelect) {
    return;
  }
  positionSelect.innerHTML = "";
  positions.forEach((position) => {
    const option = document.createElement("option");
    option.value = position.id;
    option.textContent = `${position.symbol} • ${position.side} • ${formatSize(position.size)}`;
    if (position.id === activePositionId) {
      option.selected = true;
    }
    positionSelect.appendChild(option);
  });
  if (!activePositionId && positions[0]) {
    positionSelect.value = positions[0].id;
  }
}


function renderPositions() {
  renderPositionsTable();
  renderPositionSelect();
}


function populatePositionForm(position) {
  if (!positionForm) {
    return;
  }
  positionSymbolInput.value = position.symbol ?? "";
  positionSideInput.value = position.side ?? "long";
  positionSizeInput.value = position.size?.toString() ?? "";
  positionEntryInput.value = position.entryPrice?.toString() ?? "";
  positionStopInput.value = position.stopLoss?.toString() ?? "";
  positionTakeProfitInput.value = position.takeProfit?.toString() ?? "";
  positionTagsInput.value = Array.isArray(position.tags) ? position.tags.join(", ") : "";
  positionNotesInput.value = position.notes ?? "";
  updatePositionMetrics();
}


function clearPositionForm() {
  positionForm?.reset();
  updatePositionMetrics();
}


function updatePositionMetrics() {
  if (!positionNotionalLabel || !positionRiskLabel) {
    return;
  }
  const size = Number(positionSizeInput?.value ?? "0");
  const entry = Number(positionEntryInput?.value ?? "0");
  if (size > 0 && entry > 0) {
    const notional = size * entry;
    const riskPerPercent = notional * 0.01;
    positionNotionalLabel.textContent = `Notional: ${formatUsd(notional)}`;
    positionRiskLabel.textContent = `±1% move: ${formatUsd(riskPerPercent)}`;
  } else {
    positionNotionalLabel.textContent = "Notional: —";
    positionRiskLabel.textContent = "±1% move: —";
  }
}


function setActivePosition(id) {
  activePositionId = id ?? null;
  const position = positions.find((item) => item.id === id);
  if (position) {
    populatePositionForm(position);
    setActiveSymbolChip(position.symbol);
    marketDashboard?.setSymbol(position.symbol);
  }
  renderPositions();
}


function setActiveSymbolChip(symbol) {
  const normalized = (symbol ?? "").toUpperCase();
  symbolChips.forEach((chip) => {
    if (!(chip instanceof HTMLElement)) {
      return;
    }
    const matches = (chip.dataset.symbol ?? "").toUpperCase() === normalized;
    chip.classList.toggle("active", matches);
  });
}


function updateRefreshLabelDisplay(seconds) {
  if (autoRefreshLabel) {
    autoRefreshLabel.textContent = `${seconds}s`;
  }
}


function loadRefreshState() {
  try {
    const stored = window.localStorage.getItem(REFRESH_STORAGE_KEY);
    if (!stored) {
      return { enabled: true, interval: 20 };
    }
    const parsed = JSON.parse(stored);
    const enabled = typeof parsed?.enabled === "boolean" ? parsed.enabled : true;
    const interval = Number.isFinite(parsed?.interval) ? Math.max(5, Math.min(60, parsed.interval)) : 20;
    return { enabled, interval };
  } catch (error) {
    console.warn("Unable to read refresh settings", error);
    return { enabled: true, interval: 20 };
  }
}


function persistRefreshState(state) {
  try {
    window.localStorage.setItem(REFRESH_STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    console.warn("Unable to persist refresh settings", error);
  }
}


function applyRefreshState(state, { persist = false } = {}) {
  const enabled = state.enabled ?? true;
  const interval = Math.max(5, Math.min(60, Math.round(state.interval ?? 20)));
  if (autoRefreshToggle) {
    autoRefreshToggle.checked = enabled;
  }
  if (autoRefreshIntervalInput) {
    autoRefreshIntervalInput.value = interval.toString();
    autoRefreshIntervalInput.disabled = !enabled;
  }
  if (refreshNowButton) {
    refreshNowButton.disabled = !enabled;
    refreshNowButton.classList.toggle("disabled", !enabled);
  }
  updateRefreshLabelDisplay(interval);
  marketDashboard?.setRefreshOptions({ enabled, intervalMs: interval * 1000 });
  if (persist) {
    persistRefreshState({ enabled, interval });
  }
}



async function fetchPositionsFromServer() {
  try {
    const response = await fetch("/api/positions");
    if (!response.ok) {
      throw new Error(`Server responded with ${response.status}`);
    }
    const payload = await response.json();
    positions = Array.isArray(payload?.items) ? payload.items : [];
    renderPositions();
    if (positions.length > 0) {
      const defaultId = activePositionId ?? positions[0].id;
      setActivePosition(defaultId);
    } else {
      clearPositionForm();
    }
  } catch (error) {
    console.warn("Unable to load positions from server", error);
    renderPositions();
  }
}


function serializePositionForm() {
  const tags = positionTagsInput.value
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
  return {
    symbol: positionSymbolInput.value.trim().toUpperCase(),
    side: positionSideInput.value,
    size: Number(positionSizeInput.value),
    entryPrice: Number(positionEntryInput.value),
    stopLoss: positionStopInput.value ? Number(positionStopInput.value) : undefined,
    takeProfit: positionTakeProfitInput.value ? Number(positionTakeProfitInput.value) : undefined,
    tags,
    notes: positionNotesInput.value.trim() || undefined,
    source: "manual",
  };
}


async function savePosition() {
  if (!positionForm) {
    return;
  }
  const payload = serializePositionForm();
  const hasId = Boolean(activePositionId);
  const url = hasId ? `/api/positions/${activePositionId}` : "/api/positions";
  const method = hasId ? "PUT" : "POST";
  const response = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    throw new Error(typeof errorBody?.error === "string" ? errorBody.error : "Failed to save position");
  }
  const saved = await response.json();
  await fetchPositionsFromServer();
  if (saved?.id) {
    setActivePosition(saved.id);
  }
}


async function deletePositionOnServer() {
  if (!activePositionId) {
    return;
  }
  const response = await fetch(`/api/positions/${activePositionId}`, { method: "DELETE" });
  if (!response.ok && response.status !== 404) {
    const errorBody = await response.json().catch(() => ({}));
    throw new Error(typeof errorBody?.error === "string" ? errorBody.error : "Failed to delete position");
  }
  activePositionId = null;
  await fetchPositionsFromServer();
  if (positions[0]) {
    setActivePosition(positions[0].id);
  } else {
    clearPositionForm();
  }
}


function loadExecutionHistory() {
  try {
    const stored = window.localStorage.getItem(HISTORY_STORAGE_KEY);
    if (!stored) {
      executionHistory = [];
      return;
    }
    const parsed = JSON.parse(stored);
    if (Array.isArray(parsed)) {
      executionHistory = parsed.slice(0, 20);
    }
  } catch (error) {
    console.warn("Unable to read execution history", error);
    executionHistory = [];
  }
}


function persistExecutionHistory() {
  try {
    window.localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(executionHistory));
  } catch (error) {
    console.warn("Unable to persist execution history", error);
  }
}




async function syncHistoryFromServer(limit = 50) {
  try {
    const response = await fetch(`/api/history/signals?limit=${limit}`);
    if (!response.ok) {
      throw new Error(`Server responded with ${response.status}`);
    }
    const payload = await response.json();
    const items = Array.isArray(payload?.items) ? payload.items : [];
    executionHistory = items.map((item) => ({
      id: item.id ?? crypto.randomUUID(),
      text: item.text ?? "",
      timestamp: item.timestamp ?? Date.now(),
      symbol: item.parsedSymbol ?? "N/A",
      mode: item.mode ?? "demo",
    }));
    persistExecutionHistory();
    renderExecutionHistory();
  } catch (error) {
    console.warn("Unable to synchronize history from server", error);
    renderExecutionHistory();
  }
}

function renderExecutionHistory() {
  if (!historyList || !historyEmpty) {
    return;
  }
  historyList.innerHTML = "";
  if (executionHistory.length === 0) {
    historyEmpty.hidden = false;
    historyList.hidden = true;
    return;
  }
  historyEmpty.hidden = true;
  historyList.hidden = false;

  executionHistory.forEach((entry) => {
    const item = document.createElement("li");
    const meta = document.createElement("div");
    meta.className = "history-entry__meta";
    const timestamp = document.createElement("span");
    timestamp.textContent = new Date(entry.timestamp).toLocaleTimeString();
    const symbol = document.createElement("span");
    symbol.textContent = entry.symbol ?? "N/A";
    const mode = document.createElement("span");
    mode.textContent = entry.mode ?? "demo";
    meta.append(timestamp, symbol, mode);

    const text = document.createElement("p");
    text.className = "history-entry__text";
    text.textContent = entry.text;

    item.append(meta, text);
    historyList.appendChild(item);
  });
}


function recordExecution(entry) {
  executionHistory.unshift(entry);
  if (executionHistory.length > 20) {
    executionHistory.length = 20;
  }
  persistExecutionHistory();
  renderExecutionHistory();
  void syncHistoryFromServer(20);
}


function clearExecutionHistory() {
  executionHistory = [];
  persistExecutionHistory();
  renderExecutionHistory();
}

symbolChips.forEach((chip) => {
  chip.addEventListener("click", () => {
    const symbol = chip.dataset.symbol;
    if (!symbol) {
      return;
    }
    setActiveSymbolChip(symbol);
    focusSignal(null, { refreshSnapshot: false });
    marketDashboard?.setSymbol(symbol);
  });
});

chartSignalSelect?.addEventListener("change", () => {
  const value = chartSignalSelect.value;
  focusSignal(value || null, { load: false, syncSelect: false });
});

spotlightLoadButton?.addEventListener("click", () => {
  if (!focusedSignalId) {
    textarea.focus();
    return;
  }
  focusSignal(focusedSignalId, { load: true, refreshSnapshot: false });
});

snapshotIntervalSelect?.addEventListener("change", () => {
  marketDashboard?.setSnapshotOptions({ interval: snapshotIntervalSelect.value });
  updateSnapshotCaptionText(signalMap.get(focusedSignalId) ?? null);
  marketDashboard?.captureSnapshot({ force: true });
});

snapshotRangeSelect?.addEventListener("change", () => {
  marketDashboard?.setSnapshotOptions({ range: snapshotRangeSelect.value });
  updateSnapshotCaptionText(signalMap.get(focusedSignalId) ?? null);
  marketDashboard?.captureSnapshot({ force: true });
});

snapshotRefreshButton?.addEventListener("click", () => {
  marketDashboard?.captureSnapshot({ force: true });
});

historyClearButton?.addEventListener("click", () => {
  clearExecutionHistory();
});

if (historyList) {
  historyList.hidden = true;
}

if (historyEmpty) {
  historyEmpty.hidden = false;
}

autoRefreshToggle?.addEventListener("change", () => {
  refreshState.enabled = autoRefreshToggle.checked;
  applyRefreshState(refreshState, { persist: true });
});

autoRefreshIntervalInput?.addEventListener("input", () => {
  const seconds = Number.parseInt(autoRefreshIntervalInput.value, 10) || refreshState.interval;
  updateRefreshLabelDisplay(seconds);
});

autoRefreshIntervalInput?.addEventListener("change", () => {
  const seconds = Number.parseInt(autoRefreshIntervalInput.value, 10);
  if (Number.isFinite(seconds)) {
    refreshState.interval = Math.max(5, Math.min(60, seconds));
    applyRefreshState(refreshState, { persist: true });
  }
});

refreshNowButton?.addEventListener("click", () => {
  marketDashboard?.triggerRefresh();
});


positionForm?.addEventListener("input", () => {
  updatePositionMetrics();
});

positionForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  savePosition().catch((error) => {
    statusMessage.className = "status-message error";
    statusMessage.textContent = `Position save failed: ${error instanceof Error ? error.message : error}`;
  });
});

positionSelect?.addEventListener("change", () => {
  const selectedId = positionSelect.value;
  if (selectedId) {
    setActivePosition(selectedId);
  }
});

positionNewButton?.addEventListener("click", () => {
  activePositionId = null;
  clearPositionForm();
  positionSelect.value = "";
});

positionRefreshButton?.addEventListener("click", () => {
  fetchPositionsFromServer();
});

positionDeleteButton?.addEventListener("click", () => {
  if (!activePositionId) {
    return;
  }
  const shouldDelete = window.confirm("Delete selected position?");
  if (!shouldDelete) {
    return;
  }
  deletePositionOnServer().catch((error) => {
    statusMessage.className = "status-message error";
    statusMessage.textContent = `Position delete failed: ${error instanceof Error ? error.message : error}`;
  });
});


loadExecutionHistory();
renderExecutionHistory();
applyRefreshState(refreshState);
renderPositions();

void fetchPositionsFromServer();
void syncHistoryFromServer();
renderSampleSignals();
renderPotentialSignals();
renderSignalSelect();
focusSignal(null, { refreshSnapshot: false });
setActiveSymbolChip("BTC");

async function fetchDefaultSignal() {
  try {
    const response = await fetch("/api/default-signal");
    if (!response.ok) {
      throw new Error(`Server responded with ${response.status}`);
    }
    const payload = await response.json();
    if (typeof payload.defaultSignal === "string") {
      cachedDefaultSignal = payload.defaultSignal;
      textarea.value = payload.defaultSignal;
      resetFeatures();
      marketDashboard?.scheduleRefresh();
    }
  } catch (error) {
    console.error("Failed to load default signal", error);
    statusMessage.className = "status-message error";
    statusMessage.textContent = "Failed to load default signal. Check server logs.";
    setModePlaceholder();
  }
}

async function executeSignal(text) {
  const response = await fetch("/api/execute", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text }),
  });

  const payload = await response.json();
  if (!response.ok) {
    const message = typeof payload.error === "string" ? payload.error : "Unexpected error";
    throw new Error(message);
  }

  return payload;
}

function setBusy(isBusy) {
  const buttons = form.querySelectorAll("button");
  buttons.forEach((button) => {
    button.disabled = isBusy && button.type !== "button";
  });
  textarea.disabled = isBusy;
  if (isBusy) {
    form.classList.add("busy");
  } else {
    form.classList.remove("busy");
  }
}

class HintManager {
  constructor(options) {
    this.textarea = options.textarea;
    this.summary = options.summary;
    this.status = options.status;
    this.onApply = options.onApply;
    this.context = options.context;
    this.slots = { ...options.slots };
    this.slots.global = this.summary;
    this.uniqueSlots = Array.from(new Set(Object.values(this.slots)));
    this.debounceHandle = null;
    this.requestId = 0;
    this.loading = false;
  }

  scheduleRefresh() {
    if (this.debounceHandle) {
      window.clearTimeout(this.debounceHandle);
    }
    const text = this.textarea.value.trim();
    if (!text) {
      this.reset();
      this.setStatus("Paste a signal to pull insights.");
      return;
    }
    this.debounceHandle = window.setTimeout(() => {
      this.debounceHandle = null;
      this.fetchHints();
    }, 250);
  }

  setStatus(message) {
    if (this.status) {
      this.status.textContent = message;
    }
  }

  setLoading(isLoading) {
    this.loading = isLoading;
    if (isLoading) {
      this.summary.dataset.loading = "true";
      this.summary.innerHTML = "";
      this.setStatus("Fetching recommendations...");
    } else {
      delete this.summary.dataset.loading;
    }
  }

  reset() {
    this.uniqueSlots.forEach((element) => {
      element.innerHTML = "";
    });
    this.updateContext({});
    this.summary.innerHTML = "";
  }

  updateContext(context) {
    const set = (key, value) => {
      const element = this.context[key];
      if (!element) {
        return;
      }
      element.textContent = value ?? "—";
    };

    const priceValue = Number.isFinite(context.price)
      ? `$${Number(context.price).toLocaleString(undefined, {
          maximumFractionDigits: 2,
        })}`
      : "—";
    const atrValue = Number.isFinite(context.atrPercent)
      ? `${Number(context.atrPercent).toFixed(2)}%`
      : "—";
    const volValue = Number.isFinite(context.volatility)
      ? `${Number(context.volatility).toFixed(1)}%`
      : "—";
    const sizeValue = Number.isFinite(context.positionSize)
      ? Number(context.positionSize).toLocaleString(undefined, {
          maximumFractionDigits: 4,
        })
      : "—";
    const notionalValue = Number.isFinite(context.notionalUsd)
      ? `$${Number(context.notionalUsd).toLocaleString(undefined, {
          maximumFractionDigits: 0,
        })}`
      : "—";
    const fundingValue = Number.isFinite(context.fundingRate)
      ? `${Number(context.fundingRate * 100).toFixed(2)}%`
      : "—";

    set("symbol", context.symbol ?? "—");
    set("price", priceValue);
    set("atr", atrValue);
    set("volatility", volValue);
    set("size", sizeValue);
    set("notional", notionalValue);
    set("funding", fundingValue);
  }

  async fetchHints() {
    const text = this.textarea.value.trim();
    if (!text) {
      return;
    }

    const payload = {
      text,
      features: getFeatureSnapshot(),
    };

    const currentId = ++this.requestId;
    this.setLoading(true);

    try {
      const response = await fetch("/api/hints", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const data = await response.json();
      if (currentId !== this.requestId) {
        return;
      }
      if (!response.ok) {
        const message = typeof data.error === "string" ? data.error : "Failed to load hints.";
        this.showError(message);
        return;
      }

      this.render(data);
      const hintCount = Array.isArray(data.hints) ? data.hints.length : 0;
      this.setStatus(hintCount > 0 ? "Recommendations updated." : "No actionable hints yet.");
    } catch (error) {
      if (currentId !== this.requestId) {
        return;
      }
      const message = error instanceof Error ? error.message : "Unknown error";
      this.showError(message);
    } finally {
      if (currentId === this.requestId) {
        this.setLoading(false);
      }
    }
  }

  render(payload) {
    this.uniqueSlots.forEach((element) => {
      element.innerHTML = "";
    });
    this.summary.innerHTML = "";

    const hints = Array.isArray(payload.hints) ? payload.hints : [];
    this.updateContext(payload.context ?? {});

    hints.forEach((hint) => {
      const slot = this.slots[hint.slot] ?? this.summary;
      const chip = this.createChip(hint);
      slot.appendChild(chip);
    });
  }

  showError(message) {
    this.uniqueSlots.forEach((element) => {
      element.innerHTML = "";
    });
    this.summary.innerHTML = "";
    this.updateContext({});
    const chip = this.createChip({
      badge: "Error",
      title: "Hints unavailable",
      message,
      severity: "warning",
      slot: "global",
    });
    this.summary.appendChild(chip);
    this.setStatus("Hints temporarily unavailable.");
  }

  createChip(hint) {
    const chip = document.createElement("div");
    chip.className = `hint-chip ${hint.severity ?? "info"}`;

    const badge = document.createElement("span");
    badge.className = "hint-badge";
    badge.textContent = hint.badge ?? "Hint";
    if (hint.tooltip) {
      badge.setAttribute("data-tooltip", hint.tooltip);
    }
    chip.appendChild(badge);

    const content = document.createElement("div");
    content.className = "hint-content";

    const title = document.createElement("p");
    title.className = "hint-title";
    title.textContent = hint.title ?? "Suggestion";
    content.appendChild(title);

    const text = document.createElement("p");
    text.className = "hint-text";
    text.textContent = hint.message ?? "";
    content.appendChild(text);

    chip.appendChild(content);

    if (hint.action && typeof this.onApply === "function") {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "hint-apply";
      button.textContent = hint.action.label ?? "Apply";
      button.addEventListener("click", () => {
        this.onApply(hint.action);
      });
      chip.appendChild(button);
    }

    return chip;
  }
}

Object.entries(toggleButtons).forEach(([feature, button]) => {
  if (!button) {
    return;
  }
  button.addEventListener("click", () => {
    const state = featureState[feature];
    const nextEnabled = !state.enabled;

    if (feature === "grid" && nextEnabled) {
      featureState.trailEntry.enabled = false;
      syncFeatureUI("trailEntry");
    } else if (feature === "trailEntry" && nextEnabled) {
      featureState.grid.enabled = false;
      syncFeatureUI("grid");
    }

    state.enabled = nextEnabled;
    syncFeatureUI(feature);

    if (nextEnabled) {
      const focusTarget =
        feature === "trailingStop"
          ? trailingStopValueInput
          : feature === "grid"
            ? gridLevelsInput
            : trailEntryLevelsInput;
      focusTarget?.focus();
    }

    updateSnippetPreview();
    hintManager?.scheduleRefresh();
  });
});

trailingStopValueInput.addEventListener("input", () => {
  featureState.trailingStop.value = parseFloatSafe(trailingStopValueInput.value);
  updateSnippetPreview();
  hintManager?.scheduleRefresh();
});

trailingStopUnitSelect.addEventListener("change", () => {
  featureState.trailingStop.unit = trailingStopUnitSelect.value;
  updateSnippetPreview();
  hintManager?.scheduleRefresh();
});

gridLevelsInput.addEventListener("input", () => {
  featureState.grid.levels = parseIntSafe(gridLevelsInput.value);
  updateSnippetPreview();
  hintManager?.scheduleRefresh();
});

gridSpacingValueInput.addEventListener("input", () => {
  featureState.grid.spacingValue = parseFloatSafe(gridSpacingValueInput.value);
  updateSnippetPreview();
  hintManager?.scheduleRefresh();
});

gridSpacingUnitSelect.addEventListener("change", () => {
  featureState.grid.unit = gridSpacingUnitSelect.value;
  updateSnippetPreview();
  hintManager?.scheduleRefresh();
});

trailEntryLevelsInput.addEventListener("input", () => {
  featureState.trailEntry.levels = parseIntSafe(trailEntryLevelsInput.value);
  updateSnippetPreview();
  hintManager?.scheduleRefresh();
});

trailEntryStepValueInput.addEventListener("input", () => {
  featureState.trailEntry.stepValue = parseFloatSafe(trailEntryStepValueInput.value);
  updateSnippetPreview();
  hintManager?.scheduleRefresh();
});

trailEntryStepUnitSelect.addEventListener("change", () => {
  featureState.trailEntry.unit = trailEntryStepUnitSelect.value;
  updateSnippetPreview();
  hintManager?.scheduleRefresh();
});

textarea.addEventListener("input", () => {
  hintManager?.scheduleRefresh();
  marketDashboard?.scheduleRefresh();
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const rawSignal = textarea.value.trim();
  if (!rawSignal) {
    statusMessage.className = "status-message error";
    statusMessage.textContent = "Signal text is required.";
    return;
  }

  const preview = updateSnippetPreview();
  const { segments, errors } = preview;
  if (errors.length > 0) {
    statusMessage.className = "status-message error";
    statusMessage.textContent = "Fix advanced settings before executing.";
    return;
  }

  const combinedSignal = appendFeatureSegments(rawSignal, segments);
  textarea.value = combinedSignal;
  marketDashboard?.scheduleRefresh();

  statusMessage.className = "status-message";
  statusMessage.textContent = "Executing signal...";
  parsedBlock.textContent = "(pending)";
  orderBlock.textContent = "(pending)";
  exchangeBlock.textContent = "(pending)";

  setBusy(true);

  try {
    const payload = await executeSignal(combinedSignal);
    const { demoMode, signal: parsed, payload: orderPayload, response } = payload;

    statusMessage.className = "status-message success";
    statusMessage.textContent = "Signal executed successfully.";
    statusMode.textContent = `Mode: ${demoMode ? "Demo (mocked clients)" : "Live Hyperliquid execution"}`;

    parsedBlock.textContent = JSON.stringify(parsed, null, 2);
    orderBlock.textContent = JSON.stringify(orderPayload, null, 2);
    exchangeBlock.textContent = JSON.stringify(response, null, 2);
    recordExecution({
      text: combinedSignal,
      timestamp: Date.now(),
      symbol: parsed.symbol ?? "N/A",
      mode: demoMode ? "demo" : "live",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    statusMessage.className = "status-message error";
    statusMessage.textContent = `Error: ${message}`;
    setModePlaceholder();
    parsedBlock.textContent = "(error)";
    orderBlock.textContent = "(error)";
    exchangeBlock.textContent = "(error)";
  } finally {
    setBusy(false);
  }
});

resetButton.addEventListener("click", () => {
  textarea.value = cachedDefaultSignal || "";
  textarea.focus();
  resetFeatures();
  setActiveSymbolChip("BTC");
  marketDashboard?.setSymbol("BTC");
  focusSignal(null, { refreshSnapshot: false });
  statusMessage.className = "status-message";
  statusMessage.textContent = "Ready when you are.";
  setModePlaceholder();
  parsedBlock.textContent = "(waiting)";
  orderBlock.textContent = "(waiting)";
  exchangeBlock.textContent = "(waiting)";
  hintManager?.scheduleRefresh();
});

sampleButton.addEventListener("click", () => {
  const sample = playbookSignals[0] ?? SIGNAL_LIBRARY[0];
  if (!sample) {
    textarea.focus();
    return;
  }
  focusSignal(sample.id, { load: true });
});

initializeTheme();

marketDashboard =
  chartSnapshotImage
    ? initializeMarketDashboard({
        snapshotImage: chartSnapshotImage,
        snapshotCaption,
        signalProvider: () => textarea.value,
        metrics: {
          symbol: marketSymbol,
          mid: marketMid,
          spread: marketSpread,
          volatility: marketVolatility,
          funding: marketFunding,
          volume: marketVolume,
          updated: marketUpdated,
          modeBadge: marketModeBadge,
        },
        theme: body.dataset.theme,
        initialSymbol: "BTC",
        snapshotOptions: {
          interval: snapshotIntervalSelect?.value ?? "1h",
          range: snapshotRangeSelect?.value ?? "1d",
        },
      })
    : null;

if (marketDashboard) {
  marketDashboard.preloadSymbols(["BTC", "ETH"]);
  applyRefreshState(refreshState, { persist: false });
}

hintManager = new HintManager({
  textarea,
  summary: hintSummary,
  status: hintStatus,
  slots: hintSlotElements,
  context: hintContextElements,
  onApply: applyHintAction,
});

resetFeatures();
fetchDefaultSignal();
