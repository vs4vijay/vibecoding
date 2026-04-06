# Future Data Source Integrations

This directory contains stub implementations for future data source integrations. These services are designed to be secure and use Azure Managed Identity (DefaultAzureCredential) wherever possible.

## Available Service Stubs

### 1. KustoService (`kustoService.ts`)
Query Azure Data Explorer (Kusto) for telemetry and analytics data.

**Installation:**
```bash
bun add @azure/kusto-data @azure/kusto-ingest
```

**Required Permissions:**
```bash
az role assignment create \
  --role "Contributor" \
  --assignee <managed-identity-principal-id> \
  --scope <kusto-cluster-resource-id>
```

**Usage:**
```typescript
import { KustoService } from './services/future/kustoService';

const kusto = new KustoService(
  'https://mycluster.region.kusto.windows.net',
  'MyDatabase'
);

const results = await kusto.executeQuery('MyTable | take 10');
```

### 2. AzureDevOpsService (`azureDevOpsService.ts`)
Query Azure DevOps for work items, builds, and pull requests.

**Installation:**
```bash
bun add azure-devops-node-api
```

**Authentication:**
Azure DevOps requires a Personal Access Token (PAT). Store it securely in Key Vault and retrieve using Managed Identity.

**Usage:**
```typescript
import { AzureDevOpsService } from './services/future/azureDevOpsService';
import { KeyVaultService } from './services/future/keyVaultService';

// Get PAT from Key Vault
const kv = new KeyVaultService('https://my-vault.vault.azure.net');
const pat = await kv.getSecret('azure-devops-pat');

// Use DevOps service
const devops = new AzureDevOpsService('myorg', 'myproject');
const workItems = await devops.searchWorkItems('bug');
```

### 3. KeyVaultService (`keyVaultService.ts`)
Securely retrieve secrets from Azure Key Vault using Managed Identity.

**Installation:**
```bash
bun add @azure/keyvault-secrets
```

**Required Permissions:**
```bash
az keyvault set-policy \
  --name <key-vault-name> \
  --object-id <managed-identity-principal-id> \
  --secret-permissions get list
```

**Usage:**
```typescript
import { KeyVaultService } from './services/future/keyVaultService';

const kvService = new KeyVaultService('https://my-vault.vault.azure.net');
const apiKey = await kvService.getSecret('third-party-api-key');
```

## Integration with Azure OpenAI Bot

To integrate these services with the bot, update `src/bot.ts`:

```typescript
import { KustoService } from './services/future/kustoService';
import { AzureDevOpsService } from './services/future/azureDevOpsService';
import { KeyVaultService } from './services/future/keyVaultService';

export class TeamsBot extends ActivityHandler {
  private kustoService?: KustoService;
  private devopsService?: AzureDevOpsService;
  
  constructor(
    azureOpenAIService: AzureOpenAIService,
    kustoService?: KustoService,
    devopsService?: AzureDevOpsService
  ) {
    super();
    this.kustoService = kustoService;
    this.devopsService = devopsService;
    
    // Handle user messages with data source queries
    this.onMessage(async (context, next) => {
      const userMessage = context.activity.text;
      
      // Detect intent (simple example)
      if (userMessage.includes('telemetry') && this.kustoService) {
        const data = await this.kustoService.queryTelemetry(
          new Date(Date.now() - 24 * 60 * 60 * 1000), // last 24h
          new Date()
        );
        await context.sendActivity(`Found ${data.length} telemetry events`);
      } else if (userMessage.includes('work item') && this.devopsService) {
        const items = await this.devopsService.searchWorkItems(userMessage);
        await context.sendActivity(`Found ${items.length} work items`);
      } else {
        // Default to OpenAI
        const response = await this.azureOpenAIService.getChatCompletion([
          { role: 'user', content: userMessage }
        ]);
        await context.sendActivity(response);
      }
      
      await next();
    });
  }
}
```

## Security Best Practices

1. **Always use DefaultAzureCredential** - Never hardcode credentials
2. **Store third-party API keys in Key Vault** - Retrieve using Managed Identity
3. **Use least privilege RBAC** - Grant only necessary permissions
4. **Validate and sanitize inputs** - Prevent injection attacks
5. **Log without sensitive data** - Don't log secrets or PII
6. **Implement rate limiting** - Protect against abuse
7. **Use private endpoints** - When available for data sources

## Advanced: Intent Detection

For production, consider using Azure Cognitive Services LUIS or GPT-4 for intent detection:

```typescript
async detectIntent(message: string): Promise<{
  intent: string;
  entities: any;
}> {
  const systemPrompt = `
    Analyze the user message and determine the intent:
    - "query_telemetry": User wants telemetry data
    - "query_devops": User wants work items, builds, or PRs
    - "general_question": General question for AI
    
    Return JSON: { "intent": "...", "entities": {...} }
  `;
  
  const response = await this.azureOpenAIService.getChatCompletion([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: message }
  ]);
  
  return JSON.parse(response);
}
```

## Testing

Create unit tests for each service:

```typescript
// Example test for KustoService
import { describe, it, expect } from 'bun:test';
import { KustoService } from './kustoService';

describe('KustoService', () => {
  it('should execute query successfully', async () => {
    const service = new KustoService('https://test.kusto.windows.net', 'TestDB');
    // Mock the query execution
    // Add assertions
  });
});
```

## Next Steps

1. Implement the service you need first (Kusto, DevOps, etc.)
2. Add proper error handling and retry logic
3. Create integration tests with actual Azure resources
4. Add monitoring and logging
5. Document API usage and limits
6. Implement caching for frequently accessed data
