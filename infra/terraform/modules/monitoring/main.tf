variable "namespace" {
  type        = string
  description = "Namespace for monitoring stack"
}

variable "workspace" {
  type        = string
  description = "Terraform workspace name"
}

variable "prometheus_values_file" {
  type        = string
  description = "Path to Prometheus Helm values file"
}

variable "grafana_values_file" {
  type        = string
  description = "Path to Grafana Helm values file"
}

variable "enable_slack_alerts" {
  type        = bool
  description = "Toggle Slack alerts"
  default     = false
}

variable "slack_webhook_secret_name" {
  type        = string
  description = "Kubernetes secret name containing the Slack webhook URL"
  default     = ""
}

locals {
  grafana_alert_mounts = var.enable_slack_alerts ? [
    {
      name  = "extraSecretMounts[0].name"
      value = "slack-webhook"
    },
    {
      name  = "extraSecretMounts[0].secretName"
      value = var.slack_webhook_secret_name
    },
    {
      name  = "extraSecretMounts[0].mountPath"
      value = "/etc/alerts"
    },
    {
      name  = "extraSecretMounts[0].readOnly"
      value = true
    }
  ] : []
}

resource "kubernetes_namespace" "monitoring" {
  metadata {
    name = var.namespace
  }
}

resource "helm_release" "prometheus" {
  name       = "kube-prometheus-stack"
  repository = "https://prometheus-community.github.io/helm-charts"
  chart      = "kube-prometheus-stack"
  namespace  = kubernetes_namespace.monitoring.metadata[0].name
  version    = "62.3.0"

  values = [
    file(var.prometheus_values_file)
  ]
}

resource "helm_release" "grafana_dashboards" {
  name       = "bot-assist-grafana"
  repository = "https://grafana.github.io/helm-charts"
  chart      = "grafana"
  namespace  = kubernetes_namespace.monitoring.metadata[0].name
  version    = "7.3.9"

  values = [
    file(var.grafana_values_file)
  ]

  dynamic "set" {
    for_each = { for idx, cfg in local.grafana_alert_mounts : idx => cfg }
    content {
      name  = set.value.name
      value = set.value.value
    }
  }

  depends_on = [helm_release.prometheus]
}
