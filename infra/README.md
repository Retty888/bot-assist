# Infrastructure Overview

This repository provisions and operates the Hyperliquid signal bot using **GitHub Actions**, **Terraform**, and **Helm** on top of an **AWS EKS** Kubernetes cluster.  Supporting services—observability, secret management, and deployment automation—are codified under `infra/`.

> ℹ️ Последнее обновление: 2025-10-18. Добавлены сведения о конвейерах, интеграционных тестах и синхронизации с базой знаний.

## Stack Summary

| Concern | Tooling |
| --- | --- |
| Continuous integration & delivery | GitHub Actions (`.github/workflows/ci-cd.yml`) — jobs `lint_test`, `build_and_publish`, `deploy_staging`, `deploy_production` |
| Infrastructure as Code | Terraform (`infra/terraform`) targeting AWS (EKS, ECR, VPC) |
| Application deployment | Helm chart (`infra/helm/bot-assist`) installed via GitHub Actions |
| Secrets management | HashiCorp Vault with SOPS for Git encryption (`infra/secrets`) |
| Observability | Prometheus Operator & Grafana deployed via Helm (`infra/helm/monitoring`) |
| Testing automation | Vitest suites under `tests/` (unit, integration, contract) executed in CI |

### Environments

Two long-lived environments are defined:

- **staging** – continuous deployment after automated checks, requires approval before promotion.
- **production** – promoted from staging, always requires manual approval and enforces GitHub protected environments.

State isolation is provided through per-environment Terraform workspaces and Helm values files (`values-staging.yaml`, `values-production.yaml`).

## Directory Layout

```
infra/
├── helm/
│   ├── bot-assist/          # Application Helm chart
│   └── monitoring/          # Prometheus & Grafana configuration
├── secrets/                 # Vault + SOPS policies, automation scripts
└── terraform/               # Terraform root module and tfvars per environment
```

## Deployment Flow

1. GitHub Actions validates commits (`lint`, `test`, `build`).
2. The `build_and_publish` job uploads a distributable artifact and publishes an OCI image to GHCR.
3. On pushes to `main`, the workflow plans Terraform changes, waits for approval, then applies to **staging**.
4. Helm deploys the application and monitoring stack onto the target cluster using SOPS-decrypted values.
5. After verification and smoke tests, production deployment awaits manual approval before applying.

Detailed runbooks live alongside the configuration files in each subdirectory.

## Интеграции и поток данных

| Интеграция | Назначение | Точки конфигурации |
| --- | --- | --- |
| Hyperliquid Signal API | Получение сигналов и маркет-данных через `HyperliquidSignalClient` и `HyperliquidMarketClient`. | `src/services/integrations/hyperliquid/`, `src/runtime/botRuntime.ts`, `src/config/configManager.ts`. |
| Recommendation Insights | Контекстные подсказки для операторов (`src/insights/recommendationService.ts`) — результаты публикуются в UI и логах. | `src/insights/`, `tests/recommendationServiceAdaptive.test.ts`. |
| Risk/Compliance hooks | Применение IRSA и пространств имён для разграничения доступа к логам и секретам. | `infra/terraform/main.tf` (модуль `eks` с `enable_irsa`), `infra/terraform/variables.tf` (секреты), `infra/scripts/smoke-test.sh` (read-only запуск). |

## CI/CD пайплайны

- **Lint & Test (`lint_test`)** — запускает `npm ci`, `npm run lint`, `npm test`. Любой сбой блокирует остальные стадии.
- **Build & Publish (`build_and_publish`)** — пакует `dist/`, публикует артефакт и контейнер (`ghcr.io/<repo>:<sha>`). Результат используется Terraform как переменная `image_tag`.
- **Deploy to Staging (`deploy_staging`)** — применяет Terraform workspace `staging`, выполняет Helm upgrade и прогоняет smoke-тест `infra/scripts/smoke-test.sh` (HTTP-проверка `/readyz` внутри пода).
- **Deploy to Production (`deploy_production`)** — повторяет процедуру для workspace `production` после ручного одобрения и успешного smoke-теста в staging.

### Мониторинг пайплайнов
- Отслеживайте прогресс в GitHub Actions (checks `lint_test`, `build_and_publish`, `deploy_staging`, `deploy_production`).
- После шага `Export deployment metadata` урл релиза сохраняется вручную в Confluence (`Trading Bot › Releases`).

## Тестовый контур

| Тип теста | Покрываемые модули | Как запустить локально |
| --- | --- | --- |
| Unit | `src/trading/tradeSignalParser.ts`, `src/services/signalAdviser` | `npm test -- tradeSignalParser` |
| Integration | Hyperliquid клиенты и runtime (`tests/hyperliquidIntegration.test.ts`, `tests/hyperliquidBot.test.ts`) | `npm test -- hyperliquid` |
| Recommendation | Подсказки и адаптивные сценарии (`tests/recommendationServiceAdaptive.test.ts`) | `npm test -- recommendation` |
| API smoke | REST-endpoints из `src/server.ts` (используется Supertest) | `npm test -- hintsApi` |

> 💡 В CI интеграционные тесты выполняются с моками сетевых вызовов; для e2e проверок используется staging-кластер через smoke-скрипт из `infra/scripts`.

## Ссылки на базы знаний

- Confluence: `Trading Bot › Operations › CI/CD Pipelines` — обновлено 2025-10-18.
- Notion: база `Runbooks & Procedures` → страница `Deployment Flow`, синхронизирована с настоящим README.

## Required GitHub Secrets

| Secret | Purpose |
| --- | --- |
| `AWS_ROLE_TO_ASSUME` | IAM role ARN granting Terraform access to AWS resources |
| `AWS_REGION` | Default AWS region for all operations |
| `TF_STATE_BUCKET` | S3 bucket storing Terraform remote state |
| `TF_LOCK_TABLE` | DynamoDB table for Terraform state locking |
| `STAGING_CLUSTER_NAME` | Name of the staging EKS cluster |
| `PRODUCTION_CLUSTER_NAME` | Name of the production EKS cluster |
| `SOPS_AGE_KEY` | Age private key used to decrypt SOPS files |

Populate protected environments (`staging`, `production`) with approval rules to enforce manual gates before deployment jobs run.
