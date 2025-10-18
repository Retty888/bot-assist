# Monitoring Stack

The monitoring stack installs the Prometheus Operator bundle (kube-prometheus-stack) and a standalone Grafana release.  The configuration files under this directory are referenced by Terraform during deployment.

## Key Features

- **Service scraping** – Prometheus scrapes the bot's `/metrics` endpoint and records latency/error metrics.
- **Alerting** – Alertmanager uses a Slack webhook (stored in Vault) to notify on threshold breaches.
- **Dashboards** – Grafana dashboards are stored as ConfigMaps and loaded automatically.

## Files

- `values-<env>.yaml` – Prometheus tuning per environment.
- `grafana-values-<env>.yaml` – Grafana ingress and data source definitions.
- `templates/dashboards-configmap.yaml` – JSON dashboards consumed by Grafana.

To add new alerts, edit the Prometheus rules in the values file; Alertmanager routes are defined via the `alertmanager.alertmanagerSpec` block.
