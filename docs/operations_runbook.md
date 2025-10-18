# Hyperliquid Bot — Operations Runbook (v2025-10-18)

## 1. Контактные лица и ротации

| Команда | Ответственный (первичная ротация) | Бэкап | Канал связи |
| --- | --- | --- | --- |
| Trading Tech | Игорь Мельник (@imelnik) | Софья Пруткова (@sprutkova) | Slack `#trading-bot-core` |
| Platform SRE | Владислав Литвин (@vlitvin) | Снежана Ракова (@srakova) | Slack `#platform-sre` |
| Security Ops | Мария Мацкевич (@mmatskevich) | Георгий Стаценко (@gstatsenko) | Slack `#sec-ops` |

- **Ротация on-call:** 24×7, смена еженедельно по понедельникам 09:00 UTC. Календарь хранится в Google Calendar `Hyperliquid Bot — On-call`.
- **Передача дежурства:** уходящий on-call фиксирует состояние в `Notion › Runbooks & Procedures › Shift Handover` не позднее чем за 1 час до смены.

## 2. Процедура инцидент-менеджмента

1. **Детектирование** — автоматические алерты из Prometheus (`infra/helm/monitoring`) или ручной репорт в Slack `#bot-incidents`.
2. **Классификация** — on-call присваивает уровень (P1/P2/P3) и открывает тикет в Jira (проект `BOTOPS`).
3. **Ответственные:**
   - P1: Platform SRE (lead), Trading Tech (assists), Security Ops (при подозрении на инциденты безопасности).
   - P2: Trading Tech (lead), SRE on-call (assist).
   - P3: делегируется владельцу модуля (см. CODEOWNERS) с консультацией on-call.
4. **Коммуникации:** используйте шаблон поста в Slack `#bot-incidents` (см. `docs/templates/incident-update.md`, если недоступно — краткое описание, impact, ETA, next update).
5. **Устранение:**
   - Проверить логи через `kubectl logs` (см. раздел 3).
   - При необходимости запустить `infra/scripts/smoke-test.sh` для быстрой валидации после фикса.
   - Для отката используйте Helm rollback: `helm rollback bot-assist <revision>`.
6. **Пост-инцидент:**
   - В течение 24 часов оформить postmortem в Confluence `Trading Bot › Incidents`.
   - В Notion обновить чек-лист `Incident Follow-up`.

## 3. Доступ к логам и секретам

### 3.1 Логи
- **Staging:** `aws eks update-kubeconfig --name $STAGING_CLUSTER_NAME` → `kubectl logs deployment/bot-assist -n bot-assist --tail=200`.
- **Production:** требуется одобрение Security Ops; доступ предоставляется через AWS IAM роль `BotAssistProdReadOnly`. Запросите временные креды в Vault (`infra/secrets/README.md`).
- Журналы приложений ротируются через Fluent Bit; длительное хранение — S3 bucket `bot-assist-logs` с ретеншеном 30 дней.

### 3.2 Секреты
- Секреты хранятся в Vault, путь `kv/bot-assist/<env>`. Расшифровка через SOPS (`infra/secrets/README.md`).
- В GitHub Actions используются защищённые секреты (`AWS_ROLE_TO_ASSUME`, `SOPS_AGE_KEY`, и т.д.). Любые изменения согласуются с Security Ops.
- Для локального тестирования используйте `sops -d infra/secrets/secrets.enc.yaml > /tmp/secrets.yaml` и экспортируйте переменные вручную; запрещено коммитить расшифрованные файлы.

## 4. Тестирование и валидация

| Сценарий | Команда | Ответственные | Команда запуска |
| --- | --- | --- | --- |
| Regression suite (Vitest) | Trading Tech | @imelnik, @sprutkova | `npm test` |
| Integration smoke в staging | Platform SRE | @vlitvin | `infra/scripts/smoke-test.sh` |
| Рекомендательные подсказки | Trading Tech + Product Analysts | @sprutkova | `npm test -- recommendation` |
| Логирование и алерты | Security Ops | @mmatskevich | Проверка алертов в Grafana dashboards |

## 5. Фиксация в базе знаний

- **Confluence:**
  - `Trading Bot › Operations › Ops Runbook` — текущий документ (v2025-10-18), ссылка на Git commit.
  - `Trading Bot › Releases` — содержит ссылки на успешные деплои (`deploy_staging`/`deploy_production`).
- **Notion:**
  - База `Runbooks & Procedures` → страница `Hyperliquid Bot — Ops Runbook` синхронизирована и содержит список on-call.
  - База `Incident Tracker` обновлена шаблоном postmortem.

## 6. История согласований

| Дата | Команда | Представитель | Комментарий |
| --- | --- | --- | --- |
| 2025-10-18 | Trading Tech | Игорь Мельник | Подтвердил актуальность интеграций и smoke-тестов. |
| 2025-10-18 | Platform SRE | Владислав Литвин | Проверил процедуры логов/секретов, внёс примечание про Vault. |
| 2025-10-18 | Security Ops | Мария Мацкевич | Одобрила ротацию доступа и правила обращения с секретами. |

> Последующее обновление: планируется после внедрения canary-пайплайна (ноябрь 2025).
