# Architecture Overview

## System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Microsoft Teams                          │
│                                                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐                 │
│  │  User 1  │  │  User 2  │  │  User N  │                 │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘                 │
│       │             │             │                         │
└───────┼─────────────┼─────────────┼─────────────────────────┘
        │             │             │
        └─────────────┴─────────────┘
                      │
                      ▼
        ┌─────────────────────────┐
        │   Azure Bot Service     │
        │   /api/messages         │
        └───────────┬─────────────┘
                    │
                    ▼
        ┌─────────────────────────┐
        │    Teams Bot App        │
        │  (App Service/ACA)      │
        │                         │
        │  ┌─────────────────┐   │
        │  │  Bot Handler    │   │
        │  │  - Message      │   │
        │  │  - History Mgmt │   │
        │  └────────┬────────┘   │
        │           │             │
        │  ┌────────▼────────┐   │
        │  │ OpenAI Service  │   │
        │  └────────┬────────┘   │
        └───────────┼─────────────┘
                    │
                    │ Managed Identity
                    │ (DefaultAzureCredential)
                    │
        ┌───────────▼─────────────┐
        │   Azure OpenAI Service  │
        │   - GPT-4 / GPT-3.5     │
        └─────────────────────────┘
```

## Future Architecture with Data Sources

```
┌─────────────────────────────────────────────────────────────┐
│                     Microsoft Teams                          │
└───────────────────────────┬─────────────────────────────────┘
                            │
                            ▼
              ┌─────────────────────────┐
              │    Teams Bot App        │
              │                         │
              │  ┌─────────────────┐   │
              │  │  Bot Handler    │   │
              │  │  - Intent Det.  │   │
              │  │  - Orchestrator │   │
              │  └────────┬────────┘   │
              │           │             │
              │     ┌─────┴──────┐     │
              │     ▼            ▼     │
              │  ┌────────┐  ┌────────┐│
              │  │ OpenAI │  │ Intent ││
              │  │Service │  │Detector││
              │  └────┬───┘  └────┬───┘│
              └───────┼───────────┼─────┘
                      │           │
       Managed Identity (No Secrets!)
                      │           │
        ┌─────────────┼───────────┼──────────────┐
        │             │           │              │
        ▼             ▼           ▼              ▼
┌──────────────┐ ┌─────────┐ ┌────────┐ ┌──────────────┐
│ Azure OpenAI │ │  Kusto  │ │ DevOps │ │ Key Vault    │
│  Service     │ │  (ADX)  │ │  API   │ │ (Secrets)    │
└──────────────┘ └─────────┘ └────────┘ └──────────────┘
                      │
                      ▼
              ┌────────────────┐
              │   Telemetry    │
              │   Logs & Data  │
              └────────────────┘
```

## Component Responsibilities

### 1. Bot Handler (`src/bot.ts`)
- **Responsibilities:**
  - Receive and process messages from Teams
  - Maintain conversation history per user
  - Route requests to appropriate services
  - Send responses back to users
  - Handle typing indicators and errors

- **Security:**
  - No secrets stored
  - Validates all inputs
  - Implements error handling without leaking info

### 2. Azure OpenAI Service (`src/services/azureOpenAIService.ts`)
- **Responsibilities:**
  - Communicate with Azure OpenAI API
  - Format chat completions requests
  - Manage system prompts
  - Handle API errors and retries

- **Security:**
  - Uses DefaultAzureCredential (Managed Identity)
  - Configurable temperature and token limits
  - No API keys in code

### 3. Future Data Services
- **Kusto Service:** Query telemetry and logs
- **DevOps Service:** Query work items, builds, PRs
- **Key Vault Service:** Securely retrieve secrets for third-party APIs

## Data Flow

### Simple Chat Flow
```
1. User sends message in Teams
   ↓
2. Teams → Azure Bot Service → Bot App
   ↓
3. Bot Handler receives message
   ↓
4. Add to conversation history
   ↓
5. Call Azure OpenAI Service
   ↓
6. Azure OpenAI (authenticated via Managed Identity)
   ↓
7. Receive AI response
   ↓
8. Add response to history
   ↓
9. Send response to user
```

### Future: Multi-Source Query Flow
```
1. User asks: "Show me telemetry errors from last hour"
   ↓
2. Intent Detector analyzes message
   ↓
3. Determines: intent="query_telemetry", timeRange="1h"
   ↓
4. Route to Kusto Service
   ↓
5. Execute KQL query
   ↓
6. Format results
   ↓
7. (Optional) Summarize with OpenAI
   ↓
8. Return formatted response to user
```

## Security Architecture

### Authentication Chain

```
Bot App (Managed Identity)
    ↓
DefaultAzureCredential
    ├─→ Environment Variables (local dev)
    ├─→ Managed Identity (production) ← PRIMARY
    ├─→ Azure CLI (local dev)
    └─→ Visual Studio (local dev)
```

### Authorization Model

```
Managed Identity Principal
    │
    ├─→ Azure OpenAI: "Cognitive Services OpenAI User"
    ├─→ Kusto Cluster: "Reader" or "Viewer"
    ├─→ Key Vault: "Key Vault Secrets User" (get, list)
    └─→ App Insights: "Monitoring Metrics Publisher"
```

### Secret Management

```
Production:
    No secrets in code or config
    ↓
    All auth via Managed Identity
    ↓
    Third-party credentials in Key Vault
    ↓
    Retrieved at runtime via Managed Identity

Development:
    Optional API keys in .env (gitignored)
    ↓
    Or use Azure CLI: az login
    ↓
    DefaultAzureCredential handles automatically
```

## Scalability Considerations

### Current Design
- **Stateless:** Conversation history in memory
- **Scale Limit:** Single instance memory limit
- **Sessions:** Lost on restart

### Recommended Improvements

1. **Redis Cache for Conversation History**
   ```typescript
   import { RedisClient } from '@azure/redis';
   
   // Store history in Redis instead of memory
   const history = await redis.get(conversationId);
   ```

2. **Azure Storage for Long-term History**
   ```typescript
   import { BlobServiceClient } from '@azure/storage-blob';
   
   // Archive conversations to Blob Storage
   await blobClient.upload(conversationId, JSON.stringify(history));
   ```

3. **Application Insights for Monitoring**
   ```typescript
   import { ApplicationInsights } from '@azure/monitor-opentelemetry';
   
   // Track usage, performance, errors
   telemetry.trackEvent('MessageReceived', { conversationId });
   ```

## Performance Optimization

### Caching Strategy
```
┌─────────────┐
│ User Query  │
└──────┬──────┘
       │
       ▼
  ┌─────────┐   Hit   ┌────────┐
  │  Cache  ├────────→│ Return │
  └────┬────┘         └────────┘
       │ Miss
       ▼
┌──────────────┐
│ Data Source  │
│ (OpenAI/     │
│  Kusto/etc)  │
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ Update Cache │
└──────┬───────┘
       │
       ▼
  ┌────────┐
  │ Return │
  └────────┘
```

### Rate Limiting
```typescript
// Per-user rate limiting
const rateLimiter = {
  maxMessages: 100,      // per hour
  maxTokens: 50000,      // per day
  cooldown: 1000         // ms between messages
};
```

## Monitoring & Observability

### Key Metrics to Track
1. **Request Metrics:**
   - Messages per minute
   - Response latency
   - Error rate

2. **OpenAI Metrics:**
   - Token usage
   - Cost per conversation
   - API errors

3. **User Metrics:**
   - Active users
   - Conversation length
   - Most asked questions

### Logging Strategy
```typescript
// Structured logging
console.log(JSON.stringify({
  timestamp: new Date().toISOString(),
  level: 'INFO',
  conversationId: 'abc123',
  event: 'MessageProcessed',
  tokens: 150,
  latency: 1234,
  // NO user message content (privacy)
}));
```

## Disaster Recovery

### Backup Strategy
1. **Configuration:** Stored in Git
2. **Conversation History:** If using Redis/Storage, enable geo-replication
3. **Secrets:** Key Vault has automatic backup

### Recovery Plan
1. **Bot Down:** Auto-restart via App Service
2. **OpenAI Outage:** Implement fallback message
3. **Data Source Outage:** Graceful degradation
4. **Region Failure:** Deploy to secondary region

## Cost Optimization

### Azure OpenAI Costs
- Use GPT-3.5-Turbo for simple queries (cheaper)
- Use GPT-4 for complex queries only
- Limit max_tokens to prevent runaway costs
- Implement caching for repeated questions

### Compute Costs
- Use App Service Basic tier for dev
- Scale to Standard/Premium for production
- Consider consumption-based Azure Container Apps
- Enable auto-scaling based on CPU/memory

## Development Workflow

```
Local Development:
┌─────────────┐
│ Developer   │
└──────┬──────┘
       │
       ▼
┌─────────────┐    ┌──────────────┐
│ bun run dev │───→│ Local Server │
└─────────────┘    │ Port 3978    │
                   └──────┬───────┘
                          │
                          ▼
                   ┌──────────────┐
                   │ Bot Emulator │
                   │    Testing   │
                   └──────────────┘

Production Deployment:
┌─────────────┐
│  Git Push   │
└──────┬──────┘
       │
       ▼
┌─────────────┐    ┌──────────────┐
│ GitHub      │───→│ Build & Test │
│ Actions     │    └──────┬───────┘
└─────────────┘           │
                          ▼
                   ┌──────────────┐
                   │ Deploy to    │
                   │ Azure App    │
                   │ Service      │
                   └──────────────┘
```

## Future Enhancements Roadmap

### Phase 1: Core Improvements
- [ ] Add Redis for conversation history
- [ ] Implement Application Insights
- [ ] Add rate limiting
- [ ] Create comprehensive tests

### Phase 2: Data Source Integration
- [ ] Integrate Kusto for telemetry queries
- [ ] Add Azure DevOps integration
- [ ] Implement intent detection
- [ ] Create data source router

### Phase 3: Advanced Features
- [ ] Multi-turn conversations with context
- [ ] File/image attachment support
- [ ] Proactive notifications
- [ ] Admin dashboard

### Phase 4: Enterprise Features
- [ ] Multi-language support
- [ ] RBAC for data sources
- [ ] Compliance reporting
- [ ] Advanced analytics

## References

- [Bot Framework Documentation](https://docs.microsoft.com/azure/bot-service/)
- [Azure OpenAI Documentation](https://learn.microsoft.com/azure/ai-services/openai/)
- [Managed Identity Documentation](https://learn.microsoft.com/azure/active-directory/managed-identities-azure-resources/)
- [Teams Bot Development](https://learn.microsoft.com/microsoftteams/platform/bots/what-are-bots)
