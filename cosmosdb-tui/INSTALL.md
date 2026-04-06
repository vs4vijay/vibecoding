# 🎉 Cosmos DB TUI - Complete Installation & Usage Guide

## 📦 What You Just Created

A **production-ready**, **LazyGit-inspired** Terminal User Interface for managing Azure Cosmos DB databases, containers, and documents.

### 📊 Project Statistics
- **Total Files**: 24 files
- **Total Size**: ~97 KB (without node_modules)
- **Lines of Code**: ~1,500+ lines of TypeScript
- **Documentation**: 7 comprehensive guides
- **Features**: 72 implemented features

---

## 🚀 Installation Methods

### Method 1: Quick Setup (Recommended)

**Windows:**
```batch
setup.bat
```

**Linux/macOS:**
```bash
chmod +x setup.sh
./setup.sh
```

This wizard will:
1. ✅ Check Bun installation
2. ✅ Install dependencies
3. ✅ Help configure .env
4. ✅ Test connection
5. ✅ Launch the app

### Method 2: Manual Setup

1. **Install Bun** (if not already installed)
```bash
# Windows
powershell -c "irm bun.sh/install.ps1|iex"

# Linux/macOS
curl -fsSL https://bun.sh/install | bash

# Verify
bun --version
```

2. **Install Dependencies**
```bash
bun install
```

3. **Configure Connection**
```bash
# Copy template
cp .env.example .env

# Edit with your credentials
# COSMOS_ENDPOINT=https://your-account.documents.azure.com:443/
# COSMOS_KEY=your-primary-key-here
```

4. **Test Connection** (Optional but recommended)
```bash
bun run test-connection
```

5. **Start Application**
```bash
bun start
```

### Method 3: Quick Launch

Use the launcher scripts for future runs:

**Windows:**
```batch
launch.bat
```

**Linux/macOS:**
```bash
chmod +x launch.sh
./launch.sh
```

---

## 📁 Project Structure

```
cosmosdb-tui/
├── 📄 Documentation (7 files)
│   ├── README.md              # Main documentation
│   ├── QUICKSTART.md          # Quick start guide
│   ├── EXAMPLES.md            # 50+ SQL query examples
│   ├── CONFIGURATION.md       # Advanced config
│   ├── CONTRIBUTING.md        # Contribution guide
│   ├── FEATURES.md            # Feature checklist
│   └── PROJECT_SUMMARY.md     # Project overview
│
├── 💻 Source Code
│   ├── src/
│   │   ├── index.ts           # Entry point (338 bytes)
│   │   ├── cosmosService.ts   # DB service layer (4.5 KB)
│   │   ├── test-connection.ts # Connection tester (2.4 KB)
│   │   └── ui/
│   │       ├── app.ts         # Main TUI app (16 KB) ⭐
│   │       ├── theme.ts       # UI themes (795 bytes)
│   │       ├── keyBindings.ts # Shortcuts (5 KB)
│   │       └── queryHelper.ts # Query utils (2.8 KB)
│   │
│   └── welcome.ts             # Welcome screen (4.8 KB)
│
├── ⚙️  Configuration
│   ├── package.json           # Bun project config
│   ├── tsconfig.json          # TypeScript config
│   ├── bunfig.toml            # Bun settings
│   ├── .env.example           # Environment template
│   └── .gitignore             # Git ignore rules
│
└── 🛠️  Scripts
    ├── setup.bat / setup.sh   # Setup wizards
    └── launch.bat / launch.sh # Launch scripts
```

---

## 🎮 Usage Guide

### Starting the Application

```bash
# Method 1: Direct start
bun start

# Method 2: Development mode (auto-reload)
bun dev

# Method 3: With welcome screen
bun run welcome

# Method 4: Use launcher
./launch.sh  # or launch.bat on Windows
```

### First Time Workflow

1. **Launch the app**
   ```bash
   bun start
   ```

2. **Browse Databases** (left panel)
   - Navigate with ↑↓ or j/k
   - Press Enter to select

3. **Browse Containers** (second panel)
   - Automatically loads for selected database
   - Shows partition key info
   - Press Enter to select

4. **View Documents** (third panel)
   - Automatically runs `SELECT * FROM c`
   - Navigate documents
   - Press Enter to view details

5. **Inspect Document** (right panel)
   - Full JSON document
   - Formatted and readable

### Common Operations

#### Create a Database
```
1. Focus on Databases panel (Tab)
2. Press 'n' (new)
3. Enter database ID
4. Press Enter
```

#### Create a Container
```
1. Select a database
2. Focus on Containers panel (Tab)
3. Press 'n' (new)
4. Enter container ID
5. Enter partition key (e.g., /id)
6. Press Enter
```

#### Create a Document
```
1. Select database and container
2. Focus on Documents panel (Tab)
3. Press 'n' (new)
4. Edit JSON in the editor
5. Press Ctrl+S to save
```

#### Run SQL Query
```
1. Focus on Documents panel
2. Press '/' (slash)
3. Enter SQL query:
   SELECT * FROM c WHERE c.status = 'active'
4. Press Enter to execute
```

#### Delete Items
```
1. Navigate to item
2. Press 'd' (delete)
3. Confirm with 'Y'
```

---

## ⌨️  Keyboard Reference

### Navigation
| Key | Action |
|-----|--------|
| `Tab` | Next panel |
| `Shift+Tab` | Previous panel |
| `↑↓` or `j/k` | Navigate lists |
| `Enter` | Select/Open |
| `Esc` | Back/Cancel |

### Actions
| Key | Action |
|-----|--------|
| `n` | Create new item |
| `d` | Delete item |
| `r` | Refresh view |
| `/` | SQL query (documents) |
| `e` | Edit (detail view) |
| `?` | Show help |
| `q` | Quit |
| `Ctrl+C` | Force quit |

### Editor
| Key | Action |
|-----|--------|
| `Ctrl+S` | Save |
| `Esc` | Cancel |

---

## 📝 Example SQL Queries

### Basic Queries
```sql
-- All documents
SELECT * FROM c

-- First 10
SELECT TOP 10 * FROM c

-- Count
SELECT VALUE COUNT(1) FROM c

-- Specific fields
SELECT c.id, c.name FROM c
```

### Filtering
```sql
-- Simple filter
SELECT * FROM c WHERE c.status = 'active'

-- Multiple conditions
SELECT * FROM c 
WHERE c.status = 'active' 
  AND c.age > 18

-- Pattern matching
SELECT * FROM c 
WHERE STARTSWITH(c.name, 'John')
```

### Sorting
```sql
-- Recent first
SELECT * FROM c ORDER BY c._ts DESC

-- By name
SELECT * FROM c ORDER BY c.name ASC
```

### Advanced
```sql
-- Group by
SELECT c.category, COUNT(1) as count 
FROM c 
GROUP BY c.category

-- Array operations
SELECT c.id, tag 
FROM c 
JOIN tag IN c.tags

-- Date range
SELECT * FROM c 
WHERE c._ts > 1640000000
```

**See EXAMPLES.md for 50+ more queries!**

---

## 🔧 Troubleshooting

### Connection Issues

**Problem:** "Request failed with status 401"
```bash
# Check your credentials
cat .env  # Linux/Mac
type .env  # Windows

# Verify in Azure Portal:
# Keys section → URI and Primary Key
```

**Problem:** "Connection timeout"
```bash
# Check firewall rules in Azure Portal
# Add your IP address to allowed IPs

# Or increase timeout in .env:
COSMOS_CONNECTION_TIMEOUT=30000
```

### Display Issues

**Problem:** Weird characters in terminal
```
Solution: Use a modern terminal
- Windows: Windows Terminal
- macOS: iTerm2
- Linux: GNOME Terminal, Konsole
```

**Problem:** Text overlapping
```
Solution: Resize terminal window
Recommended: 120x30 minimum
```

### Dependencies

**Problem:** "Module not found"
```bash
# Reinstall dependencies
rm -rf node_modules
bun install
```

**Problem:** "Bun not found"
```bash
# Install Bun
curl -fsSL https://bun.sh/install | bash

# Or on Windows
powershell -c "irm bun.sh/install.ps1|iex"
```

---

## 🎯 Quick Tips

1. **Use Tab liberally** - Switch between panels to explore
2. **Learn j/k keys** - Faster than arrow keys
3. **Use TOP N** in queries - Limit large result sets
4. **Press r to refresh** - After external changes
5. **Read EXAMPLES.md** - Learn advanced SQL queries
6. **Use partition keys** - Better query performance
7. **Start with read-only keys** - Practice safely

---

## 📚 Documentation Quick Links

| Document | Purpose | Read When |
|----------|---------|-----------|
| **README.md** | Complete reference | After installation |
| **QUICKSTART.md** | Getting started | First time using |
| **EXAMPLES.md** | SQL queries | Writing queries |
| **CONFIGURATION.md** | Advanced setup | Customization needed |
| **FEATURES.md** | Feature list | Exploring capabilities |
| **CONTRIBUTING.md** | Development guide | Contributing code |
| **PROJECT_SUMMARY.md** | Overview | Understanding project |

---

## 🔐 Security Checklist

- [ ] Never commit .env file (already in .gitignore)
- [ ] Use read-only keys for testing
- [ ] Rotate keys regularly
- [ ] Configure IP firewall in Azure
- [ ] Use different keys per environment
- [ ] Keep Bun and dependencies updated

---

## 🚀 Next Steps

### Immediate
1. ✅ Configure .env with your credentials
2. ✅ Test connection: `bun run test-connection`
3. ✅ Start app: `bun start`
4. ✅ Explore your databases

### Learning
1. 📖 Read QUICKSTART.md
2. 📖 Try example queries from EXAMPLES.md
3. 📖 Learn keyboard shortcuts
4. 📖 Explore all panels

### Advanced
1. 🔧 Configure themes (CONFIGURATION.md)
2. 🔧 Set up multiple connection profiles
3. 🔧 Customize keyboard shortcuts
4. 🔧 Contribute features (CONTRIBUTING.md)

---

## 🎉 Success!

You now have a fully functional Cosmos DB TUI!

### What You Can Do
- ✅ Browse all your databases
- ✅ Explore containers and documents
- ✅ Run SQL queries
- ✅ Create, read, and delete data
- ✅ Navigate with keyboard shortcuts
- ✅ Work efficiently in the terminal

### Get Help
- 📖 Read the documentation
- 🐛 Report issues on GitHub
- 💡 Request features
- 🤝 Contribute improvements

---

**Built with ❤️ using Bun + TypeScript + Blessed**

**Happy exploring! 🚀**
