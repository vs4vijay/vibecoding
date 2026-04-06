import { ActivityHandler, TurnContext, MessageFactory } from 'botbuilder';
import { AzureOpenAIService } from './services/azureOpenAIService';

export class TeamsBot extends ActivityHandler {
  private azureOpenAIService: AzureOpenAIService;
  private conversationHistory: Map<string, Array<{ role: string; content: string }>> = new Map();

  constructor(azureOpenAIService: AzureOpenAIService) {
    super();
    this.azureOpenAIService = azureOpenAIService;

    this.onMessage(async (context, next) => {
      await this.handleMessage(context);
      await next();
    });

    this.onMembersAdded(async (context, next) => {
      const membersAdded = context.activity.membersAdded;
      const welcomeText = 'Hello! I\'m your AI assistant powered by Azure OpenAI. Ask me anything!';
      
      for (const member of membersAdded || []) {
        if (member.id !== context.activity.recipient.id) {
          await context.sendActivity(MessageFactory.text(welcomeText));
        }
      }
      await next();
    });
  }

  private async handleMessage(context: TurnContext): Promise<void> {
    const userMessage = context.activity.text;
    const conversationId = context.activity.conversation.id;

    if (!userMessage) {
      return;
    }

    // Show typing indicator
    await context.sendActivity({ type: 'typing' });

    try {
      // Get or initialize conversation history
      let history = this.conversationHistory.get(conversationId);
      if (!history) {
        history = [];
        this.conversationHistory.set(conversationId, history);
      }

      // Add user message to history
      history.push({ role: 'user', content: userMessage });

      // Keep only last 10 messages to avoid token limits
      if (history.length > 10) {
        history = history.slice(-10);
        this.conversationHistory.set(conversationId, history);
      }

      // Get response from Azure OpenAI
      const response = await this.azureOpenAIService.getChatCompletion(history);

      // Add assistant response to history
      history.push({ role: 'assistant', content: response });

      // Send response to user
      await context.sendActivity(MessageFactory.text(response));
    } catch (error) {
      console.error('Error processing message:', error);
      await context.sendActivity(
        MessageFactory.text('Sorry, I encountered an error processing your request. Please try again.')
      );
    }
  }

  // Clear conversation history for a user
  public clearHistory(conversationId: string): void {
    this.conversationHistory.delete(conversationId);
  }
}
