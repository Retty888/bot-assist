const summaryList = document.querySelector('#summary-list');
const trackerList = document.querySelector('#tracker-list');
const pipelineList = document.querySelector('#pipeline-list');
const orderList = document.querySelector('#order-list');
const orderFilter = document.querySelector('#order-filter');
const connectionPill = document.querySelector('#connection-pill');
const helpPanel = document.querySelector('#help-panel');

const summaryData = [
  {
    id: 'connection',
    label: 'Websocket соединение',
    value: 'Норма',
    level: 'ok',
    description: 'Последний heartbeat 12 секунд назад',
  },
  {
    id: 'queue',
    label: 'Очередь сигналов',
    value: '3 в обработке',
    level: 'warning',
    description: 'Задержка ввода ~45 секунд из-за повторного парсинга',
  },
  {
    id: 'errors',
    label: 'Ошибки исполнения',
    value: '1 критический',
    level: 'critical',
    description: 'Tracker #42 остановлен из-за невалидного ордера',
  },
];

let trackerData = [
  {
    id: 'tracker-40',
    name: 'Tracker #40 — ETH-PERP swing',
    status: 'Авто',
    level: 'ok',
    nextEvent: 'След. контроль через 2 мин',
    actions: [
      { label: 'Пауза', intent: 'pause', variant: 'warning' },
      { label: 'Инцидент', intent: 'open-incident' },
    ],
  },
  {
    id: 'tracker-42',
    name: 'Tracker #42 — BTC breakout',
    status: 'Пауза',
    level: 'critical',
    nextEvent: 'Ожидает ручного разрешения',
    actions: [
      { label: 'Разрешить', intent: 'resume', variant: 'success' },
      { label: 'Закрыть', intent: 'close', variant: 'danger' },
    ],
  },
  {
    id: 'tracker-48',
    name: 'Tracker #48 — SOL grid',
    status: 'Внимание',
    level: 'warning',
    nextEvent: 'Невыполненный стоп на бирже',
    actions: [
      { label: 'Повторить стоп', intent: 'refresh-stop', variant: 'warning' },
      { label: 'Отчёт', intent: 'open-report' },
    ],
  },
];

const orderData = [
  {
    id: 'HL-9921',
    description: 'ETH-PERP лимитный ордер 25 контрактов',
    level: 'ok',
    updatedAt: '2024-07-21T08:24:00Z',
    action: 'Повторить',
  },
  {
    id: 'HL-9924',
    description: 'BTC-PERP стоп-ордер 10 контрактов',
    level: 'warning',
    updatedAt: '2024-07-21T08:20:00Z',
    action: 'Проверить',
  },
  {
    id: 'HL-9930',
    description: 'SOL-PERP рыночный ордер 5 контрактов',
    level: 'critical',
    updatedAt: '2024-07-21T08:10:00Z',
    action: 'Расследовать',
  },
];

const signalPipelineData = [
  {
    id: 'pipeline-eth',
    title: 'ETH momentum Asia',
    summary: 'Algo Desk · окно Азия · пресет Momentum',
    nextStep: 'Передать в исполнение',
    status: 'ready',
    updatedAt: '2024-07-21T08:15:00Z',
    trackerTemplate: {
      id: 'tracker-54',
      name: 'Tracker #54 — ETH momentum Asia',
      status: 'Подготовка',
      level: 'warning',
      nextEvent: 'Запуск ожидает подтверждения оператора',
      actions: [
        { label: 'Запустить', intent: 'resume', variant: 'success' },
        { label: 'Отменить', intent: 'close', variant: 'danger' },
      ],
    },
  },
  {
    id: 'pipeline-btc',
    title: 'BTC breakout EU desk',
    summary: 'Ручной сигнал · требуется ревью риска',
    nextStep: 'Назначить ревью и расчёт риска',
    status: 'needsReview',
    updatedAt: '2024-07-21T08:05:00Z',
    trackerTemplate: {
      id: 'tracker-55',
      name: 'Tracker #55 — BTC breakout EU',
      status: 'Подготовка',
      level: 'warning',
      nextEvent: 'Ожидает подтверждения после ревью',
      actions: [
        { label: 'Запустить', intent: 'resume', variant: 'success' },
        { label: 'Отменить', intent: 'close', variant: 'danger' },
      ],
    },
  },
  {
    id: 'pipeline-sol',
    title: 'SOL grid adjustments',
    summary: 'Автоматизация · блокировка после превышения лимита',
    nextStep: 'Снять блокировку после проверки лимита',
    status: 'blocked',
    updatedAt: '2024-07-21T07:58:00Z',
  },
];

const pipelineStatusMeta = {
  ready: {
    label: 'Готово к запуску',
    tone: 'success',
    actionLabel: 'Взять в работу',
    actionIntent: 'load',
    actionVariant: 'success',
  },
  needsReview: {
    label: 'Требует ревью',
    tone: 'warning',
    actionLabel: 'Назначить ревью',
    actionIntent: 'review',
    actionVariant: 'warning',
  },
  blocked: {
    label: 'Заблокировано',
    tone: 'critical',
    actionLabel: 'Снять блокировку',
    actionIntent: 'unblock',
    actionVariant: 'danger',
  },
};

let lastHeartbeat = new Date(Date.now() - 12_000).toISOString();
let isConnectionOffline = false;
let activeOrderFilter = orderFilter?.value ?? 'all';

const relativeTimeFormat = new Intl.RelativeTimeFormat('ru', { numeric: 'auto' });
const RELATIVE_TIME_DIVISIONS = [
  { amount: 60, unit: 'second' },
  { amount: 60, unit: 'minute' },
  { amount: 24, unit: 'hour' },
  { amount: 7, unit: 'day' },
  { amount: 4.34524, unit: 'week' },
  { amount: 12, unit: 'month' },
  { amount: Number.POSITIVE_INFINITY, unit: 'year' },
];

function renderList(target, items, renderer) {
  if (!target) return;
  target.innerHTML = '';
  const fragment = document.createDocumentFragment();
  items.forEach((item) => {
    fragment.appendChild(renderer(item));
  });
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

function levelToText(level) {
  if (level === 'critical') return 'Критично';
  if (level === 'warning') return 'Внимание';
  return 'Норма';
}

function formatRelativeTime(isoString) {
  const timestamp = Date.parse(isoString);
  if (Number.isNaN(timestamp)) {
    return '';
  }
  let delta = (timestamp - Date.now()) / 1000;
  if (Math.abs(delta) < 5) {
    return 'только что';
  }
  for (const division of RELATIVE_TIME_DIVISIONS) {
    if (Math.abs(delta) < division.amount) {
      return relativeTimeFormat.format(Math.round(delta), division.unit);
    }
    delta /= division.amount;
  }
  return relativeTimeFormat.format(Math.round(delta), 'year');
}

function formatAbsoluteTime(isoString) {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return date.toLocaleString('ru-RU', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function updateSummaryFromState() {
  const queueEntry = summaryData.find((item) => item.id === 'queue');
  if (queueEntry) {
    const queued = signalPipelineData.length;
    if (queued === 0) {
      queueEntry.value = 'Очередь пуста';
      queueEntry.level = 'ok';
      queueEntry.description = 'Все сигналы распределены по трекерам.';
    } else {
      queueEntry.value = `${queued} в обработке`;
      queueEntry.level = queued >= 3 ? 'warning' : 'ok';
      const next = signalPipelineData[0];
      queueEntry.description = next
        ? `Следующий: ${next.title} • ${next.nextStep}`
        : 'Сигналы обрабатываются по расписанию.';
    }
  }

  const errorsEntry = summaryData.find((item) => item.id === 'errors');
  if (errorsEntry) {
    const critical = trackerData.filter((tracker) => tracker.level === 'critical');
    const warnings = trackerData.filter((tracker) => tracker.level === 'warning');
    if (critical.length > 0) {
      const [first] = critical;
      errorsEntry.value = `${critical.length} критический`;
      errorsEntry.level = 'critical';
      errorsEntry.description = `${first.name} требует ручного вмешательства.`;
    } else if (warnings.length > 0) {
      const [first] = warnings;
      errorsEntry.value = `${warnings.length} требует внимания`;
      errorsEntry.level = 'warning';
      errorsEntry.description = `${first.name} ожидает проверки.`;
    } else {
      errorsEntry.value = '0 критических';
      errorsEntry.level = 'ok';
      errorsEntry.description = 'Все трекеры стабильны.';
    }
  }

  const connectionEntry = summaryData.find((item) => item.id === 'connection');
  if (connectionEntry && !isConnectionOffline) {
    connectionEntry.description = `Последний heartbeat ${formatRelativeTime(lastHeartbeat)}`;
  }
}

function renderSummaryItem(item) {
  const li = document.createElement('li');
  li.dataset.level = item.level;

  const meta = document.createElement('div');
  meta.classList.add('order-description');
  meta.innerHTML = `<strong>${item.label}</strong><br /><span>${item.description}</span>`;

  const value = document.createElement('div');
  value.classList.add('order-meta');
  value.append(createStatusDot(item.level));
  value.append(document.createTextNode(item.value));

  li.append(meta, value);
  return li;
}

function renderSummary() {
  updateSummaryFromState();
  renderList(summaryList, summaryData, renderSummaryItem);
}

function createActionButton({ intent, label, variant, dataset }) {
  const button = document.createElement('button');
  button.classList.add('ghost', 'compact');
  if (variant) {
    button.classList.add(variant);
  }
  button.dataset.intent = intent;
  Object.entries(dataset ?? {}).forEach(([key, value]) => {
    button.dataset[key] = value;
  });
  button.textContent = label;
  return button;
}

function renderTrackerItem(item) {
  const li = document.createElement('li');
  li.dataset.level = item.level;
  li.dataset.trackerId = item.id;

  const details = document.createElement('div');
  details.classList.add('tracker-details');

  const meta = document.createElement('div');
  meta.classList.add('order-description');
  meta.innerHTML = `<strong>${item.name}</strong><br /><span>${item.nextEvent}</span>`;

  const badge = createBadge(item.level);
  badge.textContent = item.status;

  details.append(meta, badge);

  const controls = document.createElement('div');
  controls.classList.add('tracker-controls');

  (item.actions ?? []).forEach((action) => {
    const button = createActionButton({
      intent: action.intent,
      label: action.label,
      variant: action.variant,
      dataset: { trackerId: item.id, role: 'tracker-action' },
    });
    controls.append(button);
  });

  li.append(details, controls);
  return li;
}

function renderTrackers() {
  renderList(trackerList, trackerData, renderTrackerItem);
  trackerList
    ?.querySelectorAll('button[data-role="tracker-action"]')
    .forEach((button) => {
      button.addEventListener('click', () => {
        const trackerId = button.dataset.trackerId ?? '';
        const intent = button.dataset.intent ?? '';
        handleTrackerAction(trackerId, intent);
      });
    });
}

function handleTrackerAction(trackerId, intent) {
  const tracker = trackerData.find((item) => item.id === trackerId);
  if (!tracker) {
    return;
  }

  if (intent === 'resume') {
    tracker.level = 'ok';
    tracker.status = 'Авто';
    tracker.nextEvent = 'Мониторинг возобновлён — контроль через 2 мин';
    tracker.actions = [
      { label: 'Пауза', intent: 'pause', variant: 'warning' },
      { label: 'Отчёт', intent: 'open-report' },
    ];
    window.alert(`${tracker.name} снова работает в автоматическом режиме.`);
  } else if (intent === 'pause') {
    tracker.level = 'warning';
    tracker.status = 'Пауза';
    tracker.nextEvent = 'Возобновление по запросу оператора';
    tracker.actions = [
      { label: 'Возобновить', intent: 'resume', variant: 'success' },
      { label: 'Закрыть', intent: 'close', variant: 'danger' },
    ];
    window.alert(`${tracker.name} переведён на паузу.`);
  } else if (intent === 'close') {
    tracker.level = 'ok';
    tracker.status = 'Закрыт';
    tracker.nextEvent = 'Сессия завершена, ждёт отчёт';
    tracker.actions = [{ label: 'Отчёт', intent: 'open-report' }];
    window.alert(`${tracker.name} закрыт оператором.`);
  } else if (intent === 'refresh-stop') {
    tracker.nextEvent = 'Перепроверка стоп-ордеров — контроль через 1 мин';
    window.alert(`Перепроверяем стоп-ордера для ${tracker.name}.`);
  } else if (intent === 'open-report') {
    window.alert(`Откройте отчёт по ${tracker.name} в журнале инцидентов.`);
  } else if (intent === 'open-incident') {
    window.alert(`Создайте инцидент по ${tracker.name} в Ops-канале.`);
  }

  renderTrackers();
  renderSummary();
}

function renderOrderItem(item) {
  const li = document.createElement('li');
  li.dataset.level = item.level;

  const description = document.createElement('div');
  description.classList.add('order-description');
  description.innerHTML = `<strong>${item.id}</strong><br /><span>${item.description}</span>`;

  const meta = document.createElement('div');
  meta.classList.add('order-meta');
  const badge = createBadge(item.level);
  badge.textContent = levelToText(item.level);
  const time = document.createElement('time');
  time.dateTime = item.updatedAt;
  const relative = formatRelativeTime(item.updatedAt);
  const absolute = formatAbsoluteTime(item.updatedAt);
  time.textContent = relative || absolute;
  if (absolute) {
    time.title = absolute;
    time.setAttribute('aria-label', `Обновлено ${absolute}`);
  }
  const actionButton = createActionButton({
    intent: 'order-action',
    label: item.action,
    dataset: { orderId: item.id },
  });
  actionButton.addEventListener('click', () => {
    window.alert(`Действие «${item.action}» по заказу ${item.id}`);
  });

  meta.append(badge, time, actionButton);
  li.append(description, meta);
  return li;
}

function renderOrders() {
  let filtered = orderData;
  if (activeOrderFilter === 'active') {
    filtered = orderData.filter((order) => order.level === 'ok');
  } else if (activeOrderFilter === 'attention') {
    filtered = orderData.filter((order) => order.level !== 'ok');
  }
  renderList(orderList, filtered, renderOrderItem);
}

function instantiateTrackerFromTemplate(template) {
  const clone = JSON.parse(JSON.stringify(template));
  clone.id = `${template.id}-${Date.now()}`;
  clone.actions = clone.actions ?? [];
  return clone;
}

function renderPipelineItem(item) {
  const li = document.createElement('li');
  li.dataset.status = item.status;

  const meta = document.createElement('div');
  meta.classList.add('order-description');
  meta.innerHTML = `<strong>${item.title}</strong><br /><span>${item.summary}</span><br /><span class="pipeline-next">${item.nextStep}</span>`;

  const statusMeta = pipelineStatusMeta[item.status];
  const panel = document.createElement('div');
  panel.classList.add('pipeline-meta');

  const tag = document.createElement('span');
  tag.classList.add('tag');
  if (statusMeta) {
    tag.classList.add(`tag--${statusMeta.tone}`);
    tag.textContent = statusMeta.label;
  } else {
    tag.textContent = 'Без статуса';
  }
  panel.append(tag);

  const time = document.createElement('time');
  time.dateTime = item.updatedAt;
  const relative = formatRelativeTime(item.updatedAt);
  const absolute = formatAbsoluteTime(item.updatedAt);
  time.textContent = relative || absolute;
  if (absolute) {
    time.title = absolute;
    time.setAttribute('aria-label', `Обновлено ${absolute}`);
  }
  panel.append(time);

  if (statusMeta) {
    const button = createActionButton({
      intent: statusMeta.actionIntent,
      label: statusMeta.actionLabel,
      variant: statusMeta.actionVariant,
      dataset: { pipelineId: item.id, role: 'pipeline-action' },
    });
    panel.append(button);
  }

  li.append(meta, panel);
  return li;
}

function renderPipeline() {
  renderList(pipelineList, signalPipelineData, renderPipelineItem);
  pipelineList
    ?.querySelectorAll('button[data-role="pipeline-action"]')
    .forEach((button) => {
      button.addEventListener('click', () => {
        const pipelineId = button.dataset.pipelineId ?? '';
        const intent = button.dataset.intent ?? '';
        handlePipelineAction(pipelineId, intent);
      });
    });
}

function handlePipelineAction(pipelineId, intent) {
  const index = signalPipelineData.findIndex((item) => item.id === pipelineId);
  if (index === -1) {
    return;
  }

  const item = signalPipelineData[index];
  let message = '';
  let trackersChanged = false;

  if (intent === 'load') {
    signalPipelineData.splice(index, 1);
    if (item.trackerTemplate) {
      const tracker = instantiateTrackerFromTemplate(item.trackerTemplate);
      trackerData = [tracker, ...trackerData];
      trackersChanged = true;
    }
    message = `Сигнал «${item.title}» добавлен в мониторинг.`;
  } else if (intent === 'review') {
    item.status = 'ready';
    item.summary = 'Ревью завершено — сигнал готов к запуску';
    item.nextStep = 'Передать в исполнение';
    item.updatedAt = new Date().toISOString();
    message = `Назначено ревью по сигналу «${item.title}».`;
  } else if (intent === 'unblock') {
    item.status = 'needsReview';
    item.summary = 'Блокировка снята, требуется финальное ревью';
    item.nextStep = 'Назначить ревью и расчёт риска';
    item.updatedAt = new Date().toISOString();
    message = `Сигнал «${item.title}» разблокирован.`;
  }

  renderPipeline();
  if (trackersChanged) {
    renderTrackers();
  }
  renderSummary();

  if (message) {
    window.alert(message);
  }
}

function setConnectionState(offline, options = {}) {
  const { updateHeartbeat = true } = options;
  isConnectionOffline = offline;
  if (connectionPill) {
    connectionPill.classList.toggle('pill-offline', offline);
    connectionPill.classList.toggle('pill-danger', offline);
    connectionPill.classList.toggle('pill-online', !offline);
    connectionPill.textContent = offline ? 'API недоступно' : 'API подключено';
  }

  const connectionEntry = summaryData.find((item) => item.id === 'connection');
  if (connectionEntry) {
    if (offline) {
      connectionEntry.value = 'Отключено';
      connectionEntry.level = 'critical';
      connectionEntry.description = 'API отключено оператором.';
    } else {
      connectionEntry.value = 'Норма';
      connectionEntry.level = 'ok';
      if (updateHeartbeat) {
        lastHeartbeat = new Date().toISOString();
      }
    }
  }

  renderSummary();
}

function handleQuickAction(action) {
  if (!action) {
    return;
  }

  if (action === 'refresh-signals') {
    const nowIso = new Date().toISOString();
    lastHeartbeat = nowIso;
    signalPipelineData.forEach((item) => {
      if (item.status === 'ready') {
        item.updatedAt = nowIso;
      }
    });
    renderPipeline();
    renderSummary();
    window.alert('Очередь сигналов синхронизирована.');
  } else if (action === 'pause-automation') {
    setConnectionState(true);
    window.alert('Автоматизация приостановлена для проверки.');
  } else if (action === 'resolve-alerts') {
    const target =
      trackerData.find((tracker) => tracker.level === 'critical') ||
      trackerData.find((tracker) => tracker.level === 'warning');
    if (!target) {
      window.alert('Активных алертов не обнаружено.');
      return;
    }
    target.level = 'ok';
    target.status = 'Авто';
    target.nextEvent = 'Мониторинг восстановлен — контроль через 2 мин';
    target.actions = [
      { label: 'Пауза', intent: 'pause', variant: 'warning' },
      { label: 'Отчёт', intent: 'open-report' },
    ];
    renderTrackers();
    renderSummary();
    window.alert(`${target.name} переведён в штатный режим.`);
  } else if (action === 'new-manual-order') {
    const symbolInput = document.querySelector('#signal-form input[name="symbol"]');
    symbolInput?.focus();
    window.alert('Форма ручного ордера готова к вводу.');
  } else {
    window.alert(`Действие «${action}» пока не настроено.`);
  }
}

const form = document.querySelector('#signal-form');
if (form) {
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const formData = new FormData(form);
    const payload = Object.fromEntries(formData.entries());
    window.alert(`Сигнал отправлен: ${JSON.stringify(payload, null, 2)}`);
    form.reset();
  });

  const draftButton = form.querySelector('[data-action="save-draft"]');
  draftButton?.addEventListener('click', () => {
    const formData = new FormData(form);
    const payload = Object.fromEntries(formData.entries());
    window.alert(`Черновик сохранён:\n${JSON.stringify(payload, null, 2)}`);
  });
}

if (orderFilter) {
  activeOrderFilter = orderFilter.value;
  orderFilter.addEventListener('change', () => {
    activeOrderFilter = orderFilter.value;
    renderOrders();
  });
}

document.querySelectorAll('.toggle').forEach((button) => {
  button.addEventListener('click', () => {
    const targetId = button.dataset.target;
    const target = document.querySelector(`#${targetId}`);
    if (!target) return;
    target.hidden = !target.hidden;
    button.textContent = target.hidden ? 'Раскрыть доп. опции' : 'Свернуть доп. опции';
  });
});

document.querySelectorAll('.quick-actions button').forEach((button) => {
  button.addEventListener('click', () => {
    handleQuickAction(button.dataset.action ?? '');
  });
});

if (connectionPill) {
  connectionPill.addEventListener('click', () => {
    setConnectionState(!isConnectionOffline);
  });
}

const helpTrigger = document.querySelector('[data-action="open-help"]');
const helpClose = document.querySelector('[data-action="close-help"]');

helpTrigger?.addEventListener('click', () => {
  if (!helpPanel) return;
  helpPanel.hidden = false;
});

helpClose?.addEventListener('click', () => {
  if (!helpPanel) return;
  helpPanel.hidden = true;
});

window.addEventListener('click', (event) => {
  if (!helpPanel || helpPanel.hidden) return;
  if (
    event.target.closest('.help-panel') ||
    event.target.closest('[data-action="open-help"]')
  ) {
    return;
  }
  helpPanel.hidden = true;
});

setConnectionState(false, { updateHeartbeat: false });
renderTrackers();
renderOrders();
renderPipeline();
renderSummary();

setInterval(() => {
  if (!isConnectionOffline) {
    renderSummary();
  }
}, 60_000);
