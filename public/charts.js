const REFRESH_INTERVAL_MS = 20000;
const RETRY_INTERVAL_MS = 8000;

const currencyFormatter = new Intl.NumberFormat(undefined, {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

const compactFormatter = new Intl.NumberFormat(undefined, {
  notation: "compact",
  maximumFractionDigits: 2,
});

const layerColorMap = {
  dark: {
    entry: "#38bdf8",
    tp: "#22c55e",
    sl: "#f87171",
    candleUp: "#22c55e",
    candleDown: "#ef4444",
    text: "#e2e8f0",
    grid: "rgba(148, 163, 184, 0.12)",
  },
  light: {
    entry: "#1d4ed8",
    tp: "#16a34a",
    sl: "#dc2626",
    candleUp: "#16a34a",
    candleDown: "#dc2626",
    text: "#1e293b",
    grid: "rgba(148, 163, 184, 0.25)",
  },
};

const TEXT_PLACEHOLDER = "—";

function formatCurrency(value) {
  if (!Number.isFinite(value)) {
    return TEXT_PLACEHOLDER;
  }
  return currencyFormatter.format(value);
}

function formatSpread(usd, bps) {
  if (!Number.isFinite(usd) || !Number.isFinite(bps)) {
    return TEXT_PLACEHOLDER;
  }
  const formattedUsd = currencyFormatter.format(usd);
  return `${formattedUsd} (${bps.toFixed(1)} bps)`;
}

function formatPercent(value) {
  if (!Number.isFinite(value)) {
    return TEXT_PLACEHOLDER;
  }
  return `${value.toFixed(2)}%`;
}

function formatFunding(value) {
  if (!Number.isFinite(value)) {
    return TEXT_PLACEHOLDER;
  }
  return `${(value * 100).toFixed(3)}%`;
}

function formatVolume(value) {
  if (!Number.isFinite(value)) {
    return TEXT_PLACEHOLDER;
  }
  return compactFormatter.format(value);
}

function resolveTheme(theme) {
  return theme === "light" ? "light" : "dark";
}

export function initializeMarketDashboard(options) {
  const chartElement = options?.chartElement;
  const heatmapElement = options?.heatmapElement;
  const layerListElement = options?.layerListElement;
  const metrics = options?.metrics ?? {};
  const volatilityHintElement = options?.volatilityHintElement;
  const signalProvider = options?.signalProvider ?? (() => "");

  if (!chartElement || !heatmapElement || !layerListElement) {
    return null;
  }

  const chartLibrary = window.LightweightCharts;
  if (!chartLibrary) {
    console.warn("LightweightCharts library is not loaded. Market dashboard disabled.");
    return null;
  }

  let currentTheme = resolveTheme(options?.theme);
  let currentSymbol = options?.initialSymbol ?? "BTC";
  let refreshHandle = null;
  let pending = false;
  let priceLines = [];
  let cachedLayers = null;
  let destroyed = false;
  const snapshotCache = new Map();

  const chart = chartLibrary.createChart(chartElement, {
    width: chartElement.clientWidth,
    height: chartElement.clientHeight,
    layout: { background: { color: "transparent" }, textColor: layerColorMap[currentTheme].text },
    rightPriceScale: { borderVisible: false },
    timeScale: { borderVisible: false },
    crosshair: { mode: chartLibrary.CrosshairMode.Normal },
    grid: {
      horzLines: { color: layerColorMap[currentTheme].grid },
      vertLines: { color: layerColorMap[currentTheme].grid },
    },
  });

  const candleSeries = chart.addCandlestickSeries({
    priceScaleId: "right",
    upColor: layerColorMap[currentTheme].candleUp,
    borderUpColor: layerColorMap[currentTheme].candleUp,
    wickUpColor: layerColorMap[currentTheme].candleUp,
    downColor: layerColorMap[currentTheme].candleDown,
    borderDownColor: layerColorMap[currentTheme].candleDown,
    wickDownColor: layerColorMap[currentTheme].candleDown,
    priceFormat: { type: "price", precision: 2, minMove: 0.01 },
  });

  function applyTheme(theme) {
    currentTheme = resolveTheme(theme);
    const palette = layerColorMap[currentTheme];
    chart.applyOptions({
      layout: { background: { color: "transparent" }, textColor: palette.text },
      grid: {
        horzLines: { color: palette.grid },
        vertLines: { color: palette.grid },
      },
    });
    candleSeries.applyOptions({
      upColor: palette.candleUp,
      borderUpColor: palette.candleUp,
      wickUpColor: palette.candleUp,
      downColor: palette.candleDown,
      borderDownColor: palette.candleDown,
      wickDownColor: palette.candleDown,
    });
    renderLayers(cachedLayers);
  }

function updateMetrics(snapshot) {
  if (metrics.symbol) {
    metrics.symbol.textContent = snapshot?.symbol ?? TEXT_PLACEHOLDER;
  }
    if (metrics.mid) {
      metrics.mid.textContent = formatCurrency(snapshot?.midPrice);
    }
    if (metrics.spread) {
      metrics.spread.textContent = formatSpread(snapshot?.spreadUsd, snapshot?.spreadBps);
    }
    if (metrics.volatility) {
      metrics.volatility.textContent = formatPercent(snapshot?.volatilityPercent);
    }
    if (metrics.funding) {
      metrics.funding.textContent = formatFunding(snapshot?.fundingRate);
    }
    if (metrics.volume) {
      metrics.volume.textContent = formatVolume(snapshot?.dayBaseVolume);
    }
  if (metrics.updated) {
    const timestamp = snapshot?.timestamp;
    metrics.updated.textContent = timestamp
      ? new Date(timestamp).toLocaleTimeString()
      : TEXT_PLACEHOLDER;
  }
  if (metrics.modeBadge) {
      const demoMode = Boolean(snapshot?.demoMode);
      metrics.modeBadge.textContent = demoMode ? "Demo data" : "Live data";
      metrics.modeBadge.classList.toggle("badge--demo", demoMode);
      metrics.modeBadge.classList.toggle("badge--live", !demoMode);
    }
  if (volatilityHintElement) {
    volatilityHintElement.textContent = snapshot?.volatilityHint ?? TEXT_PLACEHOLDER;
  }
}

  function clearPriceLines() {
    priceLines.forEach((line) => {
      candleSeries.removePriceLine(line);
    });
    priceLines = [];
  }

  function renderLayers(layers) {
    cachedLayers = layers ?? null;
    clearPriceLines();
    layerListElement.innerHTML = "";
    if (!layers) {
      return;
    }

    const palette = layerColorMap[currentTheme];

    const addLayer = (price, type, title) => {
      if (!(price > 0)) {
        return;
      }
      const color = type === "entry" ? palette.entry : type === "tp" ? palette.tp : palette.sl;
      const priceLine = candleSeries.createPriceLine({
        price,
        color,
        lineWidth: 2,
        axisLabelVisible: true,
        title,
      });
      priceLines.push(priceLine);

      const item = document.createElement("li");
      const label = document.createElement("span");
      label.className = "layer-summary__label";
      label.dataset.layer = type;
      label.textContent = title;

      const value = document.createElement("span");
      value.textContent = formatCurrency(price);

      item.append(label, value);
      layerListElement.appendChild(item);
    };

    (layers.entries ?? []).forEach((price, index) => {
      addLayer(price, "entry", `Entry ${index + 1}`);
    });
    (layers.takeProfits ?? []).forEach((price, index) => {
      addLayer(price, "tp", `TP ${index + 1}`);
    });
    (layers.stopLosses ?? []).forEach((price, index) => {
      addLayer(price, "sl", index === 0 ? "Stop" : `Stop ${index + 1}`);
    });
  }

  function renderHeatmap(buckets) {
    heatmapElement.innerHTML = "";
    if (!Array.isArray(buckets) || buckets.length === 0) {
      const empty = document.createElement("p");
      empty.className = "volatility-hint";
      empty.textContent = "No volume distribution available.";
      heatmapElement.appendChild(empty);
      return;
    }

    const maxVolume = Math.max(...buckets.map((bucket) => bucket.volume || 0), 0.0001);

    buckets.forEach((bucket) => {
      const cell = document.createElement("div");
      cell.className = "heatmap-cell";
      const intensity = Math.max(0.15, Math.min(1, (bucket.volume ?? 0) / maxVolume));
      cell.style.setProperty("--intensity", intensity.toFixed(2));

      const priceSpan = document.createElement("span");
      priceSpan.textContent = formatCurrency(bucket.price);
      const volumeStrong = document.createElement("strong");
      volumeStrong.textContent = formatVolume(bucket.volume);

      cell.append(priceSpan, volumeStrong);
      heatmapElement.appendChild(cell);
    });
  }

function applySnapshot(snapshot) {
    if (!snapshot) {
      return;
    }
    const normalized = (snapshot.normalizedSymbol ?? currentSymbol ?? "").toUpperCase();
    if (normalized) {
      currentSymbol = normalized;
      snapshotCache.set(normalized, snapshot);
    }
    candleSeries.setData(Array.isArray(snapshot.candles) ? snapshot.candles : []);
    updateMetrics(snapshot);
    renderHeatmap(snapshot.volumeDistribution ?? []);
    renderLayers(snapshot.layers);
  }

  async function fetchSymbolSnapshot(symbol) {
    const resolvedSymbol = (symbol ?? currentSymbol ?? "BTC").toUpperCase();
    const signal = signalProvider()?.trim();
    const payload = { symbol: resolvedSymbol };
    if (signal) {
      payload.signal = signal;
    }
    const response = await fetch("/api/market-data", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(typeof data?.error === "string" ? data.error : "Request failed");
    }
    const cacheKey = (data.normalizedSymbol ?? resolvedSymbol).toUpperCase();
    snapshotCache.set(cacheKey, data);
    return data;
  }

  async function fetchSnapshot(immediate = false, symbolOverride) {
    if (pending || destroyed) {
      return;
    }
    pending = true;
    try {
      const targetSymbol = (symbolOverride ?? currentSymbol ?? options?.initialSymbol ?? "BTC").toUpperCase();
      const snapshot = await fetchSymbolSnapshot(targetSymbol);
      currentSymbol = (snapshot.normalizedSymbol ?? targetSymbol).toUpperCase();
      applySnapshot(snapshot);
      scheduleRefresh(REFRESH_INTERVAL_MS);
    } catch (error) {
      console.error("Failed to load market data", error);
      if (metrics.updated) {
        metrics.updated.textContent = "error";
      }
      scheduleRefresh(immediate ? RETRY_INTERVAL_MS : Math.min(RETRY_INTERVAL_MS, REFRESH_INTERVAL_MS));
    } finally {
      pending = false;
    }
  }

  function scheduleRefresh(delay) {
    if (destroyed) {
      return;
    }
    if (refreshHandle) {
      window.clearTimeout(refreshHandle);
    }
    refreshHandle = window.setTimeout(() => {
      fetchSnapshot();
    }, delay);
  }

  function handleResize() {
    if (destroyed) {
      return;
    }
    const { clientWidth, clientHeight } = chartElement;
    chart.resize(clientWidth, clientHeight);
  }

  window.addEventListener("resize", handleResize);

  fetchSnapshot(true);

  return {
    setTheme(theme) {
      applyTheme(theme);
    },
    scheduleRefresh() {
      fetchSnapshot(true);
    },
    setSymbol(symbol) {
      const normalized = typeof symbol === "string" ? symbol.trim().toUpperCase() : "";
      if (!normalized) {
        return;
      }
      currentSymbol = normalized;
      const cached = snapshotCache.get(normalized);
      if (cached) {
        applySnapshot(cached);
      }
      fetchSnapshot(true, normalized);
    },
    async preloadSymbols(symbols) {
      const list = Array.isArray(symbols) ? symbols : [];
      for (const raw of list) {
        const normalized = typeof raw === "string" ? raw.trim().toUpperCase() : "";
        if (!normalized || snapshotCache.has(normalized)) {
          continue;
        }
        try {
          await fetchSymbolSnapshot(normalized);
        } catch (error) {
          console.warn("Failed to preload market snapshot", normalized, error);
        }
      }
    },
    destroy() {
      destroyed = true;
      if (refreshHandle) {
        window.clearTimeout(refreshHandle);
      }
      window.removeEventListener("resize", handleResize);
      chart.remove();
    },
  };
}
