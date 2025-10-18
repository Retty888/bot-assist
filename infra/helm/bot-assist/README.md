# Bot Assist Helm Chart

This chart deploys the Hyperliquid trading bot and exposes readiness/liveness probes that feed into Kubernetes and Prometheus alerting.

## Values

- `image.repository` / `image.tag` – injected automatically by Terraform during CI/CD.
- `env` – static environment variables applied to the container.
- `alerting.*` – thresholds surfaced via ConfigMap and consumed by Prometheus rules.

Secrets are sourced from `bot-assist-shared-secrets`, which is created from the SOPS-managed manifest in `infra/secrets`.
