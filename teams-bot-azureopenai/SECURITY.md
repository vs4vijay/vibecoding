# Security Configuration

This document outlines the security architecture and best practices for the Teams Bot.

## Authentication & Authorization

### 1. Azure OpenAI Access

**Production (Recommended):**
- Uses **DefaultAzureCredential** which automatically uses Managed Identity
- No API keys stored in code or configuration
- RBAC-based access control

**Required Role Assignment:**
```bash
az role assignment create \
  --role "Cognitive Services OpenAI User" \
  --assignee-object-id <managed-identity-object-id> \
  --scope /subscriptions/<sub>/resourceGroups/<rg>/providers/Microsoft.CognitiveServices/accounts/<openai-name>
```

**Local Development:**
- Temporarily use API key via `.env` file (never commit!)
- Or use Azure CLI authentication: `az login`

### 2. Bot Authentication

The bot uses Azure Bot Service authentication with:
- Microsoft App ID (not a secret)
- Managed Identity for authentication (production)
- App Password only for local development

### 3. Credential Chain

DefaultAzureCredential tries credentials in this order:
1. Environment variables (EnvironmentCredential)
2. Managed Identity (ManagedIdentityCredential) ← **Production**
3. Azure CLI (AzureCliCredential) ← **Local dev**
4. Azure PowerShell (AzurePowerShellCredential)
5. Interactive browser (InteractiveBrowserCredential)

## Security Features

### ✅ Implemented

1. **No Hardcoded Secrets**: All sensitive data via environment variables or Managed Identity
2. **Managed Identity**: DefaultAzureCredential for Azure resource access
3. **HTTPS Only**: Configure HTTPS_ONLY=true on Azure App Service
4. **Input Validation**: Bot Framework validates messages
5. **Error Handling**: Prevents information leakage in error messages
6. **Conversation Isolation**: Each conversation has separate history

### 🔄 Recommended Enhancements

1. **Rate Limiting**: Add rate limiting per user/conversation
2. **Content Filtering**: Use Azure OpenAI content filters
3. **Audit Logging**: Log all interactions (excluding PII)
4. **Data Encryption**: Enable encryption at rest for any stored data
5. **Network Security**: Use Private Endpoints for Azure resources

## Environment Variables

### Required (Production)
```bash
MICROSOFT_APP_ID=<app-id>              # Not a secret
MICROSOFT_APP_TYPE=MultiTenant
AZURE_OPENAI_ENDPOINT=<endpoint-url>   # Not a secret
AZURE_OPENAI_DEPLOYMENT_NAME=<name>    # Not a secret
```

### Optional (Local Development Only)
```bash
MICROSOFT_APP_PASSWORD=<password>       # DO NOT COMMIT
AZURE_OPENAI_API_KEY=<api-key>         # DO NOT COMMIT
```

## Azure App Service Configuration

### Enable Managed Identity
```bash
az webapp identity assign \
  --name <app-name> \
  --resource-group <rg-name>
```

### Configure App Settings (No Secrets!)
```bash
az webapp config appsettings set \
  --name <app-name> \
  --resource-group <rg-name> \
  --settings \
    MICROSOFT_APP_ID=<app-id> \
    MICROSOFT_APP_TYPE=MultiTenant \
    AZURE_OPENAI_ENDPOINT=<endpoint> \
    AZURE_OPENAI_DEPLOYMENT_NAME=<deployment> \
    WEBSITES_ENABLE_APP_SERVICE_STORAGE=false \
    WEBSITES_PORT=3978
```

### Enable HTTPS Only
```bash
az webapp update \
  --name <app-name> \
  --resource-group <rg-name> \
  --https-only true
```

## Compliance Considerations

### Data Privacy
- **PII Handling**: Do not log user messages containing PII
- **Data Retention**: Implement conversation history cleanup
- **GDPR**: Provide user data deletion capability

### Audit Requirements
- Log all API calls (without sensitive data)
- Monitor authentication failures
- Track Azure OpenAI usage and costs

## Secret Rotation

### API Keys (If Used for Dev)
1. Never commit to source control
2. Store in Azure Key Vault
3. Rotate every 90 days
4. Use separate keys for dev/prod

### Managed Identity (Production)
- No rotation needed
- RBAC permissions managed via Azure AD
- Audit via Azure Activity Log

## Network Security

### Recommended Configuration
```bash
# Restrict bot endpoint to Teams service IPs
az webapp config access-restriction add \
  --name <app-name> \
  --resource-group <rg-name> \
  --rule-name AllowTeams \
  --priority 100 \
  --service-tag AzureCloud

# Enable Private Endpoint for OpenAI
az network private-endpoint create \
  --name openai-pe \
  --resource-group <rg-name> \
  --vnet-name <vnet> \
  --subnet <subnet> \
  --private-connection-resource-id <openai-id> \
  --group-id account \
  --connection-name openai-connection
```

## Monitoring & Alerting

### Key Metrics to Monitor
1. Authentication failures
2. Azure OpenAI API errors
3. Rate limit violations
4. Unusual conversation patterns
5. Cost anomalies

### Recommended Alerts
```bash
# High error rate
az monitor metrics alert create \
  --name high-error-rate \
  --resource-group <rg> \
  --scopes <app-id> \
  --condition "avg Percentage HTTP Server Errors > 5" \
  --window-size 5m

# OpenAI quota usage
az monitor metrics alert create \
  --name openai-quota-alert \
  --resource-group <rg> \
  --scopes <openai-id> \
  --condition "total TokenTransactions > 90000" \
  --window-size 1h
```

## Incident Response

### If Credentials are Compromised
1. **Immediate**: Revoke/rotate the credential
2. **Review**: Check audit logs for unauthorized access
3. **Update**: Deploy new credentials
4. **Document**: Log incident and response

### If Bot is Compromised
1. Stop the App Service
2. Review recent deployments and changes
3. Check for malicious code injection
4. Rotate all credentials
5. Redeploy from verified source

## Compliance Checklist

- [ ] Managed Identity enabled in production
- [ ] No secrets in source code or config files
- [ ] HTTPS-only enabled
- [ ] RBAC configured with least privilege
- [ ] Logging enabled (without PII)
- [ ] Error messages don't leak information
- [ ] Rate limiting implemented
- [ ] Content filtering enabled
- [ ] Regular security reviews scheduled
- [ ] Incident response plan documented
