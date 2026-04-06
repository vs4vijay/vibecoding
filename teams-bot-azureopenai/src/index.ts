import * as restify from 'restify';
import { 
  CloudAdapter, 
  ConfigurationServiceClientCredentialFactory,
  ConfigurationBotFrameworkAuthentication,
  TurnContext
} from 'botbuilder';
import { TeamsBot } from './bot';
import { AzureOpenAIService } from './services/azureOpenAIService';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Create HTTP server
const server = restify.createServer();
server.use(restify.plugins.bodyParser());

const PORT = process.env.PORT || 3978;

// Bot configuration using Managed Identity (no secrets!)
// For Azure deployment, these credentials will use DefaultAzureCredential
const credentialsFactory = new ConfigurationServiceClientCredentialFactory({
  MicrosoftAppId: process.env.MICROSOFT_APP_ID,
  MicrosoftAppPassword: process.env.MICROSOFT_APP_PASSWORD, // Only for local dev
  MicrosoftAppType: process.env.MICROSOFT_APP_TYPE || 'MultiTenant',
  MicrosoftAppTenantId: process.env.MICROSOFT_APP_TENANT_ID,
});

const botFrameworkAuthentication = new ConfigurationBotFrameworkAuthentication(
  {},
  credentialsFactory
);

// Create adapter
const adapter = new CloudAdapter(botFrameworkAuthentication);

// Error handler
adapter.onTurnError = async (context: TurnContext, error: Error) => {
  console.error(`\n [onTurnError] unhandled error: ${error}`);
  console.error(error);

  await context.sendActivity('The bot encountered an error or bug.');
  await context.sendActivity('To continue to run this bot, please fix the bot source code.');
};

const modalApiBaseURL = process.env.MODAL_API_BASE_URL;
const modalApiKey = process.env.MODAL_API_KEY;
const modalModel = process.env.MODAL_MODEL;
const azureOpenAIEndpoint = process.env.AZURE_OPENAI_ENDPOINT;
const azureOpenAIDeployment = process.env.AZURE_OPENAI_DEPLOYMENT_NAME;
const azureOpenAIKey = process.env.AZURE_OPENAI_API_KEY;

const useModal = modalApiBaseURL && modalApiKey && modalModel;
const useAzure = azureOpenAIEndpoint && azureOpenAIDeployment;

if (!useModal && !useAzure) {
  throw new Error('Configuration missing. Set either MODAL_API_BASE_URL/MODAL_API_KEY/MODAL_MODEL or AZURE_OPENAI_ENDPOINT/AZURE_OPENAI_DEPLOYMENT_NAME');
}

let azureOpenAIService: AzureOpenAIService;

if (useModal) {
  console.log('Using Modal API:', modalApiBaseURL, 'model:', modalModel);
  azureOpenAIService = new AzureOpenAIService(
    modalApiBaseURL!,
    modalModel!,
    modalApiKey!
  );
} else {
  console.log('Using Azure OpenAI:', azureOpenAIEndpoint);
  azureOpenAIService = new AzureOpenAIService(
    azureOpenAIEndpoint!,
    azureOpenAIDeployment!,
    azureOpenAIKey
  );
}

// Create bot
const bot = new TeamsBot(azureOpenAIService);

// Listen for incoming requests
server.post('/api/messages', async (req, res) => {
  await adapter.process(req, res, async (context) => {
    await bot.run(context);
  });
});

// Health check endpoint
server.get('/health', (req, res, next) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
  next();
});

// Start server
server.listen(PORT, () => {
  console.log(`\n${server.name} listening on ${server.url}`);
  console.log('\nBot is ready!');
  console.log(`Using Managed Identity: ${!azureOpenAIKey}`);
});
