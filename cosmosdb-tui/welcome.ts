#!/usr/bin/env bun

console.log(`
╔════════════════════════════════════════════════════════════════════════════╗
║                                                                            ║
║                        ██████╗ ██████╗ ███████╗███╗   ███╗ ██████╗        ║
║                       ██╔════╝██╔═══██╗██╔════╝████╗ ████║██╔═══██╗       ║
║                       ██║     ██║   ██║███████╗██╔████╔██║██║   ██║       ║
║                       ██║     ██║   ██║╚════██║██║╚██╔╝██║██║   ██║       ║
║                       ╚██████╗╚██████╔╝███████║██║ ╚═╝ ██║╚██████╔╝       ║
║                        ╚═════╝ ╚═════╝ ╚══════╝╚═╝     ╚═╝ ╚═════╝        ║
║                                                                            ║
║                           ██████╗ ██████╗     ████████╗██╗   ██╗██╗       ║
║                           ██╔══██╗██╔══██╗    ╚══██╔══╝██║   ██║██║       ║
║                           ██║  ██║██████╔╝       ██║   ██║   ██║██║       ║
║                           ██║  ██║██╔══██╗       ██║   ██║   ██║██║       ║
║                           ██████╔╝██████╔╝       ██║   ╚██████╔╝██║       ║
║                           ╚═════╝ ╚═════╝        ╚═╝    ╚═════╝ ╚═╝       ║
║                                                                            ║
║                    A LazyGit-Inspired Cosmos DB Manager                   ║
║                                                                            ║
╚════════════════════════════════════════════════════════════════════════════╝

                        🚀 Cosmos DB TUI - Version 1.0.0

                    Terminal-based Azure Cosmos DB Management
                        Fast • Keyboard-driven • Beautiful

────────────────────────────────────────────────────────────────────────────

📋 FEATURES:
   • Browse databases, containers, and documents
   • Execute SQL queries with syntax support
   • Create, read, update, and delete operations
   • LazyGit-style keyboard navigation
   • Vim-style movement (j/k keys)
   • Real-time data refresh

⌨️  QUICK START:
   1. Set up .env with your Cosmos DB credentials
   2. Run: bun install
   3. Run: bun start
   4. Press ? for help

📚 DOCUMENTATION:
   • README.md - Full documentation
   • QUICKSTART.md - Getting started guide
   • EXAMPLES.md - SQL query examples
   • FEATURES.md - Complete feature list

🎮 KEYBOARD SHORTCUTS:
   Tab          - Navigate panels
   ↑↓ / j/k     - Navigate lists
   Enter        - Select item
   n            - Create new
   d            - Delete
   /            - SQL query
   r            - Refresh
   q            - Quit

🔗 RESOURCES:
   GitHub:  github.com/yourusername/cosmosdb-tui
   Docs:    aka.ms/cosmosdb
   Bun:     bun.sh

────────────────────────────────────────────────────────────────────────────

                Built with ❤️  using Bun + TypeScript + Blessed

                    Press any key to start the application...

`);

// Wait for keypress
process.stdin.setRawMode(true);
process.stdin.resume();
process.stdin.once('data', () => {
  process.stdin.setRawMode(false);
  
  // Launch the main application
  console.log('\n🚀 Starting Cosmos DB TUI...\n');
  
  // Import and run the main app
  import('./src/index');
});
