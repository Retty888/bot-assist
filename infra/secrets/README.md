# Secrets Management Strategy

We use **HashiCorp Vault** as the system of record for runtime credentials and **Mozilla SOPS** for encrypting the minimal bootstrap data committed to Git.  All secret material is rotated automatically and surfaced to workloads via Kubernetes secrets.

## Components

- `vault/` policy definitions that scope the bot's access to API keys and wallets.
- `sops.yaml` configuration describing Age recipients for Git-encrypted files.
- `scripts/` automation helpers for rotating secrets and updating Kubernetes manifests.

## Bootstrap Data Flow

1. Vault tokens and AWS IAM roles are provisioned by Terraform.
2. Short-lived GitHub OIDC credentials authenticate the CI pipeline against Vault using the `jwt` auth method.
3. SOPS-encrypted configuration files store only non-sensitive defaults and per-environment toggles.  Sensitive data is referenced via Vault paths.

```
┌──────────────┐      login       ┌─────────────┐      dynamic creds      ┌──────────────────────────┐
│ GitHub CI/CD │ ───────────────▶ │ Vault (OIDC)│ ──────────────────────▶ │ Kubernetes Secret Syncer │
└──────────────┘                  └─────────────┘                          └──────────────────────────┘
```

## Files

- `sops.yaml` – project-wide SOPS configuration.
- `secrets.enc.yaml` – example encrypted config referencing Vault paths.
- `scripts/rotate_vault_secret.sh` – rotates a Vault secret and updates the SOPS file.

## Rotation Policy

- Trading API keys: rotate every 7 days (configurable via cron job hitting Vault's rotation endpoint).
- Slack webhooks and alert tokens: rotate every 30 days.
- Database credentials (if provisioned later): dynamic, TTL ≤ 1 hour.

### Rotation Workflow

1. Run `./infra/secrets/scripts/rotate_vault_secret.sh hvac/path secret_name`.
2. Script generates a new value, writes to Vault, and patches `secrets.enc.yaml` via SOPS.
3. GitHub Actions pipeline decrypts the file during deploy, updates Kubernetes secret manifests, and triggers a rolling restart.

## Local Usage

```
brew install sops age
export SOPS_AGE_KEY_FILE=~/.config/sops/age/keys.txt
sops --decrypt infra/secrets/secrets.enc.yaml
```

Ensure Age keys are stored in the company password manager.  Do **not** commit decrypted files.
