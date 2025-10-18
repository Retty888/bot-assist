#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${KUBECONFIG:-}" ]]; then
  echo "[smoke-test] KUBECONFIG is not set. Provide a kubeconfig context before running." >&2
  exit 1
fi

namespace=${SMOKE_NAMESPACE:-bot-assist}
release=${SMOKE_RELEASE:-bot-assist}
endpoint=${SMOKE_ENDPOINT:-http://127.0.0.1:8080/readyz}

pod=$(kubectl get pods -n "$namespace" -l "app.kubernetes.io/instance=$release" -o jsonpath='{.items[0].metadata.name}')

echo "[smoke-test] checking $endpoint via pod $pod"

kubectl exec -n "$namespace" "$pod" -- node -e "
  const url = process.argv[1];
  fetch(url)
    .then((res) => {
      if (!res.ok) {
        console.error(`[smoke-test] ${'$'}{url} returned status ${'$'}{res.status}`);
        process.exit(1);
      }
      return res.text();
    })
    .then((body) => {
      console.log('[smoke-test] success');
      if (body?.length) {
        console.log(body.slice(0, 256));
      }
    })
    .catch((error) => {
      console.error('[smoke-test] request failed', error);
      process.exit(1);
    });
" "$endpoint"

