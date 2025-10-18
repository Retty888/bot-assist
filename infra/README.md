# Infrastructure Overview

This repository provisions and operates the Hyperliquid signal bot using **GitHub Actions**, **Terraform**, and **Helm** on top of an **AWS EKS** Kubernetes cluster.  Supporting services—observability, secret management, and deployment automation—are codified under `infra/`.

## Stack Summary

| Concern | Tooling |
| --- | --- |
| Continuous integration & delivery | GitHub Actions (`.github/workflows/ci-cd.yml`) |
| Infrastructure as Code | Terraform (`infra/terraform`) targeting AWS (EKS, ECR, VPC) |
| Application deployment | Helm chart (`infra/helm/bot-assist`) installed via GitHub Actions |
| Secrets management | HashiCorp Vault with SOPS for Git encryption (`infra/secrets`) |
| Observability | Prometheus Operator & Grafana deployed via Helm (`infra/helm/monitoring`) |

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
2. On pushes to `main`, the workflow plans Terraform changes, waits for approval, then applies to **staging**.
3. Helm deploys the application and monitoring stack onto the target cluster using SOPS-decrypted values.
4. After verification, production deployment awaits manual approval before applying.

Detailed runbooks live alongside the configuration files in each subdirectory.

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
