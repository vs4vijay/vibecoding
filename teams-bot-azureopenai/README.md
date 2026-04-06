# Teams Bot with Azure OpenAI Integration

A secure Microsoft Teams bot that integrates with Azure OpenAI to provide intelligent chat responses. Built with security-first approach using **DefaultAzureCredential** (Managed Identity) instead of API keys.

## Features

- 🔐 **Secure by Design**: Uses DefaultAzureCredential (Managed Identity) - no hardcoded secrets
- 💬 **Conversational AI**: Powered by Azure OpenAI with conversation history
- 🔄 **Extensible Architecture**: Ready to integrate with multiple data sources:
  - Azure Data Explorer (Kusto)
  - Azure DevOps
  - Telemetry systems
  - Custom data sources
- 🚀 **Production Ready**: Built with TypeScript and Bun runtime

## Architecture

```
┌─────────────┐
│ Teams User  │
└──────┬──────┘
       │
       ▼
┌─────────────────┐
│   Teams Bot     │
│  (Bot Service)  │
└────────┬────────┘
         │
         ▼
┌─────────────────────┐
│  Azure OpenAI       │
│ (Managed Identity)  │
└─────────────────────┘
```

## Prerequisites

- [Bun](https://bun.sh/) installed
- Azure subscription
- Azure OpenAI resource with a deployed model
- Bot registered in Azure Bot Service
- Managed Identity enabled on your hosting service (App Service, Container Apps, etc.)

## Setup

### 1. Install Dependencies

```bash
bun install
```

### 2. Configure Environment Variables

Copy `.env.example` to `.env` and fill in the values:

```bash
cp .env.example .env
```

### 3. Azure Configuration

#### For Production (Recommended - No Secrets):

1. **Enable Managed Identity** on your Azure App Service or Container App
2. **Grant Permissions** to the Managed Identity:
   ```bash
   # Assign "Cognitive Services OpenAI User" role to your Managed Identity
   az role assignment create \
     --role "Cognitive Services OpenAI User" \
     --assignee <managed-identity-principal-id> \
     --scope /subscriptions/<sub-id>/resourceGroups/<rg>/providers/Microsoft.CognitiveServices/accounts/<openai-resource>
   ```
3. **Remove** `AZURE_OPENAI_API_KEY` from your environment variables
4. The bot will automatically use DefaultAzureCredential

#### For Local Development:

Use API key temporarily:
```bash
AZURE_OPENAI_API_KEY=your-key-here
```

### 4. Register Your Bot

1. Create a Bot in [Azure Bot Service](https://portal.azure.com)
2. Get the App ID and configure in `.env`
3. For local testing, use [Bot Framework Emulator](https://github.com/Microsoft/BotFramework-Emulator)

## Running the Bot

### Development Mode

```bash
bun run src/index.ts
```

### Production Build

Deploy to Azure App Service or Container Apps with Managed Identity enabled.

## Deployment

### Azure App Service

```bash
# Deploy using Azure CLI
az webapp up --name <your-bot-name> --resource-group <your-rg>

# Enable Managed Identity
az webapp identity assign --name <your-bot-name> --resource-group <your-rg>

# Configure environment variables in Azure Portal or CLI
az webapp config appsettings set --name <your-bot-name> \
  --resource-group <your-rg> \
  --settings AZURE_OPENAI_ENDPOINT=https://your-openai.openai.azure.com/ \
             AZURE_OPENAI_DEPLOYMENT_NAME=your-deployment \
             MICROSOFT_APP_ID=your-app-id \
             MICROSOFT_APP_TYPE=MultiTenant
```

## Security Best Practices

✅ **DO**:
- Use Managed Identity (DefaultAzureCredential) in production
- Use Azure Key Vault for any sensitive configuration
- Enable Azure AD authentication for all services
- Use RBAC for access control
- Keep dependencies updated

❌ **DON'T**:
- Hardcode API keys or secrets
- Commit `.env` files to source control
- Use service principal credentials when Managed Identity is available
- Expose endpoints without authentication

## Future Enhancements

The bot is designed to be extended with additional data sources:

```typescript
// Example: Add Kusto integration
import { KustoService } from './services/kustoService';

// Example: Add Azure DevOps integration  
import { AzureDevOpsService } from './services/azureDevOpsService';
```

## Project Structure

```
teams-bot-azureopenai/
├── src/
│   ├── index.ts              # Entry point and server setup
│   ├── bot.ts                # Bot logic and message handling
│   └── services/
│       └── azureOpenAIService.ts  # Azure OpenAI integration
├── .env.example              # Environment template
├── .gitignore
├── package.json
├── tsconfig.json
└── README.md
```

## Troubleshooting

### Bot not responding
- Check if the bot endpoint is accessible
- Verify Bot Service configuration in Azure Portal
- Check application logs

### Azure OpenAI errors
- Verify Managed Identity has proper RBAC permissions
- Check OpenAI endpoint and deployment name
- Ensure deployment model supports chat completions

### Authentication failures
- Verify Microsoft App ID and Tenant ID
- Check Bot Framework authentication settings
- Ensure the bot is properly registered

## License

MIT

## Contributing

Contributions welcome! Please ensure all PRs follow security best practices and don't include any secrets or API keys.
