import * as blessed from 'blessed';
import { CosmosService, DatabaseInfo, ContainerInfo, DocumentInfo } from '../cosmosService';

enum ViewMode {
  DATABASES = 'databases',
  CONTAINERS = 'containers',
  DOCUMENTS = 'documents',
  DOCUMENT_DETAIL = 'document_detail',
  QUERY = 'query',
}

export class CosmosDBTUI {
  private screen!: blessed.Widgets.Screen;
  private cosmosService!: CosmosService;
  private currentMode: ViewMode = ViewMode.DATABASES;
  private selectedDatabase?: string;
  private selectedContainer?: string;
  private selectedDocument?: DocumentInfo;
  
  private databaseList!: blessed.Widgets.ListElement;
  private containerList!: blessed.Widgets.ListElement;
  private documentList!: blessed.Widgets.ListElement;
  private detailBox!: blessed.Widgets.BoxElement;
  private statusBar!: blessed.Widgets.TextElement;
  private helpBar!: blessed.Widgets.TextElement;
  private queryInput!: blessed.Widgets.TextboxElement;
  
  private databases: DatabaseInfo[] = [];
  private containers: ContainerInfo[] = [];
  private documents: DocumentInfo[] = [];
  private currentQuery: string = 'SELECT * FROM c';

  async start(): Promise<void> {
    this.initializeCosmosService();
    this.createUI();
    await this.loadDatabases();
    this.screen.render();
  }

  private initializeCosmosService(): void {
    const endpoint = process.env.COSMOS_ENDPOINT;
    const key = process.env.COSMOS_KEY;

    if (!endpoint || !key) {
      console.error('Error: COSMOS_ENDPOINT and COSMOS_KEY must be set in .env file');
      process.exit(1);
    }

    this.cosmosService = new CosmosService({ endpoint, key });
  }

  private createUI(): void {
    this.screen = blessed.screen({
      smartCSR: true,
      title: 'Cosmos DB TUI',
      fullUnicode: true,
    });

    const mainContainer = blessed.box({
      parent: this.screen,
      top: 0,
      left: 0,
      width: '100%',
      height: '100%-2',
    });

    this.databaseList = blessed.list({
      parent: mainContainer,
      label: ' Databases (Tab: Switch | Enter: Select | n: New | d: Delete | q: Quit) ',
      top: 0,
      left: 0,
      width: '25%',
      height: '100%',
      border: { type: 'line' },
      style: {
        border: { fg: 'cyan' },
        selected: { bg: 'blue', fg: 'white' },
        focus: { border: { fg: 'green' } },
      },
      keys: true,
      vi: true,
      mouse: true,
      tags: true,
    });

    this.containerList = blessed.list({
      parent: mainContainer,
      label: ' Containers (Tab: Switch | Enter: Select | n: New | d: Delete) ',
      top: 0,
      left: '25%',
      width: '25%',
      height: '100%',
      border: { type: 'line' },
      style: {
        border: { fg: 'cyan' },
        selected: { bg: 'blue', fg: 'white' },
        focus: { border: { fg: 'green' } },
      },
      keys: true,
      vi: true,
      mouse: true,
      tags: true,
    });

    this.documentList = blessed.list({
      parent: mainContainer,
      label: ' Documents (Tab: Switch | Enter: View | n: New | d: Delete | /: Query) ',
      top: 0,
      left: '50%',
      width: '25%',
      height: '100%',
      border: { type: 'line' },
      style: {
        border: { fg: 'cyan' },
        selected: { bg: 'blue', fg: 'white' },
        focus: { border: { fg: 'green' } },
      },
      keys: true,
      vi: true,
      mouse: true,
      scrollable: true,
      alwaysScroll: true,
      tags: true,
    });

    this.detailBox = blessed.box({
      parent: mainContainer,
      label: ' Document Detail (Esc: Back | e: Edit) ',
      top: 0,
      left: '75%',
      width: '25%',
      height: '100%',
      border: { type: 'line' },
      style: {
        border: { fg: 'cyan' },
        focus: { border: { fg: 'green' } },
      },
      scrollable: true,
      alwaysScroll: true,
      keys: true,
      vi: true,
      mouse: true,
      tags: true,
    });

    this.statusBar = blessed.text({
      parent: this.screen,
      bottom: 1,
      left: 0,
      width: '100%',
      height: 1,
      content: ' Ready',
      style: {
        fg: 'white',
        bg: 'blue',
      },
    });

    this.helpBar = blessed.text({
      parent: this.screen,
      bottom: 0,
      left: 0,
      width: '100%',
      height: 1,
      content: ' Tab: Navigate | Enter: Select | n: New | d: Delete | /: Query | r: Refresh | q: Quit',
      style: {
        fg: 'black',
        bg: 'white',
      },
    });

    this.queryInput = blessed.textbox({
      parent: this.screen,
      label: ' SQL Query (Esc: Cancel | Enter: Execute) ',
      top: 'center',
      left: 'center',
      width: '80%',
      height: 3,
      border: { type: 'line' },
      style: {
        border: { fg: 'yellow' },
        focus: { border: { fg: 'green' } },
      },
      hidden: true,
      inputOnFocus: true,
    });

    this.setupKeyBindings();
    this.databaseList.focus();
  }

  private setupKeyBindings(): void {
    this.screen.key(['q', 'C-c'], () => {
      return process.exit(0);
    });

    this.screen.key(['tab'], () => {
      const focused = this.screen.focused;
      if (focused === this.databaseList) {
        this.containerList.focus();
      } else if (focused === this.containerList) {
        this.documentList.focus();
      } else if (focused === this.documentList) {
        this.detailBox.focus();
      } else {
        this.databaseList.focus();
      }
      this.screen.render();
    });

    this.screen.key(['r'], async () => {
      await this.refresh();
    });

    this.databaseList.key(['enter'], async () => {
      const selected = this.databaseList.selected;
      if (selected >= 0 && selected < this.databases.length) {
        this.selectedDatabase = this.databases[selected].id;
        await this.loadContainers();
        this.containerList.focus();
      }
    });

    this.databaseList.key(['n'], async () => {
      await this.createNewDatabase();
    });

    this.databaseList.key(['d'], async () => {
      await this.deleteSelectedDatabase();
    });

    this.containerList.key(['enter'], async () => {
      const selected = this.containerList.selected;
      if (selected >= 0 && selected < this.containers.length) {
        this.selectedContainer = this.containers[selected].id;
        await this.loadDocuments();
        this.documentList.focus();
      }
    });

    this.containerList.key(['n'], async () => {
      await this.createNewContainer();
    });

    this.containerList.key(['d'], async () => {
      await this.deleteSelectedContainer();
    });

    this.documentList.key(['enter'], async () => {
      await this.viewDocumentDetail();
    });

    this.documentList.key(['n'], async () => {
      await this.createNewDocument();
    });

    this.documentList.key(['d'], async () => {
      await this.deleteSelectedDocument();
    });

    this.documentList.key(['/'], () => {
      this.showQueryInput();
    });

    this.queryInput.key(['escape'], () => {
      this.queryInput.hide();
      this.documentList.focus();
      this.screen.render();
    });

    this.queryInput.on('submit', async (value: string) => {
      this.currentQuery = value || 'SELECT * FROM c';
      this.queryInput.hide();
      await this.loadDocuments();
      this.documentList.focus();
      this.screen.render();
    });
  }

  private async loadDatabases(): Promise<void> {
    try {
      this.setStatus('Loading databases...');
      this.databases = await this.cosmosService.listDatabases();
      this.databaseList.setItems(this.databases.map(db => db.id));
      this.setStatus(`Loaded ${this.databases.length} databases`);
      this.screen.render();
    } catch (error: any) {
      this.setStatus(`Error: ${error.message}`);
    }
  }

  private async loadContainers(): Promise<void> {
    if (!this.selectedDatabase) return;

    try {
      this.setStatus(`Loading containers for ${this.selectedDatabase}...`);
      this.containers = await this.cosmosService.listContainers(this.selectedDatabase);
      this.containerList.setItems(
        this.containers.map(c => `${c.id} (${c.partitionKey})`)
      );
      this.setStatus(`Loaded ${this.containers.length} containers`);
      this.screen.render();
    } catch (error: any) {
      this.setStatus(`Error: ${error.message}`);
    }
  }

  private async loadDocuments(): Promise<void> {
    if (!this.selectedDatabase || !this.selectedContainer) return;

    try {
      this.setStatus(`Querying documents...`);
      this.documents = await this.cosmosService.queryDocuments(
        this.selectedDatabase,
        this.selectedContainer,
        this.currentQuery,
        100
      );
      
      this.documentList.setItems(
        this.documents.map(doc => {
          const preview = JSON.stringify(doc).substring(0, 50);
          return `${doc.id} - ${preview}...`;
        })
      );
      this.setStatus(`Loaded ${this.documents.length} documents`);
      this.screen.render();
    } catch (error: any) {
      this.setStatus(`Error: ${error.message}`);
    }
  }

  private async viewDocumentDetail(): Promise<void> {
    const selected = this.documentList.selected;
    if (selected >= 0 && selected < this.documents.length) {
      this.selectedDocument = this.documents[selected];
      const formatted = JSON.stringify(this.selectedDocument, null, 2);
      this.detailBox.setContent(formatted);
      this.detailBox.focus();
      this.screen.render();
    }
  }

  private async createNewDatabase(): Promise<void> {
    const prompt = blessed.prompt({
      parent: this.screen,
      top: 'center',
      left: 'center',
      width: '50%',
      height: 'shrink',
      border: { type: 'line' },
      label: ' Create Database ',
      tags: true,
    });

    prompt.input('Enter database ID:', '', async (err, value) => {
      if (!err && value) {
        try {
          await this.cosmosService.createDatabase(value);
          await this.loadDatabases();
          this.setStatus(`Created database: ${value}`);
        } catch (error: any) {
          this.setStatus(`Error: ${error.message}`);
        }
      }
      this.screen.render();
    });
  }

  private async deleteSelectedDatabase(): Promise<void> {
    const selected = this.databaseList.selected;
    if (selected >= 0 && selected < this.databases.length) {
      const dbId = this.databases[selected].id;
      
      const question = blessed.question({
        parent: this.screen,
        top: 'center',
        left: 'center',
        width: '50%',
        height: 'shrink',
        border: { type: 'line' },
        label: ' Confirm Delete ',
        tags: true,
      });

      question.ask(`Delete database "${dbId}"?`, async (err, value) => {
        if (value) {
          try {
            await this.cosmosService.deleteDatabase(dbId);
            await this.loadDatabases();
            this.setStatus(`Deleted database: ${dbId}`);
          } catch (error: any) {
            this.setStatus(`Error: ${error.message}`);
          }
        }
        this.screen.render();
      });
    }
  }

  private async createNewContainer(): Promise<void> {
    if (!this.selectedDatabase) return;

    const prompt = blessed.prompt({
      parent: this.screen,
      top: 'center',
      left: 'center',
      width: '50%',
      height: 'shrink',
      border: { type: 'line' },
      label: ' Create Container ',
      tags: true,
    });

    prompt.input('Enter container ID:', '', async (err, containerId) => {
      if (!err && containerId) {
        prompt.input('Enter partition key (e.g., /id):', '/id', async (err2, partitionKey) => {
          if (!err2 && partitionKey && this.selectedDatabase) {
            try {
              await this.cosmosService.createContainer(
                this.selectedDatabase,
                containerId,
                partitionKey
              );
              await this.loadContainers();
              this.setStatus(`Created container: ${containerId}`);
            } catch (error: any) {
              this.setStatus(`Error: ${error.message}`);
            }
          }
          this.screen.render();
        });
      }
    });
  }

  private async deleteSelectedContainer(): Promise<void> {
    if (!this.selectedDatabase) return;

    const selected = this.containerList.selected;
    if (selected >= 0 && selected < this.containers.length) {
      const containerId = this.containers[selected].id;
      
      const question = blessed.question({
        parent: this.screen,
        top: 'center',
        left: 'center',
        width: '50%',
        height: 'shrink',
        border: { type: 'line' },
        label: ' Confirm Delete ',
        tags: true,
      });

      question.ask(`Delete container "${containerId}"?`, async (err, value) => {
        if (value && this.selectedDatabase) {
          try {
            await this.cosmosService.deleteContainer(this.selectedDatabase, containerId);
            await this.loadContainers();
            this.setStatus(`Deleted container: ${containerId}`);
          } catch (error: any) {
            this.setStatus(`Error: ${error.message}`);
          }
        }
        this.screen.render();
      });
    }
  }

  private async createNewDocument(): Promise<void> {
    if (!this.selectedDatabase || !this.selectedContainer) return;

    const editor = blessed.textarea({
      parent: this.screen,
      label: ' Create Document (Ctrl+S: Save | Esc: Cancel) ',
      top: 'center',
      left: 'center',
      width: '80%',
      height: '80%',
      border: { type: 'line' },
      style: {
        border: { fg: 'green' },
      },
      keys: true,
      inputOnFocus: true,
      value: '{\n  "id": "new-doc-id",\n  \n}',
    });

    editor.key(['escape'], () => {
      editor.destroy();
      this.screen.render();
    });

    editor.key(['C-s'], async () => {
      const content = editor.getValue();
      try {
        const doc = JSON.parse(content);
        if (this.selectedDatabase && this.selectedContainer) {
          await this.cosmosService.createDocument(
            this.selectedDatabase,
            this.selectedContainer,
            doc
          );
          await this.loadDocuments();
          this.setStatus(`Created document: ${doc.id}`);
        }
      } catch (error: any) {
        this.setStatus(`Error: ${error.message}`);
      }
      editor.destroy();
      this.screen.render();
    });

    editor.focus();
    this.screen.render();
  }

  private async deleteSelectedDocument(): Promise<void> {
    if (!this.selectedDatabase || !this.selectedContainer) return;

    const selected = this.documentList.selected;
    if (selected >= 0 && selected < this.documents.length) {
      const doc = this.documents[selected];
      
      const question = blessed.question({
        parent: this.screen,
        top: 'center',
        left: 'center',
        width: '50%',
        height: 'shrink',
        border: { type: 'line' },
        label: ' Confirm Delete ',
        tags: true,
      });

      question.ask(`Delete document "${doc.id}"?`, async (err, value) => {
        if (value && this.selectedDatabase && this.selectedContainer) {
          try {
            await this.cosmosService.deleteDocument(
              this.selectedDatabase,
              this.selectedContainer,
              doc.id
            );
            await this.loadDocuments();
            this.setStatus(`Deleted document: ${doc.id}`);
          } catch (error: any) {
            this.setStatus(`Error: ${error.message}`);
          }
        }
        this.screen.render();
      });
    }
  }

  private showQueryInput(): void {
    this.queryInput.setValue(this.currentQuery);
    this.queryInput.show();
    this.queryInput.focus();
    this.screen.render();
  }

  private async refresh(): Promise<void> {
    if (this.screen.focused === this.databaseList) {
      await this.loadDatabases();
    } else if (this.screen.focused === this.containerList) {
      await this.loadContainers();
    } else if (this.screen.focused === this.documentList) {
      await this.loadDocuments();
    }
  }

  private setStatus(message: string): void {
    this.statusBar.setContent(` ${message}`);
    this.screen.render();
  }
}
