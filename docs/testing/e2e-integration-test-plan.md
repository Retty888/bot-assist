# E2E и интеграционные сценарии

Документ описывает критические пользовательские флоу, которые покрываются e2e-тестами, и сервисные контракты, лежащие в основе интеграционных проверок. Сценарии отражают ожидаемое поведение публичного UI (`/`) и REST API (`/api/*`).

## Критические e2e-сценарии

| Сценарий | Пользовательские шаги | Ожидаемый результат | API/хранилища |
| --- | --- | --- | --- |
| **Запуск бота с дефолтным сигналом** | Открыть `/`, дождаться автозагрузки шаблона, отправить форму «Execute Signal». | Видно сообщение `Signal executed successfully`, блоки parsed/order/response заполнены JSON, лейбл режима — «Demo». | `POST /api/execute`, `appendSignalHistory`, `appendTradeHistory` |
| **Получение рекомендаций по сигналу** | Вставить в поле «Signal intake» валидный сигнал или использовать шаблон, дождаться автозапроса подсказок. | В секции «Recommendations» появляются hint-chip элементы с badge/текстом, обновляются метрики контекста (symbol, ATR, volatility и т.п.). | `POST /api/hints`, `buildRecommendations`, `defaultMarketDataProvider` |
| **Работа с демо-позициями** | Перейти в блок «Positions & signal alignment», нажать «Save position», обновить, удалить позицию. | Список позиций обновляется без ошибок, подтверждается toast/status в UI. | `GET/POST/PUT/DELETE /api/positions`, `positionStore` |
| **Проверка истории сигналов** | После успешного исполнения сигнала открыть секцию «Open signals & trackers». | В списке появляются новые записи, ограничение пагинации (`limit`) соблюдается. | `GET /api/history/signals`, `getSignalHistory` |
| **Переключение темы и базовая навигация** | Нажать toggle темы, открыть вкладки аккордеона (Parsed signal, Order payload и т.д.). | Тема меняется без перезагрузки, состояние сохраняется в localStorage; элементы аккордеона раскрываются корректно. | `localStorage`, `HintManager`, DOM |

## Контракты для интеграционных тестов

| Endpoint / сервис | Метод и обязательные поля | Нормативный ответ | Валидации и ошибки |
| --- | --- | --- | --- |
| `/api/default-signal` | `GET` — без параметров. | `200 { defaultSignal: string }`, строка содержит ключевые элементы сигнала. | Ошибок нет; используется для заполнения UI. |
| `/api/hints` | `POST { text: string, market?: MarketSnapshot }` | `200 { hints: RecommendationHint[], context: RecommendationContext }` — минимум одна подсказка при валидном сигнале, `context.symbol` соответствует сигналу. | `400 { error: "Signal text is required" }` для пустого текста; `500` при сбоях построения подсказок. |
| `/api/market-data` | `POST { signal?: string, symbol?: string }` | `200 { price, atr, volatility, liquidityScore, fundingRate, layers? }`. | `400 { error }` при сбоях парсинга или провайдера. |
| `/api/execute` | `POST { text: string }` | `200 { demoMode: boolean, signal, payload, response }`. При отсутствии приватного ключа `demoMode === true`. | `400 { error: "Signal text is required" }` или `400` с текстом ошибки парсера/бота. |
| `/api/history/signals` | `GET` + query `limit?` | `200 { items: SignalHistoryRecord[] }`, сортировка по убыванию времени. | `500 { error }` при ошибке чтения. |
| `/api/history/trades` | `GET` + query `limit?` | `200 { items: TradeHistoryRecord[] }`. | Аналогично `history/signals`. |
| `/api/positions` | `GET` | `200 { items: StoredPosition[] }`, при первом обращении возвращает demo-данные (BTC/ETH). | — |
| `/api/positions` | `POST { symbol, side, size, entryPrice, ... }` | `201 StoredPosition` — содержит `id`, `createdAt`, `updatedAt`. | `400` при отсутствии символа/стороны/положительной числовой валидации. |
| `/api/positions/:id` | `PUT { ... }` частичное обновление | `200 StoredPosition` с обновлёнными полями и `updatedAt`. | `400` если тело пустое; `404` если позиция не найдена. |
| `/api/positions/:id` | `DELETE` | `204` при успешном удалении. | `400` без id; `404` если запись отсутствует. |
| `positionStore` | `listPositions`, `createPosition`, `updatePosition`, `deletePosition` | Работают с JSON-файлом; создают seed-позиции если файл пуст. | Требуют валидных числовых значений, возвращают `false` при отсутствии сущности. |
| `historyStore` | `appendSignalHistory`, `appendTradeHistory`, `get*` | Пишут/читают NDJSON в директории данных. | Пропускают битые строки, возвращают пустой список при отсутствии файлов. |

### Дополнительные проверки

- **Формат чисел и валют:** e2e тесты сверяют отображение округлений (ATR %, notional USD) для стабильности UI.
- **Стабильность демо-режима:** интеграционные тесты проверяют, что `/api/execute` всегда возвращает `demoMode: true` без приватного ключа и генерирует хотя бы один ордер.
- **Функция восстановления данных:** при указании пустой директории данных `positionStore` обязан засидировать demo-позиции — тесты фиксируют IDs, чтобы гарантировать отсутствие регрессий.

Документ обновляется при добавлении новых сервисных методов или пользовательских фич, чтобы e2e / интеграционные наборы оставались релевантными.

