import { CosmosService, CosmosConfig } from './cosmosService';
import * as dotenv from 'dotenv';

dotenv.config();

async function testConnection() {
  console.log('Testing Cosmos DB Connection...\n');

  const endpoint = process.env.COSMOS_ENDPOINT;
  const key = process.env.COSMOS_KEY;

  if (!endpoint || !key) {
    console.error('❌ Error: COSMOS_ENDPOINT and COSMOS_KEY must be set in .env file');
    process.exit(1);
  }

  console.log('✓ Environment variables found');
  console.log(`  Endpoint: ${endpoint}`);
  console.log(`  Key: ${key.substring(0, 10)}...`);

  const config: CosmosConfig = { endpoint, key };
  const service = new CosmosService(config);

  try {
    console.log('\n📋 Listing databases...');
    const databases = await service.listDatabases();
    console.log(`✓ Found ${databases.length} databases:`);
    databases.forEach(db => console.log(`  - ${db.id}`));

    if (databases.length > 0) {
      const firstDb = databases[0].id;
      console.log(`\n📦 Listing containers in "${firstDb}"...`);
      const containers = await service.listContainers(firstDb);
      console.log(`✓ Found ${containers.length} containers:`);
      containers.forEach(c => console.log(`  - ${c.id} (partition: ${c.partitionKey})`));

      if (containers.length > 0) {
        const firstContainer = containers[0].id;
        console.log(`\n📄 Querying first 5 documents from "${firstContainer}"...`);
        const documents = await service.queryDocuments(firstDb, firstContainer, 'SELECT TOP 5 * FROM c');
        console.log(`✓ Found ${documents.length} documents`);
        if (documents.length > 0) {
          console.log('\nFirst document preview:');
          console.log(JSON.stringify(documents[0], null, 2).substring(0, 200) + '...');
        }
      }
    }

    console.log('\n✅ Connection test successful!\n');
    console.log('You can now run the TUI with: npm start');
  } catch (error: any) {
    console.error('\n❌ Connection test failed:');
    console.error(`  Error: ${error.message}`);
    console.error('\nPlease check:');
    console.error('  1. COSMOS_ENDPOINT is correct');
    console.error('  2. COSMOS_KEY is valid');
    console.error('  3. Network connectivity to Azure');
    console.error('  4. Firewall rules allow your IP address');
    process.exit(1);
  }
}

testConnection();
