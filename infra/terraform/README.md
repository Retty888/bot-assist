# Terraform Deployment Guide

This module provisions AWS infrastructure and deploys the bot via Helm.  It is invoked by GitHub Actions but can also be run locally for debugging.

## Prerequisites

- Terraform >= 1.6
- AWS IAM role with EKS, VPC, and S3 privileges
- SOPS + Age key to decrypt `infra/secrets/secrets.enc.yaml`
- Helm CLI (installed automatically in CI)

## Workspaces

Each environment maps to a Terraform workspace:

```
terraform workspace new staging
terraform workspace new production
```

Remote state is stored in an S3 bucket defined at init time.

## Local Plan / Apply

```bash
cd infra/terraform
terraform init \
  -backend-config="bucket=<state-bucket>" \
  -backend-config="dynamodb_table=<lock-table>" \
  -backend-config="key=bot-assist/staging/terraform.tfstate" \
  -backend-config="region=<aws-region>" \
  -backend-config="encrypt=true"
terraform workspace select staging
terraform plan -var-file=environments/staging.tfvars -var="image_tag=$(git rev-parse HEAD)" \
  -var="app_secret_payload=$(sops --decrypt --extract '["data"]["SECRET_CONFIG"]' ../secrets/secrets.enc.yaml)"
```

Use `terraform apply` after reviewing the plan.

## Outputs

- `cluster_endpoint` – API server endpoint for kubectl.
- `cluster_ca` – Base64 encoded certificate authority data.
- `cluster_name` – Name of the created EKS cluster.
