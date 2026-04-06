# Teams Bot with Azure OpenAI - Quick Start Guide

## 🎯 What You've Got

A **production-ready**, **secure** Microsoft Teams bot that:
- ✅ Integrates with Azure OpenAI for intelligent conversations
- ✅ Uses **DefaultAzureCredential (Managed Identity)** - NO SECRETS!
- ✅ Ready to extend with Kusto, Azure DevOps, and other data sources
- ✅ Built with TypeScript and Bun for modern development

## 📁 Project Structure

```
teams-bot-azureopenai/
├── src/
│   ├── index.ts                  # Main server & bot setup
│   ├── bot.ts                    # Teams bot logic
│   ├── services/
│   │   ├── azureOpenAIService.ts # Azure OpenAI integration
│   │   └── future/               # Future data source integrations
│   │       ├── kustoService.ts
│   │       ├── azureDevOpsService.ts
│   │       ├── keyVaultService.ts
│   │       └── README.md
│   └── ...
├── teams-manifest/               # Teams app package
│   ├── manifest.json
│   └── README.md
├── .env.example                  # Environment template
├── README.md                     # Main documentation
├── ARCHITECTURE.md               # Architecture details
├── DEPLOYMENT.md                 # Deployment guide
├── SECURITY.md                   # Security best practices
└── package.json
```

## 🚀 Quick Start (Local Development)

### 1. Configure Environment
```bash
cd teams-bot-azureopenai
cp .env.example .env
```

Edit `.env` with your values:
```env
MICROSOFT_APP_ID=<your-bot-app-id>
MICROSOFT_APP_PASSWORD=<only-for-local-dev>
AZURE_OPENAI_ENDPOINT=https://<your-resource>.openai.azure.com/
AZURE_OPENAI_DEPLOYMENT_NAME=<your-deployment>
AZURE_OPENAI_API_KEY=<only-for-local-dev>
```

### 2. Run the Bot
```bash
bun run start
```

Bot starts on `http://localhost:3978`

### 3. Test with Bot Emulator
1. Download [Bot Framework Emulator](https://github.com/Microsoft/BotFramework-Emulator/releases)
2. Open the emulator
3. Connect to: `http://localhost:3978/api/messages`
4. Enter your Microsoft App ID and Password
5. Start chatting!

## ☁️ Production Deployment

### Prerequisites
- Azure subscription
- Azure CLI installed: `az login`

### Deploy to Azure (5 steps)

**Step 1: Create Resources**
```bash
# Create resource group
az group create --name teams-bot-rg --location eastus

# Create App Service
az webapp create \
  --name my-teams-bot \
  --resource-group teams-bot-rg \
  --plan (create-plan) \
  --runtime "NODE:20-lts"
```

**Step 2: Enable Managed Identity**
```bash
az webapp identity assign \
  --name my-teams-bot \
  --resource-group teams-bot-rg
```
> Save the `principalId` from output

**Step 3: Grant OpenAI Access**
```bash
az role assignment create \
  --role "Cognitive Services OpenAI User" \
  --assignee <principal-id-from-step-2> \
  --scope <your-openai-resource-id>
```

**Step 4: Configure App Settings (NO SECRETS!)**
```bash
az webapp config appsettings set \
  --name my-teams-bot \
  --resource-group teams-bot-rg \
  --settings \
    MICROSOFT_APP_ID=<your-app-id> \
    AZURE_OPENAI_ENDPOINT=<endpoint> \
    AZURE_OPENAI_DEPLOYMENT_NAME=<deployment>
```

**Step 5: Deploy Code**
```bash
zip -r deploy.zip . -x "node_modules/*" ".env*"
az webapp deployment source config-zip \
  --name my-teams-bot \
  --resource-group teams-bot-rg \
  --src deploy.zip
```

✅ **Done!** Your bot is running securely with Managed Identity.

## 🔒 Security Highlights

### Production (Recommended)
- ✅ **Managed Identity**: Auto-authenticates to Azure services
- ✅ **No Secrets**: Everything uses DefaultAzureCredential
- ✅ **RBAC**: Fine-grained access control
- ✅ **Key Vault**: For third-party API keys (if needed)

### What We DON'T Do
- ❌ Hardcode API keys
- ❌ Store secrets in code
- ❌ Commit .env files
- ❌ Use service principals when Managed Identity available

## 📚 Documentation Index

| Document | Purpose |
|----------|---------|
| **README.md** | Main documentation, setup, features |
| **DEPLOYMENT.md** | Complete deployment guide with Azure CLI commands |
| **SECURITY.md** | Security best practices, RBAC, compliance |
| **ARCHITECTURE.md** | System architecture, data flow, scalability |
| **src/services/future/README.md** | Future integrations (Kusto, DevOps, etc.) |
| **teams-manifest/README.md** | Teams app packaging and upload |

## 🔮 Future Capabilities (Ready to Implement)

The bot is architected to easily add:

1. **Kusto/Azure Data Explorer**
   - Query telemetry and logs
   - Stub: `src/services/future/kustoService.ts`

2. **Azure DevOps**
   - Query work items, builds, PRs
   - Stub: `src/services/future/azureDevOpsService.ts`

3. **Key Vault**
   - Securely retrieve third-party secrets
   - Stub: `src/services/future/keyVaultService.ts`

See `src/services/future/README.md` for implementation guide.

## 🧪 Testing

### Local Testing
```bash
# Start bot
bun run dev

# Use Bot Framework Emulator
# Connect to: http://localhost:3978/api/messages
```

### Test with Teams
1. Create app package: `zip -r teams-app.zip teams-manifest/*`
2. Upload to Teams: Apps → Upload an app → teams-app.zip
3. Chat with your bot!

## 📊 Monitoring

### Health Check
```bash
curl https://my-teams-bot.azurewebsites.net/health
```

### View Logs
```bash
az webapp log tail --name my-teams-bot --resource-group teams-bot-rg
```

### Application Insights (Recommended)
Enable monitoring with Azure Application Insights - see DEPLOYMENT.md

## 🛠️ Development Commands

```bash
# Install dependencies
bun install

# Start development server (with hot reload)
bun run dev

# Start production server
bun run start

# View logs
bun run logs  # (if you add this script)
```

## ❓ Common Issues

### Bot not responding
- ✅ Check health endpoint
- ✅ Verify Bot Service endpoint in Azure Portal
- ✅ Check application logs

### Authentication errors
- ✅ Verify Managed Identity is enabled
- ✅ Check RBAC role assignments
- ✅ Ensure OpenAI endpoint is correct

### OpenAI connection fails
- ✅ Verify deployment name matches
- ✅ Check Managed Identity permissions
- ✅ Test with: `az account get-access-token --resource https://cognitiveservices.azure.com`

## 🎓 Next Steps

1. **Deploy to Azure** (follow DEPLOYMENT.md)
2. **Enable Monitoring** (Application Insights)
3. **Add Data Sources** (see src/services/future/)
4. **Customize System Prompt** (in azureOpenAIService.ts)
5. **Add Teams Manifest** (see teams-manifest/)

## 📞 Support

For detailed information, see:
- **Architecture**: ARCHITECTURE.md
- **Security**: SECURITY.md
- **Deployment**: DEPLOYMENT.md

## 🎉 Key Features Recap

✨ **Security First**
- Managed Identity everywhere
- No hardcoded secrets
- RBAC-based access

✨ **Modern Stack**
- TypeScript for type safety
- Bun for fast runtime
- Bot Framework SDK

✨ **Production Ready**
- Comprehensive error handling
- Health check endpoint
- Conversation history management

✨ **Extensible**
- Ready for multiple data sources
- Modular service architecture
- Well-documented

---

**Built with ❤️ for secure, scalable Teams bots**
