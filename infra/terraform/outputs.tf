output "cluster_endpoint" {
  value       = data.aws_eks_cluster.this.endpoint
  description = "EKS API server endpoint"
}

output "cluster_ca" {
  value       = data.aws_eks_cluster.this.certificate_authority[0].data
  description = "EKS cluster CA cert"
}

output "cluster_name" {
  value       = module.eks.cluster_name
  description = "EKS cluster name"
}
