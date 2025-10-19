const summaryList = document.querySelector('#summary-list');
const trackerList = document.querySelector('#tracker-list');
const pipelineList = document.querySelector('#pipeline-list');
const orderList = document.querySelector('#order-list');
const orderFilter = document.querySelector('#order-filter');
const connectionPill = document.querySelector('#connection-pill');
const helpPanel = document.querySelector('#help-panel');
const operationsSummary = document.querySelector('#operations-summary');
const operationsCaption = document.querySelector('[data-role="operations-caption"]');
const operationsEmpty = document.querySelector('#operations-empty');
const ordersFilterWrapper = document.querySelector('[data-role="orders-filter"]');
const segmentedButtons = Array.from(
  document.querySelectorAll('[data-role="segmented-button"]'),
);
const operationsLists = {
  pipelines: pipelineList,
  trackers: trackerList,
  orders: orderList,
};
let activeOperationsView = 'pipelines';

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

let latestFilteredOrders = orderData;

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

/**
 * Declarative list synchroniser. Each item is matched by a stable key (data-id)
 * and the DOM element is updated in-place via the provided updater. Updaters
 * must assign `element.dataset.id` so the diff can reuse nodes. This keeps
 * event delegation intact and avoids recreating frequently updated nodes.
 */
function syncList(target, items, { key, create, update }) {
  if (!target) return;
  const existing = new Map(
    Array.from(target.children).map((child) => [child.dataset.id, child]),
  );
  const fragment = document.createDocumentFragment();
  items.forEach((item) => {
    const id = key(item);
    let element = existing.get(id);
    if (!element) {
      element = create(item);
    } else {
      existing.delete(id);
    }
    update(element, item);
    fragment.appendChild(element);
  });
  target.replaceChildren(fragment);
}

function updateStatusDot(dot, level) {
  if (!dot) return;
  dot.className = 'status-dot';
  if (level === 'warning') dot.classList.add('warning');
  if (level === 'critical') dot.classList.add('critical');
}

function createStatusDot(level) {
  const dot = document.createElement('span');
  dot.classList.add('status-dot');
  updateStatusDot(dot, level);
  return dot;
}

function updateBadge(badge, level) {
  if (!badge) return;
  badge.className = 'badge';
  if (level === 'ok') badge.classList.add('badge--success');
  if (level === 'warning') badge.classList.add('badge--warning');
  if (level === 'critical') badge.classList.add('badge--critical');
}

function createBadge(level) {
  const badge = document.createElement('span');
  badge.classList.add('badge');
  updateBadge(badge, level);
  return badge;
}

function configureActionButton(button, { intent, label, variant, dataset }) {
  button.className = 'ghost compact';
  if (variant) {
    button.classList.add(variant);
  }
  button.dataset.intent = intent;
  const preservedKeys = new Set(Object.keys(dataset ?? {}));
  Object.keys(button.dataset).forEach((key) => {
    if (key !== 'intent' && !preservedKeys.has(key)) {
      delete button.dataset[key];
    }
  });
  Object.entries(dataset ?? {}).forEach(([key, value]) => {
    button.dataset[key] = value;
  });
  button.textContent = label;
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

function createSummaryElement() {
  const li = document.createElement('li');

  const meta = document.createElement('div');
  meta.classList.add('order-description');
  const label = document.createElement('strong');
  label.dataset.role = 'summary-label';
  const description = document.createElement('span');
  description.dataset.role = 'summary-description';
  meta.append(label, document.createElement('br'), description);

  const value = document.createElement('div');
  value.classList.add('order-meta');
  const dot = createStatusDot('ok');
  dot.dataset.role = 'status-dot';
  const valueText = document.createElement('span');
  valueText.dataset.role = 'summary-value';
  value.append(dot, valueText);

  li.append(meta, value);
  return li;
}

function updateSummaryElement(element, item) {
  element.dataset.id = item.id;
  element.dataset.level = item.level;
  const label = element.querySelector('[data-role="summary-label"]');
  if (label) {
    label.textContent = item.label;
  }
  const description = element.querySelector('[data-role="summary-description"]');
  if (description) {
    description.textContent = item.description;
  }
  const value = element.querySelector('[data-role="summary-value"]');
  if (value) {
    value.textContent = item.value;
  }
  const dot = element.querySelector('[data-role="status-dot"]');
  updateStatusDot(dot, item.level);
}

function renderSummary() {
  updateSummaryFromState();
  syncList(summaryList, summaryData, {
    key: (item) => item.id,
    create: createSummaryElement,
    update: updateSummaryElement,
  });
}

function renderOperationsSummary() {
  if (!operationsSummary) {
    return;
  }

  let summaryText = '';
  let emptyText = '';
  let visibleCount = 0;

  if (activeOperationsView === 'pipelines') {
    const total = signalPipelineData.length;
    const ready = signalPipelineData.filter((item) => item.status === 'ready').length;
    const blocked = signalPipelineData.filter((item) => item.status === 'blocked').length;
    summaryText =
      total === 0
        ? 'Очередь сигналов пуста.'
        : `${total} сигнал(ов) • ${ready} готово • ${blocked} заблокировано`;
    emptyText = 'Очередь сигналов пуста — ожидаем новые идеи.';
    visibleCount = total;
    if (operationsCaption) {
      operationsCaption.textContent = 'Контролируйте поток сигналов до запуска в работу.';
    }
  } else if (activeOperationsView === 'trackers') {
    const total = trackerData.length;
    const critical = trackerData.filter((item) => item.level === 'critical').length;
    const warning = trackerData.filter((item) => item.level === 'warning').length;
    summaryText =
      total === 0
        ? 'Нет активных трекеров.'
        : `${total} трекеров • ${critical} критических • ${warning} требуют внимания`;
    emptyText = 'Трекеры не запущены — загрузите сигнал, чтобы создать новый.';
    visibleCount = total;
    if (operationsCaption) {
      operationsCaption.textContent = 'Следите за состоянием активных трекеров и управляйте ими.';
    }
  } else {
    const total = latestFilteredOrders.length;
    const attention = latestFilteredOrders.filter((item) => item.level !== 'ok').length;
    summaryText =
      total === 0
        ? 'Нет заказов под выбранным фильтром.'
        : `${total} заказов • ${attention} требуют внимания`;
    emptyText = 'Заказы по выбранному фильтру не найдены.';
    visibleCount = total;
    if (operationsCaption) {
      operationsCaption.textContent = 'Контроль исполнения ордеров и быстрые действия по ним.';
    }
  }

  operationsSummary.textContent = summaryText;
  if (operationsEmpty) {
    operationsEmpty.textContent = emptyText;
    operationsEmpty.hidden = visibleCount > 0;
  }
  if (ordersFilterWrapper) {
    ordersFilterWrapper.hidden = activeOperationsView !== 'orders';
  }
}

function setActiveOperationsView(view) {
  if (!view || !Object.prototype.hasOwnProperty.call(operationsLists, view)) {
    return;
  }
  activeOperationsView = view;
  Object.entries(operationsLists).forEach(([key, list]) => {
    if (!list) {
      return;
    }
    list.hidden = key !== view;
  });
  segmentedButtons.forEach((button) => {
    button.classList.toggle('segmented__button--active', button.dataset.view === view);
  });
  renderOperationsSummary();
}

function createActionButton({ intent, label, variant, dataset }) {
  const button = document.createElement('button');
  configureActionButton(button, { intent, label, variant, dataset });
  return button;
}

function createTrackerElement() {
  const li = document.createElement('li');

  const details = document.createElement('div');
  details.classList.add('tracker-details');

  const meta = document.createElement('div');
  meta.classList.add('order-description');
  const name = document.createElement('strong');
  name.dataset.role = 'tracker-name';
  const next = document.createElement('span');
  next.dataset.role = 'tracker-next';
  meta.append(name, document.createElement('br'), next);

  const badge = createBadge('ok');
  badge.dataset.role = 'tracker-status';

  details.append(meta, badge);

  const controls = document.createElement('div');
  controls.classList.add('tracker-controls');
  controls.dataset.role = 'tracker-controls';

  li.append(details, controls);
  return li;
}

function updateTrackerElement(element, item) {
  element.dataset.id = item.id;
  element.dataset.trackerId = item.id;
  element.dataset.level = item.level;

  const name = element.querySelector('[data-role="tracker-name"]');
  if (name) {
    name.textContent = item.name;
  }
  const next = element.querySelector('[data-role="tracker-next"]');
  if (next) {
    next.textContent = item.nextEvent;
  }
  const badge = element.querySelector('[data-role="tracker-status"]');
  if (badge) {
    badge.textContent = item.status;
    updateBadge(badge, item.level);
  }

  const controls = element.querySelector('[data-role="tracker-controls"]');
  const actions = item.actions ?? [];
  if (controls) {
    const existingButtons = Array.from(
      controls.querySelectorAll('button[data-role="tracker-action"]'),
    );
    if (existingButtons.length !== actions.length) {
      const fragment = document.createDocumentFragment();
      actions.forEach((action) => {
        fragment.appendChild(
          createActionButton({
            intent: action.intent,
            label: action.label,
            variant: action.variant,
            dataset: { trackerId: item.id, role: 'tracker-action' },
          }),
        );
      });
      controls.replaceChildren(fragment);
    } else {
      actions.forEach((action, index) => {
        const button = existingButtons[index];
        configureActionButton(button, {
          intent: action.intent,
          label: action.label,
          variant: action.variant,
          dataset: { trackerId: item.id, role: 'tracker-action' },
        });
      });
    }
  }
}

function renderTrackers() {
  syncList(trackerList, trackerData, {
    key: (item) => item.id,
    create: createTrackerElement,
    update: updateTrackerElement,
  });
  if (activeOperationsView === 'trackers') {
    renderOperationsSummary();
  }
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

function createOrderElement() {
  const li = document.createElement('li');

  const description = document.createElement('div');
  description.classList.add('order-description');
  const title = document.createElement('strong');
  title.dataset.role = 'order-title';
  const details = document.createElement('span');
  details.dataset.role = 'order-description';
  description.append(title, document.createElement('br'), details);

  const meta = document.createElement('div');
  meta.classList.add('order-meta');
  const badge = createBadge('ok');
  badge.dataset.role = 'order-badge';
  const time = document.createElement('time');
  time.dataset.role = 'order-time';
  const actionButton = createActionButton({
    intent: 'order-action',
    label: '',
    dataset: { orderId: '', role: 'order-action' },
  });
  meta.append(badge, time, actionButton);

  li.append(description, meta);
  return li;
}

function updateOrderElement(element, item) {
  element.dataset.id = item.id;
  element.dataset.level = item.level;

  const title = element.querySelector('[data-role="order-title"]');
  if (title) {
    title.textContent = item.id;
  }
  const description = element.querySelector('[data-role="order-description"]');
  if (description) {
    description.textContent = item.description;
  }
  const badge = element.querySelector('[data-role="order-badge"]');
  if (badge) {
    badge.textContent = levelToText(item.level);
    updateBadge(badge, item.level);
  }
  const timeEl = element.querySelector('[data-role="order-time"]');
  if (timeEl) {
    timeEl.dateTime = item.updatedAt;
    const relative = formatRelativeTime(item.updatedAt);
    const absolute = formatAbsoluteTime(item.updatedAt);
    timeEl.textContent = relative || absolute;
    if (absolute) {
      timeEl.title = absolute;
      timeEl.setAttribute('aria-label', `Обновлено ${absolute}`);
    } else {
      timeEl.removeAttribute('title');
      timeEl.removeAttribute('aria-label');
    }
  }
  const actionButton = element.querySelector('[data-role="order-action"]');
  if (actionButton) {
    configureActionButton(actionButton, {
      intent: 'order-action',
      label: item.action,
      dataset: { orderId: item.id, role: 'order-action' },
    });
  }
}

function renderOrders() {
  let filtered = orderData;
  if (activeOrderFilter === 'active') {
    filtered = orderData.filter((order) => order.level === 'ok');
  } else if (activeOrderFilter === 'attention') {
    filtered = orderData.filter((order) => order.level !== 'ok');
  }
  latestFilteredOrders = filtered;
  syncList(orderList, filtered, {
    key: (item) => item.id,
    create: createOrderElement,
    update: updateOrderElement,
  });
  if (activeOperationsView === 'orders') {
    renderOperationsSummary();
  }
}

function handleOrderAction(orderId, button) {
  if (!orderId) {
    return;
  }
  const order = orderData.find((item) => item.id === orderId);
  const label = button?.textContent?.trim() || order?.action || '';
  const actionLabel = label || 'Действие';
  window.alert(`Действие «${actionLabel}» по заказу ${orderId}`);
}

function instantiateTrackerFromTemplate(template) {
  const clone = JSON.parse(JSON.stringify(template));
  clone.id = `${template.id}-${Date.now()}`;
  clone.actions = clone.actions ?? [];
  return clone;
}

function createPipelineElement() {
  const li = document.createElement('li');

  const meta = document.createElement('div');
  meta.classList.add('order-description');
  const title = document.createElement('strong');
  title.dataset.role = 'pipeline-title';
  const summary = document.createElement('span');
  summary.dataset.role = 'pipeline-summary';
  const next = document.createElement('span');
  next.classList.add('pipeline-next');
  next.dataset.role = 'pipeline-next';
  meta.append(title, document.createElement('br'), summary, document.createElement('br'), next);

  const panel = document.createElement('div');
  panel.classList.add('pipeline-meta');
  panel.dataset.role = 'pipeline-panel';

  const tag = document.createElement('span');
  tag.classList.add('tag');
  tag.dataset.role = 'pipeline-status-tag';
  panel.append(tag);

  const time = document.createElement('time');
  time.dataset.role = 'pipeline-time';
  panel.append(time);

  li.append(meta, panel);
  return li;
}

function updatePipelineElement(element, item) {
  element.dataset.id = item.id;
  element.dataset.status = item.status;

  const title = element.querySelector('[data-role="pipeline-title"]');
  if (title) {
    title.textContent = item.title;
  }
  const summary = element.querySelector('[data-role="pipeline-summary"]');
  if (summary) {
    summary.textContent = item.summary;
  }
  const next = element.querySelector('[data-role="pipeline-next"]');
  if (next) {
    next.textContent = item.nextStep;
  }

  const statusMeta = pipelineStatusMeta[item.status];
  const tag = element.querySelector('[data-role="pipeline-status-tag"]');
  if (tag) {
    tag.className = 'tag';
    if (statusMeta) {
      tag.classList.add(`tag--${statusMeta.tone}`);
      tag.textContent = statusMeta.label;
    } else {
      tag.textContent = 'Без статуса';
    }
  }

  const timeEl = element.querySelector('[data-role="pipeline-time"]');
  if (timeEl) {
    timeEl.dateTime = item.updatedAt;
    const relative = formatRelativeTime(item.updatedAt);
    const absolute = formatAbsoluteTime(item.updatedAt);
    timeEl.textContent = relative || absolute;
    if (absolute) {
      timeEl.title = absolute;
      timeEl.setAttribute('aria-label', `Обновлено ${absolute}`);
    } else {
      timeEl.removeAttribute('title');
      timeEl.removeAttribute('aria-label');
    }
  }

  const panel = element.querySelector('[data-role="pipeline-panel"]');
  if (panel) {
    let actionButton = panel.querySelector('[data-role="pipeline-action"]');
    if (statusMeta) {
      const config = {
        intent: statusMeta.actionIntent,
        label: statusMeta.actionLabel,
        variant: statusMeta.actionVariant,
        dataset: { pipelineId: item.id, role: 'pipeline-action' },
      };
      if (!actionButton) {
        actionButton = createActionButton(config);
        panel.append(actionButton);
      } else {
        configureActionButton(actionButton, config);
      }
    } else if (actionButton) {
      actionButton.remove();
    }
  }
}

function renderPipeline() {
  syncList(pipelineList, signalPipelineData, {
    key: (item) => item.id,
    create: createPipelineElement,
    update: updatePipelineElement,
  });
  if (activeOperationsView === 'pipelines') {
    renderOperationsSummary();
  }
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

if (trackerList) {
  trackerList.addEventListener('click', (event) => {
    if (!(event.target instanceof Element)) {
      return;
    }
    const button = event.target.closest('[data-role="tracker-action"]');
    if (!button || !trackerList.contains(button)) {
      return;
    }
    const trackerId = button.dataset.trackerId ?? '';
    const intent = button.dataset.intent ?? '';
    handleTrackerAction(trackerId, intent);
  });
}

if (pipelineList) {
  pipelineList.addEventListener('click', (event) => {
    if (!(event.target instanceof Element)) {
      return;
    }
    const button = event.target.closest('[data-role="pipeline-action"]');
    if (!button || !pipelineList.contains(button)) {
      return;
    }
    const pipelineId = button.dataset.pipelineId ?? '';
    const intent = button.dataset.intent ?? '';
    handlePipelineAction(pipelineId, intent);
  });
}

if (orderList) {
  orderList.addEventListener('click', (event) => {
    if (!(event.target instanceof Element)) {
      return;
    }
    const button = event.target.closest('[data-role="order-action"]');
    if (!button || !orderList.contains(button)) {
      return;
    }
    const orderId = button.dataset.orderId ?? '';
    handleOrderAction(orderId, button);
  });
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

segmentedButtons.forEach((button) => {
  button.addEventListener('click', () => {
    const view = button.dataset.view ?? '';
    setActiveOperationsView(view);
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
setActiveOperationsView('pipelines');

setInterval(() => {
  if (!isConnectionOffline) {
    renderSummary();
  }
}, 60_000);
