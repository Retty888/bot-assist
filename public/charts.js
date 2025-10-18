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

function buildSnapshotUrl(symbol, options) {
  const baseSymbol = (symbol ?? "BTC").toUpperCase();
  const interval = options?.interval ?? "1h";
  const range = options?.range ?? "1d";
  const theme = resolveTheme(options?.theme);
  const normalizedSymbol = baseSymbol.includes(":") ? baseSymbol : `BINANCE:${baseSymbol}USDT`;
  const params = new URLSearchParams({
    symbol: normalizedSymbol,
    interval,
    range,
    theme,
    format: "png",
    width: "900",
    height: "480",
    nocache: Date.now().toString(),
  });
  return `https://quickchart.io/finance/chart?${params.toString()}`;
}

export function initializeMarketDashboard(options = {}) {
  const snapshotImage = options.snapshotImage instanceof HTMLImageElement ? options.snapshotImage : null;
  const metrics = options.metrics ?? {};
  const signalProvider = typeof options.signalProvider === "function" ? options.signalProvider : () => "";

  let snapshotOptions = {
    interval: options.snapshotOptions?.interval ?? "1h",
    range: options.snapshotOptions?.range ?? "1d",
  };

  let currentTheme = resolveTheme(options.theme);
  let currentSymbol = (options.initialSymbol ?? "BTC").toUpperCase();
  let autoRefreshEnabled = options.autoRefresh ?? true;
  let refreshIntervalMs = options.refreshIntervalMs ?? REFRESH_INTERVAL_MS;
  let refreshHandle = null;
  let pending = false;
  let destroyed = false;
  const snapshotCache = new Map();

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
      metrics.updated.textContent = timestamp ? new Date(timestamp).toLocaleTimeString() : TEXT_PLACEHOLDER;
    }
    if (metrics.modeBadge) {
      const demoMode = Boolean(snapshot?.demoMode);
      metrics.modeBadge.textContent = demoMode ? "Demo data" : "Live data";
      metrics.modeBadge.classList.toggle("badge--demo", demoMode);
      metrics.modeBadge.classList.toggle("badge--live", !demoMode);
    }
  }

  function updateSnapshotImage(symbol, { force = false } = {}) {
    if (!snapshotImage) {
      return;
    }
    const url = buildSnapshotUrl(symbol ?? currentSymbol, {
      interval: snapshotOptions.interval,
      range: snapshotOptions.range,
      theme: currentTheme,
    });
    if (!force && snapshotImage.src === url) {
      return;
    }
    snapshotImage.src = url;
    snapshotImage.alt = `Market snapshot for ${symbol ?? currentSymbol} (${snapshotOptions.interval})`;
  }

  async function fetchSymbolSnapshot(symbol) {
    const resolvedSymbol = (symbol ?? currentSymbol ?? "BTC").toUpperCase();
    const payload = { symbol: resolvedSymbol, interval: snapshotOptions.interval, range: snapshotOptions.range };
    const signal = signalProvider()?.trim();
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

  function scheduleRefresh(delay = refreshIntervalMs) {
    if (destroyed || !autoRefreshEnabled) {
      return;
    }
    if (refreshHandle) {
      window.clearTimeout(refreshHandle);
    }
    refreshHandle = window.setTimeout(() => {
      void refresh();
    }, delay);
  }

  async function refresh(symbolOverride, { immediate = false } = {}) {
    if (pending || destroyed) {
      return;
    }
    pending = true;
    try {
      const targetSymbol = (symbolOverride ?? currentSymbol ?? "BTC").toUpperCase();
      const snapshot = await fetchSymbolSnapshot(targetSymbol);
      currentSymbol = (snapshot.normalizedSymbol ?? targetSymbol).toUpperCase();
      updateMetrics(snapshot);
      updateSnapshotImage(currentSymbol, { force: true });
      scheduleRefresh(refreshIntervalMs);
    } catch (error) {
      console.error("Failed to load market data", error);
      if (metrics.updated) {
        metrics.updated.textContent = "error";
      }
      if (autoRefreshEnabled) {
        const retryDelay = immediate ? RETRY_INTERVAL_MS : Math.min(RETRY_INTERVAL_MS, refreshIntervalMs);
        scheduleRefresh(retryDelay);
      }
    } finally {
      pending = false;
    }
  }

  void refresh(currentSymbol, { immediate: true });

  return {
    setTheme(theme) {
      currentTheme = resolveTheme(theme);
      updateSnapshotImage(currentSymbol, { force: true });
    },
    scheduleRefresh() {
      void refresh(currentSymbol, { immediate: true });
    },
    setSymbol(symbol) {
      const normalized = typeof symbol === "string" ? symbol.trim().toUpperCase() : "";
      if (!normalized) {
        return;
      }
      currentSymbol = normalized;
      const cached = snapshotCache.get(normalized);
      if (cached) {
        updateMetrics(cached);
        updateSnapshotImage(normalized, { force: true });
      }
      void refresh(normalized, { immediate: true });
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
    setRefreshOptions({ enabled, intervalMs }) {
      autoRefreshEnabled = enabled ?? autoRefreshEnabled;
      if (Number.isFinite(intervalMs) && intervalMs >= 3000) {
        refreshIntervalMs = intervalMs;
      }
      if (autoRefreshEnabled) {
        scheduleRefresh(refreshIntervalMs);
      } else if (refreshHandle) {
        window.clearTimeout(refreshHandle);
        refreshHandle = null;
      }
    },
    triggerRefresh(symbol) {
      void refresh(symbol ?? currentSymbol, { immediate: true });
    },
    setSnapshotOptions(options) {
      const next = { ...snapshotOptions };
      if (options?.interval) {
        next.interval = options.interval;
      }
      if (options?.range) {
        next.range = options.range;
      }
      snapshotOptions = next;
      updateSnapshotImage(currentSymbol, { force: true });
    },
    captureSnapshot({ symbol, force = true } = {}) {
      if (force) {
        void refresh(symbol ?? currentSymbol, { immediate: true });
      } else {
        updateSnapshotImage(symbol ?? currentSymbol, { force: true });
      }
    },
    destroy() {
      destroyed = true;
      if (refreshHandle) {
        window.clearTimeout(refreshHandle);
      }
    },
  };
}
