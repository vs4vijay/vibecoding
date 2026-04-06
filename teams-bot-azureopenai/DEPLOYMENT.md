# Deployment Guide

## Prerequisites

- Azure subscription
- Azure CLI installed and logged in (`az login`)
- Bot registered in Azure Bot Service
- Azure OpenAI resource created

## Step 1: Create Azure Resources

### 1.1 Create Resource Group
```bash
az group create \
  --name teams-bot-rg \
  --location eastus
```

### 1.2 Create Azure OpenAI Resource (if not exists)
```bash
az cognitiveservices account create \
  --name my-openai-resource \
  --resource-group teams-bot-rg \
  --kind OpenAI \
  --sku S0 \
  --location eastus
```

### 1.3 Deploy a Model
```bash
az cognitiveservices account deployment create \
  --name my-openai-resource \
  --resource-group teams-bot-rg \
  --deployment-name gpt-4 \
  --model-name gpt-4 \
  --model-version "0613" \
  --model-format OpenAI \
  --sku-capacity 10 \
  --sku-name "Standard"
```

### 1.4 Create App Service Plan
```bash
az appservice plan create \
  --name teams-bot-plan \
  --resource-group teams-bot-rg \
  --location eastus \
  --sku B1 \
  --is-linux
```

### 1.5 Create Web App
```bash
az webapp create \
  --name my-teams-bot \
  --resource-group teams-bot-rg \
  --plan teams-bot-plan \
  --runtime "NODE:20-lts"
```

## Step 2: Configure Managed Identity

### 2.1 Enable System-Assigned Managed Identity
```bash
az webapp identity assign \
  --name my-teams-bot \
  --resource-group teams-bot-rg
```

This command outputs the `principalId`. Save it for the next step.

### 2.2 Grant OpenAI Access to Managed Identity
```bash
# Get the OpenAI resource ID
OPENAI_ID=$(az cognitiveservices account show \
  --name my-openai-resource \
  --resource-group teams-bot-rg \
  --query id -o tsv)

# Assign role
az role assignment create \
  --role "Cognitive Services OpenAI User" \
  --assignee <principal-id-from-step-2.1> \
  --scope $OPENAI_ID
```

## Step 3: Register Bot in Azure Bot Service

### 3.1 Create Bot Registration
```bash
az bot create \
  --name my-teams-bot \
  --resource-group teams-bot-rg \
  --kind registration \
  --sku F0 \
  --appid <create-new-app-id-or-use-existing> \
  --endpoint https://my-teams-bot.azurewebsites.net/api/messages
```

### 3.2 Enable Teams Channel
```bash
az bot msteams create \
  --name my-teams-bot \
  --resource-group teams-bot-rg
```

## Step 4: Configure App Settings

```bash
# Get OpenAI endpoint
OPENAI_ENDPOINT=$(az cognitiveservices account show \
  --name my-openai-resource \
  --resource-group teams-bot-rg \
  --query properties.endpoint -o tsv)

# Configure app settings
az webapp config appsettings set \
  --name my-teams-bot \
  --resource-group teams-bot-rg \
  --settings \
    MICROSOFT_APP_ID=<your-bot-app-id> \
    MICROSOFT_APP_TYPE=MultiTenant \
    AZURE_OPENAI_ENDPOINT=$OPENAI_ENDPOINT \
    AZURE_OPENAI_DEPLOYMENT_NAME=gpt-4 \
    WEBSITES_PORT=3978 \
    NODE_ENV=production
```

## Step 5: Deploy the Bot Code

### Option A: Deploy from Local
```bash
# Build and deploy
cd teams-bot-azureopenai

# Create deployment package
zip -r deploy.zip . -x "node_modules/*" ".env*" "*.git*"

# Deploy to Azure
az webapp deployment source config-zip \
  --name my-teams-bot \
  --resource-group teams-bot-rg \
  --src deploy.zip
```

### Option B: Deploy from GitHub
```bash
# Configure GitHub deployment
az webapp deployment source config \
  --name my-teams-bot \
  --resource-group teams-bot-rg \
  --repo-url https://github.com/<your-repo> \
  --branch main \
  --manual-integration
```

### Option C: Use GitHub Actions
Create `.github/workflows/deploy.yml`:

```yaml
name: Deploy to Azure

on:
  push:
    branches: [ main ]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - uses: oven-sh/setup-bun@v1
        with:
          bun-version: latest
      
      - run: bun install
      
      - name: Deploy to Azure Web App
        uses: azure/webapps-deploy@v2
        with:
          app-name: my-teams-bot
          publish-profile: ${{ secrets.AZURE_WEBAPP_PUBLISH_PROFILE }}
```

## Step 6: Verify Deployment

### 6.1 Check App Health
```bash
curl https://my-teams-bot.azurewebsites.net/health
```

Expected response:
```json
{"status":"healthy","timestamp":"2025-12-19T..."}
```

### 6.2 Check Logs
```bash
az webapp log tail \
  --name my-teams-bot \
  --resource-group teams-bot-rg
```

### 6.3 Test with Bot Framework Emulator
1. Download [Bot Framework Emulator](https://github.com/Microsoft/BotFramework-Emulator/releases)
2. Open Bot URL: `https://my-teams-bot.azurewebsites.net/api/messages`
3. Enter your Microsoft App ID
4. Test conversation

## Step 7: Add to Teams

### 7.1 Create Teams App Manifest

Create `manifest.json`:
```json
{
  "$schema": "https://developer.microsoft.com/json-schemas/teams/v1.16/MicrosoftTeams.schema.json",
  "manifestVersion": "1.16",
  "version": "1.0.0",
  "id": "<your-bot-app-id>",
  "packageName": "com.yourcompany.teamsbot",
  "developer": {
    "name": "Your Company",
    "websiteUrl": "https://yourcompany.com",
    "privacyUrl": "https://yourcompany.com/privacy",
    "termsOfUseUrl": "https://yourcompany.com/terms"
  },
  "name": {
    "short": "AI Assistant",
    "full": "AI Assistant powered by Azure OpenAI"
  },
  "description": {
    "short": "AI chatbot for Teams",
    "full": "An intelligent chatbot that helps answer questions using Azure OpenAI"
  },
  "icons": {
    "color": "color.png",
    "outline": "outline.png"
  },
  "accentColor": "#FFFFFF",
  "bots": [
    {
      "botId": "<your-bot-app-id>",
      "scopes": ["personal", "team", "groupchat"],
      "supportsFiles": false,
      "isNotificationOnly": false
    }
  ],
  "validDomains": []
}
```

### 7.2 Package and Upload
1. Create a ZIP file with `manifest.json` and two icon files
2. In Teams, go to Apps → Manage your apps → Upload an app
3. Upload the ZIP file
4. Add the bot to a team or chat

## Step 8: Security Hardening

### 8.1 Enable HTTPS Only
```bash
az webapp update \
  --name my-teams-bot \
  --resource-group teams-bot-rg \
  --https-only true
```

### 8.2 Enable Application Insights
```bash
az monitor app-insights component create \
  --app my-teams-bot-insights \
  --location eastus \
  --resource-group teams-bot-rg

# Link to web app
az webapp config appsettings set \
  --name my-teams-bot \
  --resource-group teams-bot-rg \
  --settings APPLICATIONINSIGHTS_CONNECTION_STRING=<connection-string>
```

### 8.3 Configure Firewall (Optional)
```bash
# Allow only Teams service tags
az webapp config access-restriction add \
  --name my-teams-bot \
  --resource-group teams-bot-rg \
  --rule-name AllowAzureCloud \
  --priority 100 \
  --service-tag AzureCloud
```

## Troubleshooting

### Bot not responding in Teams
1. Check App Service logs: `az webapp log tail`
2. Verify bot endpoint in Azure Portal
3. Test health endpoint
4. Verify Teams channel is enabled

### Authentication errors
1. Verify Microsoft App ID is correct
2. Check Managed Identity is assigned
3. Verify RBAC role assignment
4. Check Application Insights for errors

### OpenAI connection errors
1. Verify endpoint URL is correct
2. Check Managed Identity has OpenAI role
3. Test credential: `az account get-access-token --resource https://cognitiveservices.azure.com`
4. Check OpenAI deployment exists

## Monitoring

### Set up Alerts
```bash
# High response time
az monitor metrics alert create \
  --name high-response-time \
  --resource-group teams-bot-rg \
  --scopes /subscriptions/<sub-id>/resourceGroups/teams-bot-rg/providers/Microsoft.Web/sites/my-teams-bot \
  --condition "avg AverageResponseTime > 5" \
  --window-size 5m \
  --action-group <action-group-id>
```

### View Metrics
```bash
az monitor metrics list \
  --resource /subscriptions/<sub-id>/resourceGroups/teams-bot-rg/providers/Microsoft.Web/sites/my-teams-bot \
  --metric "Requests,AverageResponseTime,Http5xx"
```

## Updating the Bot

```bash
# Pull latest code
git pull origin main

# Deploy update
az webapp deployment source config-zip \
  --name my-teams-bot \
  --resource-group teams-bot-rg \
  --src deploy.zip

# Restart if needed
az webapp restart \
  --name my-teams-bot \
  --resource-group teams-bot-rg
```

## Clean Up

To delete all resources:
```bash
az group delete \
  --name teams-bot-rg \
  --yes --no-wait
```
