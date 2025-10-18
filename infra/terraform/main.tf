terraform {
  required_version = ">= 1.6.0"

  backend "s3" {}

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.51"
    }
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 2.30"
    }
    helm = {
      source  = "hashicorp/helm"
      version = "~> 2.12"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

module "eks" {
  source  = "terraform-aws-modules/eks/aws"
  version = "~> 20.8"

  cluster_name    = var.cluster_name
  cluster_version = var.kubernetes_version
  subnet_ids      = var.private_subnet_ids
  vpc_id          = var.vpc_id

  eks_managed_node_groups = {
    default = {
      instance_types = [var.node_instance_type]
      desired_size   = var.node_desired_capacity
      min_size       = var.node_min_capacity
      max_size       = var.node_max_capacity
      capacity_type  = "ON_DEMAND"
    }
  }

  enable_irsa = true
}

data "aws_eks_cluster" "this" {
  name = module.eks.cluster_name
}

data "aws_eks_cluster_auth" "this" {
  name = module.eks.cluster_name
}

provider "kubernetes" {
  host                   = data.aws_eks_cluster.this.endpoint
  cluster_ca_certificate = base64decode(data.aws_eks_cluster.this.certificate_authority[0].data)
  token                  = data.aws_eks_cluster_auth.this.token
}

provider "helm" {
  kubernetes {
    host                   = data.aws_eks_cluster.this.endpoint
    cluster_ca_certificate = base64decode(data.aws_eks_cluster.this.certificate_authority[0].data)
    token                  = data.aws_eks_cluster_auth.this.token
  }
}

resource "kubernetes_namespace" "bot_assist" {
  metadata {
    name = var.namespace
  }
}

resource "helm_release" "bot_assist" {
  name       = "bot-assist"
  repository = "file://${path.module}/../helm/bot-assist"
  chart      = "bot-assist"
  namespace  = kubernetes_namespace.bot_assist.metadata[0].name
  version    = var.bot_assist_chart_version

  values = [
    file("${path.module}/../helm/bot-assist/values-${terraform.workspace}.yaml")
  ]

  set {
    name  = "image.repository"
    value = var.image_repository
  }

  set {
    name  = "image.tag"
    value = var.image_tag
  }

  set_sensitive {
    name  = "env.SECRET_CONFIG"
    value = var.app_secret_payload
  }
}

module "monitoring" {
  source = "./modules/monitoring"

  namespace                 = var.monitoring_namespace
  workspace                 = terraform.workspace
  prometheus_values_file    = "${path.module}/../helm/monitoring/values-${terraform.workspace}.yaml"
  grafana_values_file       = "${path.module}/../helm/monitoring/grafana-values-${terraform.workspace}.yaml"
  enable_slack_alerts       = var.enable_slack_alerts
  slack_webhook_secret_name = var.slack_webhook_secret_name
}
