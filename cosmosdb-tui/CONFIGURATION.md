# Cosmos DB TUI Configuration

This file documents advanced configuration options for the Cosmos DB TUI.

## Environment Variables

All configuration is done through environment variables in the `.env` file.

### Required Variables

```env
# Azure Cosmos DB endpoint URL
COSMOS_ENDPOINT=https://your-account.documents.azure.com:443/

# Azure Cosmos DB primary or secondary key
COSMOS_KEY=your-primary-key-here
```

### Optional Variables

```env
# Default database to connect to on startup
COSMOS_DATABASE=myDatabase

# Maximum number of documents to fetch in queries (default: 100)
COSMOS_MAX_ITEMS=100

# Query timeout in seconds (default: 30)
COSMOS_QUERY_TIMEOUT=30

# Connection timeout in milliseconds (default: 10000)
COSMOS_CONNECTION_TIMEOUT=10000

# Enable verbose logging (default: false)
COSMOS_DEBUG=true

# Theme to use (default, dark)
COSMOS_THEME=default
```

## Connection String Format

The Cosmos DB connection requires two pieces of information:

1. **Endpoint**: The URI of your Cosmos DB account
   - Format: `https://{account-name}.documents.azure.com:443/`
   - Found in Azure Portal → Keys → URI

2. **Key**: The access key for your account
   - Found in Azure Portal → Keys → Primary Key or Secondary Key
   - Keep this secure - it provides full access to your database

## Finding Your Credentials

### Azure Portal

1. Navigate to your Cosmos DB account
2. In the left menu, click **Keys**
3. Copy the **URI** for COSMOS_ENDPOINT
4. Copy the **PRIMARY KEY** for COSMOS_KEY

### Azure CLI

```bash
# Get endpoint
az cosmosdb show --name <account-name> --resource-group <resource-group> --query documentEndpoint -o tsv

# Get primary key
az cosmosdb keys list --name <account-name> --resource-group <resource-group> --query primaryMasterKey -o tsv
```

## Security Best Practices

### 1. Use Read-Only Keys for Viewing
For read-only access, use read-only keys from Azure Portal:
- Azure Portal → Keys → Read-only Keys
- Prevents accidental modifications

### 2. Never Commit .env to Git
The `.env` file is in `.gitignore` by default. Never commit credentials!

### 3. Use Different Keys for Different Environments
- Development: Use test account or read-only keys
- Production: Use separate production keys with restricted access

### 4. Rotate Keys Regularly
- Regenerate keys periodically in Azure Portal
- Update `.env` file after rotation

### 5. IP Firewall Rules
Configure IP firewall in Azure Portal:
1. Go to your Cosmos DB account
2. Click **Firewall and virtual networks**
3. Add your IP address
4. Save changes

## Advanced Configuration

### Custom Query Defaults

Edit `src/ui/queryHelper.ts` to customize default queries:

```typescript
export const commonQueries = {
  selectAll: 'SELECT * FROM c',
  // Add your custom queries here
  myCustomQuery: 'SELECT * FROM c WHERE c.status = "active"',
};
```

### Theme Customization

Edit `src/ui/theme.ts` to customize colors:

```typescript
export const myTheme: Theme = {
  border: 'magenta',
  selected: {
    bg: 'green',
    fg: 'white',
  },
  // ... more customization
};
```

### Keyboard Shortcuts

Edit `src/ui/keyBindings.ts` to customize keyboard shortcuts:

```typescript
export class KeyBindings {
  static readonly MY_CUSTOM_KEY = ['k'];
  // ... add custom shortcuts
}
```

## Performance Tuning

### Query Performance

1. **Use partition keys in queries**
```sql
SELECT * FROM c WHERE c.userId = 'user123'  -- Good: uses partition key
SELECT * FROM c WHERE c.status = 'active'   -- Slower: cross-partition
```

2. **Limit result sets**
```sql
SELECT TOP 100 * FROM c  -- Good: limited results
SELECT * FROM c           -- Slower: all results
```

3. **Project only needed fields**
```sql
SELECT c.id, c.name FROM c  -- Good: only needed fields
SELECT * FROM c              -- Slower: all fields
```

### Indexing

Configure indexes in Azure Portal for better performance:
1. Go to Container → Settings → Indexing Policy
2. Add specific paths for frequently queried fields
3. Save changes

### Connection Pooling

The SDK handles connection pooling automatically. For better performance:
- Keep the application running
- Reuse connections
- Avoid frequent restarts

## Multi-Account Setup

To manage multiple Cosmos DB accounts, create separate `.env` files:

```bash
.env.dev         # Development account
.env.staging     # Staging account  
.env.prod        # Production account
```

Switch between them:
```bash
cp .env.dev .env     # Use dev account
npm start

cp .env.prod .env    # Use prod account
npm start
```

Or use environment variables directly:
```bash
COSMOS_ENDPOINT=https://dev.documents.azure.com:443/ COSMOS_KEY=dev-key npm start
```

## Troubleshooting Connection Issues

### Common Errors

**Error: "Request failed with status 401"**
- Invalid COSMOS_KEY
- Check key in Azure Portal

**Error: "Request timeout"**
- Network connectivity issue
- Check firewall rules
- Increase COSMOS_CONNECTION_TIMEOUT

**Error: "Forbidden"**
- IP address not allowed
- Add IP to firewall rules in Azure Portal

**Error: "Resource Not Found"**
- Invalid COSMOS_ENDPOINT
- Database/container deleted

### Debug Mode

Enable debug logging:
```env
COSMOS_DEBUG=true
```

This will show:
- Connection attempts
- Query execution
- Response times
- Error details

## Region and Performance

Cosmos DB is globally distributed. For best performance:

1. **Choose nearest region** when creating account
2. **Enable multi-region writes** if needed
3. **Configure consistency level** appropriately
   - Strong: Highest consistency, higher latency
   - Eventual: Lowest consistency, lower latency
   - Session: Good balance (default)

## Consistency Levels

Configure in code if needed (default is Session):

```typescript
const client = new CosmosClient({
  endpoint: config.endpoint,
  key: config.key,
  consistencyLevel: 'Session'  // Strong, BoundedStaleness, Session, ConsistentPrefix, Eventual
});
```

## Cost Optimization

1. **Use appropriate throughput**
   - Autoscale for variable workloads
   - Provisioned for predictable workloads

2. **Optimize queries**
   - Use indexes
   - Limit result sets
   - Use partition keys

3. **Monitor RU consumption**
   - Check query costs in Azure Portal
   - Optimize expensive queries

4. **Set TTL on documents**
   - Auto-delete old documents
   - Reduce storage costs

---

For more information, see:
- [Azure Cosmos DB Documentation](https://docs.microsoft.com/azure/cosmos-db/)
- [SQL Query Reference](https://docs.microsoft.com/azure/cosmos-db/sql-query-getting-started)
- [Performance Tips](https://docs.microsoft.com/azure/cosmos-db/performance-tips)
