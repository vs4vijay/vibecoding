# Cosmos DB TUI - Quick Start Guide

## First Time Setup

### 1. Install Bun
Ensure you have Bun installed:
```bash
# Windows
powershell -c "irm bun.sh/install.ps1|iex"

# Linux/macOS
curl -fsSL https://bun.sh/install | bash

# Verify installation
bun --version
```

### 2. Install Dependencies
```bash
bun install
```

### 3. Configure Cosmos DB Connection
Copy the example environment file:
```bash
cp .env.example .env
```

Edit `.env` with your Azure Cosmos DB credentials:
```env
COSMOS_ENDPOINT=https://your-account.documents.azure.com:443/
COSMOS_KEY=your-primary-key-here
```

#### Finding Your Credentials in Azure Portal:
1. Navigate to your Cosmos DB account in Azure Portal
2. Go to **Keys** section in the left menu
3. Copy the **URI** (endpoint) and **PRIMARY KEY**

### 4. Run the Application
```bash
bun start
```

Or use the launcher scripts:
- **Windows**: `launch.bat`
- **Linux/Mac**: `./launch.sh`

## Basic Navigation

### Panel Navigation
The interface has 4 main panels:
```
[Databases] → [Containers] → [Documents] → [Detail]
```

Use **Tab** to move forward, **Shift+Tab** to move backward.

### Selecting Items
1. Use **↑↓** or **j/k** to navigate lists
2. Press **Enter** to select an item
3. The next panel will populate with related data

## Common Tasks

### Viewing Data
1. Start at **Databases** panel
2. Select a database with **Enter**
3. Move to **Containers** (Tab)
4. Select a container with **Enter**
5. Move to **Documents** (Tab)
6. View document details with **Enter**

### Creating a Database
1. Focus on **Databases** panel
2. Press **n** for "new"
3. Enter database ID
4. Press **Enter** to create

### Creating a Container
1. Select a database first
2. Focus on **Containers** panel
3. Press **n** for "new"
4. Enter container ID
5. Enter partition key (e.g., `/id`)
6. Press **Enter** to create

### Creating a Document
1. Select a database and container first
2. Focus on **Documents** panel
3. Press **n** for "new"
4. Edit JSON in the editor
5. Press **Ctrl+S** to save
6. Press **Esc** to cancel

### Running SQL Queries
1. Focus on **Documents** panel
2. Press **/** to open query editor
3. Enter your SQL query (e.g., `SELECT * FROM c WHERE c.status = 'active'`)
4. Press **Enter** to execute
5. Results will appear in the document list

### Deleting Items
1. Navigate to the item you want to delete
2. Press **d** for "delete"
3. Confirm the deletion in the dialog

## Keyboard Shortcuts Cheat Sheet

| Key | Action |
|-----|--------|
| `Tab` | Next panel |
| `↑↓` or `j/k` | Navigate list |
| `Enter` | Select/Open |
| `n` | Create new |
| `d` | Delete |
| `/` | Query (documents) |
| `r` | Refresh |
| `q` | Quit |
| `Esc` | Cancel/Back |
| `Ctrl+S` | Save (in editor) |
| `Ctrl+C` | Force quit |

## Example SQL Queries

### Basic Queries
```sql
-- Select all documents
SELECT * FROM c

-- Select first 10 documents
SELECT TOP 10 * FROM c

-- Count documents
SELECT VALUE COUNT(1) FROM c
```

### Filtering
```sql
-- Filter by field
SELECT * FROM c WHERE c.status = 'active'

-- Multiple conditions
SELECT * FROM c WHERE c.status = 'active' AND c.age > 18

-- Pattern matching
SELECT * FROM c WHERE STARTSWITH(c.name, 'John')
```

### Sorting
```sql
-- Order by timestamp (newest first)
SELECT * FROM c ORDER BY c._ts DESC

-- Order by name
SELECT * FROM c ORDER BY c.name ASC
```

### Projections
```sql
-- Select specific fields
SELECT c.id, c.name, c.email FROM c

-- Rename fields
SELECT c.id, c.name AS fullName FROM c
```

### Aggregations
```sql
-- Group by category
SELECT c.category, COUNT(1) as count FROM c GROUP BY c.category

-- Sum values
SELECT SUM(c.price) as total FROM c
```

## Troubleshooting

### "Connection failed" error
- Check your `COSMOS_ENDPOINT` and `COSMOS_KEY` in `.env`
- Verify network connectivity to Azure
- Check Azure firewall rules

### Terminal display issues
- Ensure your terminal supports Unicode
- Try resizing the terminal window
- Use a modern terminal emulator (Windows Terminal, iTerm2, etc.)

### "Module not found" error
- Run `bun install` to install dependencies
- Delete `node_modules` and run `bun install` again

### Slow performance
- Use `TOP N` in queries to limit results
- Create indexes in Azure Portal for frequently queried fields
- Use specific WHERE clauses instead of SELECT *

## Tips and Tricks

1. **Bookmark Common Queries**: Create a text file with your frequently used queries for easy copy-paste
2. **Use Partition Keys**: Always specify partition keys when possible for better performance
3. **Refresh Often**: Press `r` to refresh data after external changes
4. **Learn Vim Keys**: Using `j/k` for navigation is faster than arrow keys
5. **Query Templates**: Start with simple queries and build complexity gradually

## Next Steps

- Explore the full [README.md](README.md) for advanced features
- Check [SQL query syntax documentation](https://docs.microsoft.com/azure/cosmos-db/sql-query-getting-started)
- Configure partition keys optimally for your use case
- Set up indexes in Azure Portal for better query performance

## Getting Help

- Press `?` in the application to see help
- Check the status bar for error messages
- Review application logs for detailed errors

---

Happy exploring! 🚀
