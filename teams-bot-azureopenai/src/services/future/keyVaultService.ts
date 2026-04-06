import { DefaultAzureCredential } from '@azure/identity';
import { SecretClient } from '@azure/keyvault-secrets';

/**
 * Service for securely retrieving secrets from Azure Key Vault
 * Uses DefaultAzureCredential (Managed Identity)
 */
export class KeyVaultService {
  private client: SecretClient;

  constructor(keyVaultUrl: string) {
    const credential = new DefaultAzureCredential();
    this.client = new SecretClient(keyVaultUrl, credential);
  }

  /**
   * Get a secret value from Key Vault
   * @param secretName Name of the secret
   * @returns Secret value
   */
  async getSecret(secretName: string): Promise<string> {
    try {
      const secret = await this.client.getSecret(secretName);
      return secret.value || '';
    } catch (error) {
      console.error(`Failed to retrieve secret ${secretName}:`, error);
      throw new Error(`Failed to retrieve secret: ${secretName}`);
    }
  }

  /**
   * Set a secret in Key Vault
   * @param secretName Name of the secret
   * @param secretValue Value to store
   */
  async setSecret(secretName: string, secretValue: string): Promise<void> {
    try {
      await this.client.setSecret(secretName, secretValue);
    } catch (error) {
      console.error(`Failed to set secret ${secretName}:`, error);
      throw new Error(`Failed to set secret: ${secretName}`);
    }
  }

  /**
   * Delete a secret from Key Vault
   * @param secretName Name of the secret
   */
  async deleteSecret(secretName: string): Promise<void> {
    try {
      await this.client.beginDeleteSecret(secretName);
    } catch (error) {
      console.error(`Failed to delete secret ${secretName}:`, error);
      throw new Error(`Failed to delete secret: ${secretName}`);
    }
  }
}

/**
 * Installation instructions:
 * bun add @azure/keyvault-secrets
 * 
 * Grant permissions to Managed Identity:
 * az keyvault set-policy \
 *   --name <key-vault-name> \
 *   --object-id <managed-identity-principal-id> \
 *   --secret-permissions get list
 * 
 * Usage example:
 * const kvService = new KeyVaultService('https://my-vault.vault.azure.net');
 * const apiKey = await kvService.getSecret('azure-devops-pat');
 */
