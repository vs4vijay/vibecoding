import { CosmosClient, Database, Container, FeedResponse } from '@azure/cosmos';

export interface CosmosConfig {
  endpoint: string;
  key: string;
  databaseId?: string;
}

export interface DatabaseInfo {
  id: string;
  _self?: string;
  _etag?: string;
  _ts?: number;
}

export interface ContainerInfo {
  id: string;
  partitionKey: string;
  _self?: string;
  _etag?: string;
  _ts?: number;
}

export interface DocumentInfo {
  id: string;
  [key: string]: any;
}

export class CosmosService {
  private client: CosmosClient;
  private currentDatabase?: Database;
  private currentContainer?: Container;

  constructor(config: CosmosConfig) {
    this.client = new CosmosClient({
      endpoint: config.endpoint,
      key: config.key,
    });
  }

  async listDatabases(): Promise<DatabaseInfo[]> {
    const { resources } = await this.client.databases.readAll().fetchAll();
    return resources;
  }

  async createDatabase(id: string): Promise<void> {
    await this.client.databases.createIfNotExists({ id });
  }

  async deleteDatabase(id: string): Promise<void> {
    await this.client.database(id).delete();
  }

  async listContainers(databaseId: string): Promise<ContainerInfo[]> {
    this.currentDatabase = this.client.database(databaseId);
    const { resources } = await this.currentDatabase.containers.readAll().fetchAll();
    
    return resources.map(container => ({
      id: container.id,
      partitionKey: container.partitionKey?.paths?.[0] || '/id',
      _self: container._self,
      _etag: container._etag,
      _ts: container._ts,
    }));
  }

  async createContainer(databaseId: string, containerId: string, partitionKey: string): Promise<void> {
    const database = this.client.database(databaseId);
    await database.containers.createIfNotExists({
      id: containerId,
      partitionKey: { paths: [partitionKey] },
    });
  }

  async deleteContainer(databaseId: string, containerId: string): Promise<void> {
    const database = this.client.database(databaseId);
    await database.container(containerId).delete();
  }

  async queryDocuments(
    databaseId: string,
    containerId: string,
    query: string = 'SELECT * FROM c',
    maxItems: number = 100
  ): Promise<DocumentInfo[]> {
    const database = this.client.database(databaseId);
    const container = database.container(containerId);
    
    const { resources } = await container.items
      .query(query, { maxItemCount: maxItems })
      .fetchAll();
    
    return resources;
  }

  async createDocument(
    databaseId: string,
    containerId: string,
    document: DocumentInfo
  ): Promise<void> {
    const database = this.client.database(databaseId);
    const container = database.container(containerId);
    await container.items.create(document);
  }

  async updateDocument(
    databaseId: string,
    containerId: string,
    document: DocumentInfo
  ): Promise<void> {
    const database = this.client.database(databaseId);
    const container = database.container(containerId);
    await container.item(document.id, document.id).replace(document);
  }

  async deleteDocument(
    databaseId: string,
    containerId: string,
    documentId: string,
    partitionKeyValue?: string
  ): Promise<void> {
    const database = this.client.database(databaseId);
    const container = database.container(containerId);
    await container.item(documentId, partitionKeyValue || documentId).delete();
  }

  async getDocumentById(
    databaseId: string,
    containerId: string,
    documentId: string,
    partitionKeyValue?: string
  ): Promise<DocumentInfo | null> {
    try {
      const database = this.client.database(databaseId);
      const container = database.container(containerId);
      const { resource } = await container.item(documentId, partitionKeyValue || documentId).read();
      return resource || null;
    } catch (error) {
      return null;
    }
  }

  async getContainerStats(databaseId: string, containerId: string): Promise<any> {
    const database = this.client.database(databaseId);
    const container = database.container(containerId);
    
    try {
      const countQuery = 'SELECT VALUE COUNT(1) FROM c';
      const { resources } = await container.items.query(countQuery).fetchAll();
      const count = resources[0] || 0;
      
      return {
        documentCount: count,
        containerId,
      };
    } catch (error) {
      return { documentCount: 0, containerId };
    }
  }
}
