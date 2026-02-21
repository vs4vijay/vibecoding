# Vibecoding

A collection of AI-assisted projects built with vibe coding - the art of coding through natural language conversations with AI assistants.

## Projects

### [WealthIQ](./wealthiq)

**Indian Mutual Fund Dashboard**

A comprehensive dashboard for tracking and analyzing Indian mutual funds using real-time data from MFapi.in.

- **Tech**: React 19, TypeScript, Vite, TailwindCSS, Chart.js
- **Features**: Real-time NAV data, search & filter, interactive charts, responsive design
- **Package Manager**: Bun

---

### [API Studio](./APIStudio)

**Open Source REST Client for Every API**

A next-generation, open source REST client designed to empower developers and teams to build, test, and collaborate on APIs.

- **Tech**: Tauri 2.x, React 18, TypeScript, SQLite, TailwindCSS
- **Features**: OAuth 2.0/Azure AD auth, collections, environment variables, code generation, P2P sharing
- **Package Manager**: Bun

---

### [MarketPulse](./marketpulse)

**Indian Stock Sentiment Analysis Bot**

Analyzes news from multiple sources, performs sentiment analysis using FinBERT or LLM APIs, and suggests stocks based on positive sentiment.

- **Tech**: Python 3.12+, SQLAlchemy, Textual, python-telegram-bot
- **Features**: Multi-source news aggregation, FinBERT/LLM sentiment analysis, Telegram bot + TUI interfaces
- **Package Manager**: uv

---

### [ESP32-Mirage](./ESP32-Mirage)

**Satellite Image Clock & Environmental Monitor**

ESP32-based IoT display system providing real-time environmental information with modular, configurable features.

- **Tech**: ESP32, PlatformIO, Arduino framework
- **Features**: Satellite imagery clock, PAX counter, planes tracking, weather, AQI, traffic, news, sound alerts
- **Supported Boards**: ESP32-DevKit, LilyGo T-Display, M5Stack series, ESP32 Geek

---

### [ESP32-Auto](./ESP32-Auto)

**Wireless Android Auto Dongle**

ESP32-S3 based implementation of a Wireless Android Auto dongle bridging USB from car headunit with WiFi/Bluetooth to Android phone.

- **Tech**: ESP32-S3, ESP-IDF v5.0+, FreeRTOS
- **Features**: WiFi hotspot, BLE advertising, USB OTG device mode, AOA protocol
- **Status**: Early-stage proof of concept

---

### [CosmosDB TUI](./cosmosdb-tui)

**LazyGit-inspired TUI for Azure Cosmos DB**

A terminal user interface for managing Azure Cosmos DB databases, containers, and documents.

- **Tech**: TypeScript, Bun, Blessed, Azure Cosmos DB SDK
- **Features**: Database/container management, SQL query interface, document operations
- **Interface**: LazyGit-style keyboard navigation

---

### [Teams Bot Azure OpenAI](./teams-bot-azureopenai)

**Microsoft Teams Bot with Azure OpenAI**

Secure Teams bot integrating Azure OpenAI with Managed Identity for intelligent chat responses.

- **Tech**: TypeScript, Bun, Bot Framework SDK, Azure OpenAI
- **Features**: Managed Identity auth, conversation history, extensible architecture
- **Security**: DefaultAzureCredential, no hardcoded secrets

---

### [CrowdCode](./CrowdController)

**Crowdsourced Coding System**

Experimental automated system where community proposes features through GitHub issues, votes on them, and Claude Code implements top-voted requests.

- **Tech**: TypeScript, Bun, Octokit, simple-git
- **Features**: GitHub issue integration, vote-based prioritization, automated PR creation
- **Package Manager**: Bun

---

## Tools Used

These projects were built using:

### [OpenCode](https://github.com/anomalyco/opencode)

The open source AI coding agent. A powerful terminal-based AI assistant for developers, providing intelligent coding assistance directly in your terminal. Supports multiple AI providers including OpenAI, Anthropic Claude, Google Gemini, and more.

### [Oh My OpenCode](https://github.com/code-yeongyu/oh-my-opencode)

The best agent harness - a plugin that transforms OpenCode into a powerful multi-agent orchestration system with specialized agents (Sisyphus, Oracle, Librarian, etc.), MCP support, and parallel execution capabilities.

---

## Philosophy

**Vibe Coding** is about:

- Describing what you want in natural language
- Letting AI handle the implementation details
- Iterating through conversation, not manual debugging
- Focusing on the "what" while AI figures out the "how"

These projects serve as examples of what's possible when you combine human creativity and vision with AI coding assistants.

---

## Author

**Vijay Soni** ([@vs4vijay](https://github.com/vs4vijay))

---

## License

Individual projects have their own licenses. See each project's directory for details.
