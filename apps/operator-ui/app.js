const summaryList = document.querySelector('#summary-list');
const trackerList = document.querySelector('#tracker-list');
const orderList = document.querySelector('#order-list');
const connectionPill = document.querySelector('#connection-pill');
const helpPanel = document.querySelector('#help-panel');
const orderFilter = document.querySelector('#order-filter');
const analyticsHistoryBody = document.querySelector('#analytics-history-body');
const analyticsRefresh = document.querySelector('#analytics-refresh');
const pnlCanvas = document.querySelector('#pnl-chart');
const statDailyPnl = document.querySelector('#stat-daily-pnl');
const statWinrate = document.querySelector('#stat-winrate');
const statLeverage = document.querySelector('#stat-leverage');

let currentOrders = [];

function formatNumber(value, digits = 2) {
  if (!Number.isFinite(value)) return '—';
  return Number(value).toFixed(digits).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
}

function formatUsd(value) {
  if (!Number.isFinite(value)) return '—';
  const formatter = value >= 1_000 ? Math.round : (x) => Number(x).toFixed(2);
  const formatted = formatter(Math.abs(value));
  const sign = value > 0 ? '+' : value < 0 ? '−' : '';
  return `${sign}$${formatted}`;
}

function formatPercent(value) {
  if (!Number.isFinite(value)) return '—';
  return `${formatNumber(value * 100)}%`;
}

function formatTime(isoOrMillis) {
  const date = new Date(isoOrMillis);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

function statusFromExecution(status) {
  if (status === 'fulfilled') return { label: 'Исполнено', level: 'ok' };
  if (status === 'partial') return { label: 'Частично', level: 'warning' };
  if (status === 'blocked') return { label: 'Заблокировано', level: 'critical' };
  if (status === 'rejected' || status === 'error') return { label: 'Ошибка', level: 'critical' };
  return { label: 'Неизвестно', level: 'warning' };
}

function determineConnectionStatus(lastExecution) {
  if (!lastExecution) {
    return { online: false, label: 'Нет данных' };
  }
  const delta = Date.now() - lastExecution.timestamp;
  if (delta > 5 * 60 * 1000) {
    return { online: false, label: 'Нет недавних исполнений' };
  }
  if (lastExecution.status === 'error' || lastExecution.status === 'rejected') {
    return { online: false, label: 'Последняя заявка с ошибкой' };
  }
  return { online: true, label: 'API подключено' };
}

function buildSummary(metrics, risk) {
  const lastExecution = metrics?.lastExecution;
  const connection = determineConnectionStatus(lastExecution);
  const daily = metrics?.daily ?? { trades: 0, pnlUsd: 0, blocked: 0 };
  const limits = risk?.limits ?? {};
  const items = [
    {
      label: 'Биржевое соединение',
      value: connection.online ? 'В сети' : 'Сбой',
      level: connection.online ? 'ok' : 'critical',
      description: connection.label,
    },
    {
      label: 'PnL (24ч)',
      value: formatUsd(daily.pnlUsd ?? 0),
      level: daily.pnlUsd >= 0 ? 'ok' : 'warning',
      description: `Сделок за сутки: ${daily.trades ?? 0}`,
    },
    {
      label: 'Risk guard',
      value: limits.dailyTradeCountLimit
        ? `${daily.blocked ?? 0} блок.`
        : `${daily.blocked ?? 0}`,
      level: daily.blocked > 0 ? 'warning' : 'ok',
      description: limits.dailyTradeCountLimit
        ? `Лимит ${limits.dailyTradeCountLimit} сделок/сутки`
        : 'Ограничения по умолчанию',
    },
  ];
  return items;
}

function renderList(target, items, renderer) {
  target.innerHTML = '';
  const fragment = document.createDocumentFragment();
  items.forEach((item) => fragment.appendChild(renderer(item)));
  target.appendChild(fragment);
}

function createStatusDot(level) {
  const dot = document.createElement('span');
  dot.classList.add('status-dot');
  if (level === 'warning') dot.classList.add('warning');
  if (level === 'critical') dot.classList.add('critical');
  return dot;
}

function createBadge(level) {
  const badge = document.createElement('span');
  badge.classList.add('badge');
  if (level === 'ok') badge.classList.add('badge--success');
  if (level === 'warning') badge.classList.add('badge--warning');
  if (level === 'critical') badge.classList.add('badge--critical');
  return badge;
}

function renderSummary(metrics, risk) {
  const items = buildSummary(metrics, risk);
  renderList(summaryList, items, (item) => {
    const li = document.createElement('li');
    li.dataset.level = item.level;
    const meta = document.createElement('div');
    meta.classList.add('order-description');
    meta.innerHTML = `<strong>${item.label}</strong><br /><span>${item.description}</span>`;
    const value = document.createElement('div');
    value.classList.add('order-meta');
    value.append(createStatusDot(item.level));
    value.append(item.value);
    li.append(meta, value);
    return li;
  });
}

function renderTrackers(metrics, risk) {
  const daily = metrics?.daily ?? {};
  const totals = metrics?.totals ?? {};
  const limits = risk?.limits ?? {};
  const items = [
    {
      name: 'Сделки за сутки',
      status: `${daily.trades ?? 0} / ${limits.dailyTradeCountLimit ?? '∞'}`,
      level: daily.trades >= (limits.dailyTradeCountLimit ?? Infinity) ? 'warning' : 'ok',
      nextEvent: 'Обновление лимита в 00:00',
    },
    {
      name: 'Совокупный риск',
      status: formatUsd(daily.lossUsd ?? 0),
      level: (daily.lossUsd ?? 0) > (limits.dailyLossLimitUsd ?? Infinity) ? 'critical' : 'ok',
      nextEvent: `Лимит: ${limits.dailyLossLimitUsd ? formatUsd(limits.dailyLossLimitUsd) : '—'}`,
    },
    {
      name: 'Средний леверидж',
      status: `${formatNumber(totals.averageLeverage ?? 0, 2)}x`,
      level:
        totals.maxLeverage && limits.maxLeverage && totals.maxLeverage > limits.maxLeverage
          ? 'critical'
          : 'ok',
      nextEvent: `Пик: ${formatNumber(totals.maxLeverage ?? 0, 2)}x / Лимит ${limits.maxLeverage ?? '—'}x`,
    },
  ];
  renderList(trackerList, items, (item) => {
    const li = document.createElement('li');
    li.dataset.level = item.level;
    const meta = document.createElement('div');
    meta.classList.add('order-description');
    meta.innerHTML = `<strong>${item.name}</strong><br /><span>${item.nextEvent}</span>`;
    const badge = createBadge(item.level);
    badge.textContent = item.status;
    li.append(meta, badge);
    return li;
  });
}

function renderOrderList(items) {
  renderList(orderList, items, (item) => {
    const li = document.createElement('li');
    li.dataset.level = item.level;
    const description = document.createElement('div');
    description.classList.add('order-description');
    description.innerHTML = `<strong>${item.id}</strong><br /><span>${item.description}</span>`;
    const meta = document.createElement('div');
    meta.classList.add('order-meta');
    const badge = createBadge(item.level);
    badge.textContent = item.label;
    const time = document.createElement('time');
    time.dateTime = new Date(item.timestamp).toISOString();
    time.textContent = formatTime(item.timestamp);
    const actionButton = document.createElement('button');
    actionButton.classList.add('ghost');
    actionButton.textContent = 'Детали';
    actionButton.addEventListener('click', () => {
      window.alert(`Детали сделки ${item.id}:\n${JSON.stringify(item.details, null, 2)}`);
    });
    meta.append(badge, time, actionButton);
    li.append(description, meta);
    return li;
  });
}

function renderOrders(historyItems) {
  currentOrders = historyItems.map((record) => {
    const status = statusFromExecution(record.status);
    return {
      id: record.id,
      timestamp: record.timestamp,
      level: status.level,
      label: status.label,
      description: `${record.signal.symbol} ${record.signal.side.toUpperCase()} • ${formatUsd(record.notionalUsd ?? 0)}`,
      status: record.status,
      details: {
        mode: record.mode,
        pnl: record.estimatedPnlUsd,
        leverage: record.leverage,
      },
    };
  });
  applyOrderFilter();
}

function applyOrderFilter() {
  const value = orderFilter?.value ?? 'all';
  const filtered = currentOrders.filter((item) => {
    if (value === 'all') return true;
    if (value === 'active') return item.level === 'ok';
    return item.level !== 'ok';
  });
  renderOrderList(filtered.slice(0, 8));
}

function renderAnalytics(metrics, historyItems) {
  const daily = metrics?.daily ?? {};
  const totals = metrics?.totals ?? {};
  statDailyPnl.textContent = formatUsd(daily.pnlUsd ?? 0);
  statWinrate.textContent = formatPercent(totals.winRate ?? 0);
  statLeverage.textContent = `${formatNumber(totals.averageLeverage ?? 0, 2)}x / ${formatNumber(
    totals.maxLeverage ?? 0,
    2,
  )}x`;

  drawPnlChart(pnlCanvas, historyItems);
  renderAnalyticsHistory(historyItems);
}

function renderAnalyticsHistory(historyItems) {
  analyticsHistoryBody.innerHTML = '';
  const rows = historyItems.slice(0, 12);
  rows.forEach((record) => {
    const tr = document.createElement('tr');
    const status = statusFromExecution(record.status);
    const pnl = Number.isFinite(record.estimatedPnlUsd)
      ? formatUsd(record.estimatedPnlUsd ?? 0)
      : '—';
    tr.innerHTML = `
      <td>${formatTime(record.timestamp)}</td>
      <td>${record.signal.symbol}</td>
      <td>${status.label}</td>
      <td>${pnl}</td>
      <td>${record.leverage ? formatNumber(record.leverage, 2) + 'x' : '—'}</td>
    `;
    tr.dataset.level = status.level;
    analyticsHistoryBody.appendChild(tr);
  });
}

function drawPnlChart(canvas, historyItems) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const width = canvas.width;
  const height = canvas.height;
  ctx.clearRect(0, 0, width, height);

  if (!historyItems.length) {
    ctx.fillStyle = 'rgba(148,163,184,0.7)';
    ctx.font = '16px Inter, sans-serif';
    ctx.fillText('Недостаточно данных для визуализации', 20, height / 2);
    return;
  }

  const data = historyItems
    .slice()
    .reverse()
    .map((record, index) => ({
      index,
      timestamp: record.timestamp,
      pnl: record.estimatedPnlUsd ?? 0,
    }));
  let cumulative = 0;
  const points = data.map((item) => {
    cumulative += item.pnl;
    return { ...item, cumulative };
  });
  const min = Math.min(...points.map((point) => point.cumulative), 0);
  const max = Math.max(...points.map((point) => point.cumulative), 0.0001);
  const range = max - min || 1;

  const areaPath = new Path2D();
  points.forEach((point, idx) => {
    const x = (idx / Math.max(points.length - 1, 1)) * (width - 40) + 20;
    const y = height - ((point.cumulative - min) / range) * (height - 40) - 20;
    if (idx === 0) {
      areaPath.moveTo(x, y);
    } else {
      areaPath.lineTo(x, y);
    }
  });
  areaPath.lineTo(width - 20, height - 20);
  areaPath.lineTo(20, height - 20);
  areaPath.closePath();
  ctx.fillStyle = 'rgba(56, 189, 248, 0.15)';
  ctx.fill(areaPath);

  ctx.beginPath();
  points.forEach((point, idx) => {
    const x = (idx / Math.max(points.length - 1, 1)) * (width - 40) + 20;
    const y = height - ((point.cumulative - min) / range) * (height - 40) - 20;
    if (idx === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  });
  ctx.strokeStyle = 'rgba(56, 189, 248, 0.8)';
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.strokeStyle = 'rgba(148,163,184,0.4)';
  ctx.lineWidth = 1;
  ctx.strokeRect(20, 20, width - 40, height - 40);

  ctx.fillStyle = 'rgba(148,163,184,0.7)';
  ctx.font = '12px Inter, sans-serif';
  ctx.fillText(formatUsd(max), 22, 32);
  ctx.fillText(formatUsd(min), 22, height - 10);
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }
  return response.json();
}

async function refreshDashboard({ silent = false } = {}) {
  try {
    const [metricsResponse, historyResponse] = await Promise.all([
      fetchJson('/api/metrics'),
      fetchJson('/api/history?limit=50'),
    ]);
    renderSummary(metricsResponse.metrics, metricsResponse.risk);
    renderTrackers(metricsResponse.metrics, metricsResponse.risk);
    renderOrders(historyResponse.items ?? []);
    renderAnalytics(metricsResponse.metrics, historyResponse.items ?? []);

    const connection = determineConnectionStatus(metricsResponse.metrics?.lastExecution);
    if (connection.online) {
      connectionPill.textContent = 'API подключено';
      connectionPill.classList.add('pill-online');
      connectionPill.classList.remove('pill-offline', 'pill-danger');
    } else {
      connectionPill.textContent = connection.label;
      connectionPill.classList.remove('pill-online');
      connectionPill.classList.add('pill-offline', 'pill-danger');
    }
  } catch (error) {
    if (!silent) {
      window.alert(`Не удалось загрузить метрики: ${error instanceof Error ? error.message : error}`);
    }
    console.error('Failed to refresh dashboard', error);
  }
}

if (orderFilter) {
  orderFilter.addEventListener('change', () => {
    applyOrderFilter();
  });
}

if (analyticsRefresh) {
  analyticsRefresh.addEventListener('click', () => {
    void refreshDashboard();
  });
}

void refreshDashboard();
setInterval(() => {
  void refreshDashboard({ silent: true });
}, 30_000);

const form = document.querySelector('#signal-form');
form.addEventListener('submit', (event) => {
  event.preventDefault();
  const formData = new FormData(form);
  const payload = Object.fromEntries(formData.entries());
  window.alert(`Сигнал отправлен: ${JSON.stringify(payload, null, 2)}`);
  form.reset();
});

form.querySelector('[data-action="save-draft"]').addEventListener('click', () => {
  const formData = new FormData(form);
  const payload = Object.fromEntries(formData.entries());
  window.alert(`Черновик сохранён:\n${JSON.stringify(payload, null, 2)}`);
});

const toggleButtons = document.querySelectorAll('.toggle');
toggleButtons.forEach((button) => {
  button.addEventListener('click', () => {
    const targetId = button.dataset.target;
    const target = document.querySelector(`#${targetId}`);
    if (!target) return;
    target.hidden = !target.hidden;
    button.textContent = target.hidden ? 'Раскрыть доп. опции' : 'Свернуть доп. опции';
  });
});

const quickActions = document.querySelectorAll('.quick-actions button');
quickActions.forEach((button) => {
  button.addEventListener('click', () => {
    const action = button.dataset.action;
    window.alert(`Действие выполнено: ${action}`);
  });
});

connectionPill.addEventListener('click', () => {
  connectionPill.classList.toggle('pill-offline');
  connectionPill.classList.toggle('pill-danger');
  const offline = connectionPill.classList.contains('pill-offline');
  connectionPill.textContent = offline ? 'API недоступно' : 'API подключено';
  connectionPill.classList.toggle('pill-online', !offline);
});

const helpTrigger = document.querySelector('[data-action="open-help"]');
const helpClose = document.querySelector('[data-action="close-help"]');

helpTrigger.addEventListener('click', () => {
  helpPanel.hidden = false;
});

helpClose.addEventListener('click', () => {
  helpPanel.hidden = true;
});

window.addEventListener('click', (event) => {
  if (helpPanel.hidden) return;
  if (
    event.target.closest('.help-panel') ||
    event.target.closest('[data-action="open-help"]')
  ) {
    return;
  }
  helpPanel.hidden = true;
});
