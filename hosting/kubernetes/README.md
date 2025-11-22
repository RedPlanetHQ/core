# CORE Kubernetes Deployment

This directory contains Kubernetes manifests for deploying the RedPlanetHQ CORE system on Kubernetes.

## Prerequisites

- Kubernetes cluster (v1.20+)
- kubectl configured to connect to your cluster
- Sufficient storage for persistent volumes
- Ingress controller (nginx recommended)

## Configuration

### 1. Update Secrets

Edit `secrets.yaml` and replace the placeholder values with your actual credentials:

```bash
# Base64 encode your values
echo -n "your-openai-api-key" | base64
echo -n "your-google-client-id" | base64
echo -n "your-google-client-secret" | base64
echo -n "your-anthropic-api-key" | base64
```

Update the following keys in `secrets.yaml`:
- `OPENAI_API_KEY` (if using OpenAI)
- `AUTH_GOOGLE_CLIENT_ID` (if using Google OAuth)
- `AUTH_GOOGLE_CLIENT_SECRET` (if using Google OAuth)
- `ANTHROPIC_API_KEY` (if using Claude/Anthropic)
- `RESEND_API_KEY` (if using Resend for emails)
- `COHERE_API_KEY` (if using Cohere)
- `AWS_ACCESS_KEY_ID` (if using AWS Bedrock)
- `AWS_SECRET_ACCESS_KEY` (if using AWS Bedrock)
- Email configuration values

### 2. Update Ingress

Edit `ingress.yaml` and replace the example hosts with your actual domain names:
- `core.example.com` → your CORE domain
- `trigger.example.com` → your Trigger.dev domain

### 3. Configure AI Provider

To use Claude/Anthropic instead of OpenAI, update the `MODEL` value in `configmap.yaml`:

```yaml
MODEL: "claude-3-5-haiku-20241022"  # or another Claude model
```

### 4. Storage Configuration

The manifests use the default storage class. If you need to specify a different storage class, uncomment and update the `storageClassName` fields in the StatefulSet manifests.

## Deployment Steps

### Option 1: Using Kustomize (Recommended)

The easiest way to deploy all components is using Kustomize:

```bash
# 1. Update your secrets first
# Edit secrets.yaml with your actual API keys and credentials

# 2. Deploy everything
kubectl apply -k .

# 3. Check deployment status
kubectl get pods -n RedPlanetHQcore
```

### Option 2: Manual Deployment

If you prefer to deploy manually, follow these steps in order:

```bash
# 1. Create namespace (optional)
kubectl create namespace RedPlanetHQcore

# 2. Deploy configuration and secrets
kubectl apply -f configmap.yaml
kubectl apply -f secrets.yaml
kubectl apply -f clickhouse-configmap.yaml

# 3. Deploy persistent volumes
kubectl apply -f persistent-volume-claims.yaml

# 4. Deploy databases (StatefulSets)
kubectl apply -f postgres-statefulset.yaml
kubectl apply -f neo4j-statefulset.yaml
kubectl apply -f clickhouse-statefulset.yaml

# 5. Deploy supporting services
kubectl apply -f redis-deployment.yaml

# 6. Deploy services
kubectl apply -f services.yaml

# 7. Deploy init job
kubectl apply -f trigger-init-deployment.yaml

# 8. Deploy applications
kubectl apply -f trigger-electric-deployment.yaml
kubectl apply -f trigger-webapp-deployment.yaml
kubectl apply -f trigger-supervisor-deployment.yaml
kubectl apply -f core-deployment.yaml

# 9. Deploy ingress (last)
kubectl apply -f ingress.yaml
```

### 3. Verify Deployment

Check that all pods are running:

```bash
kubectl get pods -n RedPlanetHQcore
```

Check services:

```bash
kubectl get services -n RedPlanetHQcore
```

Check ingress:

```bash
kubectl get ingress -n RedPlanetHQcore
```

## Accessing the Applications

- CORE application: http://core.example.com (or your configured domain)
- Trigger.dev: http://trigger.example.com (or your configured domain)

## Monitoring and Logs

View logs for a specific component:

```bash
# CORE application
kubectl logs -n RedPlanetHQcore deployment/core-app -f

# PostgreSQL
kubectl logs -n RedPlanetHQcore statefulset/postgres -f

# Neo4j
kubectl logs -n RedPlanetHQcore statefulset/neo4j -f
```

## Scaling

### Horizontal Scaling

Scale the CORE application:

```bash
kubectl scale deployment core-app --replicas=3 -n RedPlanetHQcore
```

### Resource Limits

Adjust resource limits in the deployment manifests based on your cluster capacity and usage patterns.

## Troubleshooting

### Common Issues

1. **Pods stuck in Pending state**
   - Check if there's enough storage available
   - Verify the storage class is available in your cluster

2. **Database connection errors**
   - Ensure databases are fully started before applications
   - Check service names and ports in the configuration

3. **Ingress not working**
   - Verify the ingress controller is installed and running
   - Check the ingress controller logs for errors

### Resetting the Deployment

To completely remove the deployment:

```bash
kubectl delete -f . -n RedPlanetHQcore
```

## Backup and Recovery

### Database Backups

For PostgreSQL:
```bash
kubectl exec -n RedPlanetHQcore postgres-0 -- pg_dump -U docker core > backup.sql
```

For Neo4j:
```bash
kubectl exec -n RedPlanetHQcore neo4j-0 -- neo4j-admin dump --database=neo4j --to=/backup/neo4j.dump
```

### Recovery

Restore PostgreSQL:
```bash
kubectl exec -i -n RedPlanetHQcore postgres-0 -- psql -U docker core < backup.sql
```

## Security Considerations

1. **Network Policies**: Consider adding network policies to restrict traffic between components
2. **RBAC**: Implement proper role-based access control
3. **Secrets Management**: Use a proper secrets management solution in production
4. **TLS**: Enable TLS for all external communications

## Customization

### Environment Variables

Add or modify environment variables in the respective deployment manifests or in the `configmap.yaml`.

### Storage

Adjust the storage sizes in the `persistent-volume-claims.yaml` based on your needs.

### AI Provider Configuration

To use different AI providers or models, update the relevant environment variables in `configmap.yaml` and add the required API keys to `secrets.yaml`.

## Support

For issues related to:
- CORE application: Check the [CORE documentation](https://docs.heysol.ai)
- Kubernetes: Refer to the [Kubernetes documentation](https://kubernetes.io/docs/)
- Specific components: Check their respective documentation