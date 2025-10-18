const summaryList = document.querySelector('#summary-list');
const trackerList = document.querySelector('#tracker-list');
const orderList = document.querySelector('#order-list');
const connectionPill = document.querySelector('#connection-pill');
const helpPanel = document.querySelector('#help-panel');

const summaryData = [
  {
    label: 'Websocket соединение',
    value: 'Норма',
    level: 'ok',
    description: 'Последний heartbeat 12 секунд назад',
  },
  {
    label: 'Очередь сигналов',
    value: '3 в обработке',
    level: 'warning',
    description: 'Задержка ввода ~45 секунд из-за повторного парсинга',
  },
  {
    label: 'Ошибки исполнения',
    value: '1 критический',
    level: 'critical',
    description: 'Tracker #42 остановлен из-за невалидного ордера',
  },
];

const trackerData = [
  {
    name: 'Tracker #40 — ETH-PERP swing',
    status: 'Авто',
    level: 'ok',
    nextEvent: 'След. контроль через 2 мин',
  },
  {
    name: 'Tracker #42 — BTC breakout',
    status: 'Пауза',
    level: 'critical',
    nextEvent: 'Ожидает ручного разрешения',
  },
  {
    name: 'Tracker #48 — SOL grid',
    status: 'Внимание',
    level: 'warning',
    nextEvent: 'Невыполненный стоп на бирже',
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

function renderList(target, items, renderer) {
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

renderList(summaryList, summaryData, (item) => {
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

renderList(trackerList, trackerData, (item) => {
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

renderList(orderList, orderData, (item) => {
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
  time.textContent = formatTime(item.updatedAt);
  const actionButton = document.createElement('button');
  actionButton.classList.add('ghost');
  actionButton.textContent = item.action;
  actionButton.addEventListener('click', () => {
    window.alert(`Действие «${item.action}» по заказу ${item.id}`);
  });

  meta.append(badge, time, actionButton);
  li.append(description, meta);
  return li;
});

function levelToText(level) {
  if (level === 'critical') return 'Критично';
  if (level === 'warning') return 'Внимание';
  return 'Норма';
}

function formatTime(isoString) {
  const date = new Date(isoString);
  return date.toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

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

const orderFilter = document.querySelector('#order-filter');
orderFilter.addEventListener('change', () => {
  const value = orderFilter.value;
  const filtered =
    value === 'all'
      ? orderData
      : orderData.filter((order) =>
          value === 'active' ? order.level === 'ok' : order.level !== 'ok',
        );
  renderList(orderList, filtered, (item) => {
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
    time.textContent = formatTime(item.updatedAt);
    const actionButton = document.createElement('button');
    actionButton.classList.add('ghost');
    actionButton.textContent = item.action;
    actionButton.addEventListener('click', () => {
      window.alert(`Действие «${item.action}» по заказу ${item.id}`);
    });

    meta.append(badge, time, actionButton);
    li.append(description, meta);
    return li;
  });
});

connectionPill.addEventListener('click', () => {
  const isOnline = connectionPill.classList.toggle('pill-offline');
  connectionPill.textContent = isOnline ? 'API недоступно' : 'API подключено';
  connectionPill.classList.toggle('pill-online', !isOnline);
  connectionPill.classList.toggle('pill-danger', isOnline);
});

const helpTrigger = document.querySelector('[data-action="open-help"]');
const helpClose = document.querySelector('[data-action="close-help"]');

helpTrigger.addEventListener('click', () => {
  helpPanel.hidden = false;
});

helpClose.addEventListener('click', () => {
  helpPanel.hidden = true;
});

// автоскрытие подсказки при клике вне панели
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

