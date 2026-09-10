# Vibecoding

A collection of AI-assisted projects built with vibe coding - the art of coding through natural language conversations with AI assistants.

---

## AI Coding Agents, Skills, and Tools uses

My Current Tooling:
- claude
- codex
- opencode
- pi / omp
- omniroute
- rtk
- context-mode
- playwright cli
- cmux
- Superset.sh
- herdr
  - herdr plugin install plannotator/herdr-annotate
  - https://colliepwa.dev/install
    - herdr plugin install AltanS/collie
    - herdr plugin action invoke start --plugin herdr.collie
- paseo
- orca - `brew install --cask stablyai/orca/orca`
- Skills
  - Playwright CLI Skills
  - Superpowers
  - hyperframes
- MCPs:
  - https://mcp.deepwiki.com/mcp
  - https://mcp.excalidraw.com
  - https://mcp.firecrawl.dev/v2/mcp

These projects were built using various coding harnesses, and skills:

### OpenCode

https://github.com/anomalyco/opencode

The open source AI coding agent. A powerful terminal-based AI assistant for developers, providing intelligent coding assistance directly in your terminal. Supports multiple AI providers including OpenAI, Anthropic Claude, Google Gemini, and more.

```bash
bun add -g opencode-ai
# for opencode v2
bun add -g --trust @opencode-ai/cli@next 

OPENCODE_SERVER_USERNAME=viz OPENCODE_SERVER_PASSWORD=VerySecurePasswordHere opencode web --hostname 0.0.0.0 --port 3030 --mdns --mdns-domain vizcode.local
```

### Oh My OpenAgent

https://github.com/code-yeongyu/oh-my-openagent

The best agent harness - a plugin that transforms OpenCode into a powerful multi-agent orchestration system with specialized agents (Sisyphus, Oracle, Librarian, etc.), MCP support, and parallel execution capabilities.

bunx oh-my-openagent install


### Pi Coding Agent

```bash
bun add -g @earendil-works/pi-coding-agent
bun add -g --ignore-scripts @earendil-works/pi-coding-agent

pi install npm:pi-llama-cpp
pi install npm:pi-web-access
pi install npm:pi-subagents
pi install npm:pi-context-view
pi install npm:pi-mcp-adapter
pi install npm:context-mode
pi install npm:pi-freeflow
pi install npm:@narumitw/pi-chrome-devtools
pi install npm:@narumitw/pi-statusline
pi install npm:@narumitw/pi-btw
pi install git:github.com/DietrichGebert/ponytail
pi install git:github.com/obra/superpowers
pi install git:github.com/cathrynlavery/diagram-design
pi install npm:@plannotator/pi-extension



export LLAMA_SERVER_URL=http://127.0.0.1:11000 # or change in ~/.pi/agents/settings.json
```

### Oh-my-pi

- https://omp.sh/

```bash
bun install -g @oh-my-pi/pi-coding-agent

omp plugin install context-mode
omp plugin install pi-freeflow
omp install git:github.com/obra/superpowers
omp install git:github.com/DietrichGebert/ponytail
omp install npm:pi-provider-kiro

# export AZURE_OPENAI_BASE_URL="..../v1"
# export AZURE_OPENAI_API_KEY="YOUR_AZURE_OPENAI_API_KEY"

# ~/.omp/agent/models.yml
providers:
  viz-router:
    baseUrl: http://localhost:11111
    apiKey: sk
    api: openai-completions
    auth: apiKey
    discovery:
      type: openai-models-list
```

### Tools used

- rtk-ai - `brew install rtk-ai/tap/rtk`
- context-mode `bun add -g context-mode`
- omniroute - `bun add -g omniroute`
- gnhf - `bun add -g gnhf`
- gsd - `bunx @opengsd/gsd-core@latest` https://github.com/open-gsd/gsd-core
- playwright-cli - `bun add -g playwright-cli`
- android-cli - https://developer.android.com/tools/agents/android-cli

### Skills used

- caveman - https://github.com/juliusbrussee/caveman
- playwright-cli Skills
- agent-browser
- superpowers Skills - https://github.com/obra/superpowers

```bash

# List Skills
bun x skills ls -g

bun x skills add https://github.com/vercel-labs/skills --skill find-skills
bun x skills add vercel-labs/agent-skills --skill skill-creator
bun x skills add anthropics/skills --skill skill-creator


# Playwright
bun add -g @playwright/cli@latest
playwright-cli install --skills
# OR
bun x skills add -g https://github.com/microsoft/playwright-cli --skill playwright-cli

bun x skills add https://github.com/browser-use/browser-use --skill browser-use
bun x skills add vercel-labs/agent-browser
bun add -g agent-browser
agent-browser install

bun x skills add manaflow-ai/cmux -g -y

bun x skills add remotion/agent-skills
bun x skills add heygen-com/hyperframes

bun x skills add juliusbrussee/caveman@caveman
claude skill add juliusbrussee/caveman:caveman


bun x skills@latest add mattpocock/skills --full-depth


android init
android skills add --skill base

# OLD
bun x skills add https://github.com/coleam00/excalidraw-diagram-skill --skill excalidraw-diagram
```

## MCP used

https://mcp.deepwiki.com/mcp
https://mcp.excalidraw.com
https://mcp.firecrawl.dev/v2/mcp
https://mcp.context7.com/mcp
https://mcp.notion.com/mcp
https://cloud.comfy.org/mcp
https://search.parallel.ai/mcp
https://api.githubcopilot.com/mcp

```bash
claude mcp add --transport http excalidraw https://mcp.excalidraw.com

claude mcp add --scope project --transport http plane https://mcp.plane.so/http/mcp

codex mcp add context7 -- npx -y @upstash/context7-mcp

codex mcp add excalidraw --url https://mcp.excalidraw.com

codex mcp add github --url https://api.githubcopilot.com/mcp/

codex mcp add plane --url https://mcp.plane.so/http/mcp

codex mcp add deepwiki --url https://mcp.deepwiki.com/mcp

codex mcp add context-mode -- npx -y context-mode

pip install comfy-mcp

```

## Experiments

```
bun install -g @openai/codex
alias vcodex="CODEX_HOME=~/.codex-vijay codex"

herdr
curl -fsSL https://herdr.dev/install.sh | sh

paseo
bun install -g @getpaseo/cli

GSD

BMAD

OpenSpec
https://github.com/Fission-AI/OpenSpec

https://github.com/Priivacy-ai/spec-kitty

Superpowers

ECC
https://github.com/affaan-m/ecc

https://github.com/zebbern/claude-code-guide

Context Mode
bun install -g context-mode
https://github.com/mksglu/context-mode

gnhf

Mnemosyne
https://github.com/rohitg00/agentmemory
https://github.com/supermemoryai/supermemory
https://github.com/MemPalace/mempalace
https://github.com/thedotmack/claude-mem

uv tool install -U batrachian-toad

OmniRoute

CLIProxyAPI

codewhale

https://github.com/Fission-AI/OpenSpec

uvx --python 3.11 open-webui@latest serve

https://github.com/agent-of-empires/agent-of-empires

https://github.com/Gitlawb/openclaude

https://github.com/1jehuang/jcode

https://github.com/virgiliojr94/book-to-skill

curl -fsSL https://app.primeintellect.ai/prime-agent/install.sh | sh

https://github.com/cloudflare/computer

https://crabbox.sh/

https://github.com/mksglu/context-mode



bunx skills@latest update
bunx skills@latest add addyosmani/agent-skills --list 
bunx skills@latest add mattpocock/skills
bunx skills@latest add anthropics/claude-code --skill frontend-design
bunx skills@latest add obra/superpowers

bunx skills add https://github.com/nextlevelbuilder/ui-ux-pro-max-skill --skill ui-ux-pro-max



Gauntlet Loop

Claude Squad

https://github.com/gemini-cli-extensions/conductor

https://github.com/affaan-m/ecc

https://github.com/edgehero/pi-dispatch

context7

chrome-devtools-mcp

codeburn

https://github.com/cathrynlavery/diagram-design

bun install -g cline

OpenChambers

https://github.com/apmantza/pi-free

https://github.com/AltanS/collie

https://github.com/kunchenguid/firstmate

OpenClaude

```

## Prompts

### Browser Automation

Use `agent-browser` for web automation. Run `agent-browser --help` for all commands.

Core workflow:

1. `agent-browser open <url>` - Navigate to page
2. `agent-browser snapshot -i` - Get interactive elements with refs (@e1, @e2)
3. `agent-browser click @e1` / `fill @e2 "text"` - Interact using refs
4. Re-snapshot after page changes

---

## Games

Browser games built in this repo, deployed together to GitHub Pages via a
single combined workflow (`.github/workflows/games-pages-deploy.yml`).

**🎮 Games portal:** [vs4vijay.github.io/vibecoding](https://vs4vijay.github.io/vibecoding/)

| Game | Play | Source | Stack |
|---|---|---|---|
| **Undead Driver** | [vs4vijay.github.io/vibecoding/undead-driver](https://vs4vijay.github.io/vibecoding/undead-driver/) | [`undead-driver/`](./undead-driver) | TypeScript, Vite, three.js |
| **Tank Racer** | [vs4vijay.github.io/vibecoding/tank-racer](https://vs4vijay.github.io/vibecoding/tank-racer/) | [`tank-racer/`](./tank-racer) | TypeScript, Vite, three.js |
| **Lugaru Combat** | [vs4vijay.github.io/vibecoding/lugaru-combat](https://vs4vijay.github.io/vibecoding/lugaru-combat/) | [`lugaru-combat/`](./lugaru-combat) | TypeScript, Vite, three.js, Rapier |
| **Dave Dangerous** | [vs4vijay.github.io/vibecoding/dave-dangerous](https://vs4vijay.github.io/vibecoding/dave-dangerous/) | [`dave-dangerous/`](./dave-dangerous) | TypeScript, Vite 5 |
| **Dustline** | local server — `cd dustline && bun run dev` ([quickstart](./dustline#readme)) | [`dustline/`](./dustline) | TypeScript, Vite, three.js · Bun + Hono + WebSocket |

In development: [`subway-surfers/`](./subway-surfers), [`lf2-web/`](./lf2-web).

Dustline is the exception to the Pages flow: it needs its own WebSocket game
server, so it runs locally instead of as a static site.

Building a new game? Follow the playbook: [docs/GAMES.md](./docs/GAMES.md) —
scaffolding conventions, test/verification expectations, the deployment
workflow (and why there is exactly one), and the new-game checklist.

---

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

### [happns](./happns)

**Real-Time Community & Social Feed**

A modern community feed app with real-time updates, posting, and social interactions.

- **URL**: https://happns.onrender.com/
- **Tech**: Next.js, TypeScript, Tailwind CSS
- **Features**: Live feed, responsive UI, social activity stream

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
