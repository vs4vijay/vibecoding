# Cosmos DB TUI 🚀

A **LazyGit-inspired Terminal User Interface (TUI)** for managing Azure Cosmos DB databases, containers, and documents. Built with TypeScript, Blessed, and the Azure Cosmos DB SDK.

![Cosmos DB TUI](https://img.shields.io/badge/Cosmos%20DB-TUI-blue)
![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue)
![Node](https://img.shields.io/badge/Node-%3E%3D18-green)

## ✨ Features

### 🎯 Core Functionality
- **Database Management**: List, create, and delete databases
- **Container Management**: List, create, and delete containers with partition key configuration
- **Document Operations**: Query, create, view, update, and delete documents
- **SQL Query Interface**: Execute custom SQL queries against containers
- **Real-time Navigation**: Fast keyboard-driven navigation between databases, containers, and documents
- **Document Viewer**: JSON-formatted document detail viewer with syntax highlighting

### ⌨️ LazyGit-Style Interface
- **Tab Navigation**: Switch between panels with Tab key
- **Vim-style Keys**: Navigate lists with j/k or arrow keys
- **Quick Actions**: Single-key shortcuts for common operations
- **Context-aware Help**: Dynamic help bar showing available commands
- **Modal Dialogs**: Interactive prompts for create/delete operations
- **Query Editor**: Full-featured SQL query input with history

### 🎨 UI Components
```
┌─ Databases ────────┬─ Containers ───────┬─ Documents ────────┬─ Detail ───────────┐
│ • database1        │ • container1 (/id) │ • doc-1            │ {                  │
│   database2        │   container2 (/pk) │   doc-2            │   "id": "doc-1",   │
│   database3        │                    │   doc-3            │   "name": "...",   │
│                    │                    │                    │   ...              │
└────────────────────┴────────────────────┴────────────────────┴────────────────────┘
 Status: Loaded 3 databases
 Tab: Navigate | Enter: Select | n: New | d: Delete | /: Query | r: Refresh | q: Quit
```

## 📦 Installation

### Prerequisites
- [Bun](https://bun.sh) runtime (v1.0 or higher)
- Azure Cosmos DB account with endpoint and key

### Setup

1. **Clone and install dependencies**:
```bash
bun install
```

2. **Configure environment**:
Create a `.env` file in the project root:
```env
COSMOS_ENDPOINT=https://your-account.documents.azure.com:443/
COSMOS_KEY=your-primary-key-here
COSMOS_DATABASE=your-database-name
```

3. **Run the application**:
```bash
bun start
# or for development with auto-reload
bun dev
```

## 🎮 Usage Guide

### Navigation
- **Tab**: Cycle through panels (Databases → Containers → Documents → Detail)
- **Shift+Tab**: Cycle backwards
- **↑/↓ or j/k**: Navigate lists (Vim-style)
- **Enter**: Select/Open item
- **Esc**: Go back/Cancel

### Database Operations
- **n**: Create new database
- **d**: Delete selected database
- **r**: Refresh database list

### Container Operations
- **n**: Create new container (prompts for ID and partition key)
- **d**: Delete selected container
- **r**: Refresh container list

### Document Operations
- **n**: Create new document (opens JSON editor)
- **d**: Delete selected document
- **e**: Edit selected document (when in detail view)
- **/**: Open SQL query editor
- **r**: Refresh document list

### Query Editor
- **/**: Open query input
- **Enter**: Execute query
- **Esc**: Cancel query input

Default query: `SELECT * FROM c`

Example queries:
```sql
SELECT * FROM c WHERE c.status = 'active'
SELECT * FROM c ORDER BY c.createdAt DESC
SELECT c.id, c.name FROM c
SELECT TOP 10 * FROM c
```

### Global Commands
- **q**: Quit application
- **Ctrl+C**: Force quit
- **r**: Refresh current view

## 🛠️ Development

### Project Structure
```
cosmosdb-tui/
├── src/
│   ├── index.ts              # Application entry point
│   ├── cosmosService.ts      # Cosmos DB service layer
│   └── ui/
│       └── app.ts            # Main TUI application
├── dist/                     # Compiled JavaScript
├── .env                      # Environment configuration
├── package.json
└── tsconfig.json
```

### Build Commands
```bash
# Development with hot reload
bun dev

# Production build
bun run build

# Run application
bun start

# Test connection
bun run test-connection
```

### Technology Stack
- **Bun**: Fast JavaScript runtime and toolkit
- **TypeScript**: Type-safe development
- **Blessed**: Terminal UI framework
- **Azure Cosmos DB SDK**: Database connectivity
- **dotenv**: Environment configuration

## 🔑 Key Bindings Reference

| Key | Action | Context |
|-----|--------|---------|
| `Tab` | Next panel | Global |
| `Shift+Tab` | Previous panel | Global |
| `↑/↓` or `j/k` | Navigate list | Lists |
| `Enter` | Select/Open | Lists |
| `n` | New item | All panels |
| `d` | Delete item | All panels |
| `/` | SQL query | Documents |
| `r` | Refresh | All panels |
| `e` | Edit document | Detail view |
| `Esc` | Back/Cancel | Modals |
| `q` | Quit | Global |
| `Ctrl+C` | Force quit | Global |
| `Ctrl+S` | Save | Editors |

## 🎯 Features Roadmap

- [ ] Document editing with JSON validation
- [ ] Export query results to JSON/CSV
- [ ] Query history and favorites
- [ ] Batch operations
- [ ] Connection management (multiple accounts)
- [ ] Container metrics and statistics
- [ ] Stored procedures and UDF management
- [ ] Trigger management
- [ ] Index policy viewer/editor
- [ ] TTL configuration
- [ ] Conflict resolution policies
- [ ] Change feed monitoring
- [ ] Performance metrics dashboard
- [ ] Dark/Light theme switching
- [ ] Configuration file support

## 🐛 Troubleshooting

### Connection Issues
- Verify `COSMOS_ENDPOINT` and `COSMOS_KEY` in `.env`
- Check network connectivity to Azure
- Ensure firewall rules allow your IP address

### Display Issues
- Ensure terminal supports Unicode characters
- Try resizing terminal window
- Update terminal emulator to latest version

### Performance
- Limit query results with `TOP N` clause
- Use specific queries instead of `SELECT *`
- Consider pagination for large datasets

## 📝 License

MIT License - feel free to use this project for any purpose.

## 🤝 Contributing

Contributions welcome! Areas of interest:
- UI/UX improvements
- Performance optimization
- Additional Cosmos DB features
- Bug fixes and testing
- Documentation improvements

## 🙏 Acknowledgments

- Inspired by [LazyGit](https://github.com/jesseduffield/lazygit)
- Built with [Blessed](https://github.com/chjj/blessed)
- Powered by [Azure Cosmos DB](https://azure.microsoft.com/services/cosmos-db/)

## 📧 Support

For issues and feature requests, please create an issue in the repository.

---

**Happy Cosmos DB exploring!** 🚀✨
