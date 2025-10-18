#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "Usage: $0 <vault_path> <field>" >&2
  exit 1
fi

VAULT_PATH="$1"
FIELD="$2"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

if [[ -z "${VAULT_ADDR:-}" ]]; then
  echo "VAULT_ADDR is not set" >&2
  exit 1
fi

if [[ -z "${VAULT_TOKEN:-}" ]]; then
  echo "VAULT_TOKEN is not set" >&2
  exit 1
fi

# Generate a random 64 byte secret by default
NEW_SECRET=$(openssl rand -base64 48)

vault kv put "$VAULT_PATH" "$FIELD=$NEW_SECRET"

echo "Secret rotated at $VAULT_PATH::$FIELD"

echo "Patching SOPS file..."
sops --set "[\"data\"][\"${FIELD^^}\"] \"$(printf '%s' "$NEW_SECRET" | base64)\"" infra/secrets/secrets.enc.yaml

echo "Rotation complete"
