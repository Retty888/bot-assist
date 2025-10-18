variable "aws_region" {
  type        = string
  description = "AWS region for all resources"
}

variable "cluster_name" {
  type        = string
  description = "EKS cluster name"
}

variable "kubernetes_version" {
  type        = string
  description = "Kubernetes version for the EKS control plane"
  default     = "1.29"
}

variable "vpc_id" {
  type        = string
  description = "Existing VPC ID where the cluster is provisioned"
}

variable "private_subnet_ids" {
  type        = list(string)
  description = "Private subnet IDs for node groups"
}

variable "node_instance_type" {
  type        = string
  description = "Instance type for managed node group"
  default     = "m6i.large"
}

variable "node_desired_capacity" {
  type        = number
  description = "Desired number of nodes"
  default     = 2
}

variable "node_min_capacity" {
  type        = number
  description = "Minimum number of nodes"
  default     = 1
}

variable "node_max_capacity" {
  type        = number
  description = "Maximum number of nodes"
  default     = 4
}

variable "namespace" {
  type        = string
  description = "Kubernetes namespace for application"
  default     = "bot-assist"
}

variable "bot_assist_chart_version" {
  type        = string
  description = "Helm chart version for the application"
  default     = "0.1.0"
}

variable "image_repository" {
  type        = string
  description = "Container image repository"
  default     = "ghcr.io/example/bot-assist"
}

variable "image_tag" {
  type        = string
  description = "Container image tag to deploy"
  default     = "latest"
}

variable "app_secret_payload" {
  type        = string
  description = "Opaque secret payload injected into the application"
  sensitive   = true
}

variable "monitoring_namespace" {
  type        = string
  description = "Namespace for monitoring stack"
  default     = "monitoring"
}

variable "enable_slack_alerts" {
  type        = bool
  description = "Enable Slack alertmanager notifications"
  default     = true
}

variable "slack_webhook_secret_name" {
  type        = string
  description = "Kubernetes secret storing the Slack webhook URL"
  default     = "slack-alert-webhook"
}
