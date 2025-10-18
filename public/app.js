const MODE_PLACEHOLDER = "Mode: —";

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

function createDefaultFeatureState() {
  return {
    trailingStop: { enabled: false, value: 0.5, unit: "percent" },
    grid: { enabled: false, levels: 3, spacingValue: 150, unit: "absolute" },
    trailEntry: { enabled: false, levels: 4, stepValue: 0.25, unit: "percent" },
  };
}

const featureState = createDefaultFeatureState();

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
}

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
  });
});

trailingStopValueInput.addEventListener("input", () => {
  featureState.trailingStop.value = parseFloatSafe(trailingStopValueInput.value);
  updateSnippetPreview();
});

trailingStopUnitSelect.addEventListener("change", () => {
  featureState.trailingStop.unit = trailingStopUnitSelect.value;
  updateSnippetPreview();
});

gridLevelsInput.addEventListener("input", () => {
  featureState.grid.levels = parseIntSafe(gridLevelsInput.value);
  updateSnippetPreview();
});

gridSpacingValueInput.addEventListener("input", () => {
  featureState.grid.spacingValue = parseFloatSafe(gridSpacingValueInput.value);
  updateSnippetPreview();
});

gridSpacingUnitSelect.addEventListener("change", () => {
  featureState.grid.unit = gridSpacingUnitSelect.value;
  updateSnippetPreview();
});

trailEntryLevelsInput.addEventListener("input", () => {
  featureState.trailEntry.levels = parseIntSafe(trailEntryLevelsInput.value);
  updateSnippetPreview();
});

trailEntryStepValueInput.addEventListener("input", () => {
  featureState.trailEntry.stepValue = parseFloatSafe(trailEntryStepValueInput.value);
  updateSnippetPreview();
});

trailEntryStepUnitSelect.addEventListener("change", () => {
  featureState.trailEntry.unit = trailEntryStepUnitSelect.value;
  updateSnippetPreview();
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
  statusMessage.className = "status-message";
  statusMessage.textContent = "Ready when you are.";
  setModePlaceholder();
  parsedBlock.textContent = "(waiting)";
  orderBlock.textContent = "(waiting)";
  exchangeBlock.textContent = "(waiting)";
});

sampleButton.addEventListener("click", () => {
  textarea.value =
    "Long BTC 3 entry 60000 stop 58500 tp1 62500 tp2 63500 trailing stop 0.4% grid 3 150";
  featureState.trailingStop.enabled = true;
  featureState.trailingStop.value = 0.4;
  featureState.trailingStop.unit = "percent";
  featureState.grid.enabled = true;
  featureState.grid.levels = 3;
  featureState.grid.spacingValue = 150;
  featureState.grid.unit = "absolute";
  featureState.trailEntry.enabled = false;
  applyStateToInputs();
  updateAllFeatureUI();
  updateSnippetPreview();
  textarea.focus();
});

resetFeatures();
fetchDefaultSignal();
