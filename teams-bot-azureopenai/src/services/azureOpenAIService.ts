import OpenAI from 'openai';
import { DefaultAzureCredential } from '@azure/identity';

export interface ChatMessage {
  role: string;
  content: string;
}

export class AzureOpenAIService {
  private client: OpenAI;
  private deploymentName: string;
  private systemPrompt: string;

  constructor(endpoint: string, deploymentName: string, apiKey?: string) {
    const baseURL = process.env.MODAL_API_BASE_URL || `${endpoint}/openai/v1`;
    const model = process.env.MODAL_MODEL || deploymentName;

    if (apiKey) {
      this.client = new OpenAI({
        baseURL,
        apiKey,
      });
    } else {
      this.client = new OpenAI({
        baseURL,
        apiKey: 'unused', // Required but not used with DefaultAzureCredential
      });
    }

    this.deploymentName = model;
    this.systemPrompt = `You are a helpful AI assistant integrated into Microsoft Teams. 
You help users with their queries in a professional and friendly manner. 
Keep responses concise and relevant.`;
  }

  async getChatCompletion(messages: ChatMessage[]): Promise<string> {
    try {
      const messagesWithSystem = [
        { role: 'system', content: this.systemPrompt },
        ...messages
      ];

      const result = await this.client.chat.completions.create(
        {
          model: this.deploymentName,
          messages: messagesWithSystem,
          max_tokens: 800,
          temperature: 0.7,
        }
      );

      if (!result.choices || result.choices.length === 0) {
        throw new Error('No response from OpenAI');
      }

      return result.choices[0].message?.content || 'I apologize, but I could not generate a response.';
    } catch (error) {
      console.error('OpenAI error:', error);
      throw new Error('Failed to get response from OpenAI');
    }
  }

  public setSystemPrompt(prompt: string): void {
    this.systemPrompt = prompt;
  }
}
