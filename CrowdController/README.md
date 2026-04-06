# CrowdCode 🤖

> An experimental crowdsourced coding system powered by OpenCode

CrowdCode is an automated system where the community proposes features through GitHub issues, votes on them, and OpenCode automatically implements the top-voted issue. It's a fun experiment to see what the internet can build together!

## 🎯 How It Works

1. **Submit**: Create an issue with your feature request or improvement
2. **Label**: Add the `crowdcode` label to make it eligible
3. **Vote**: Community votes with 👍 reactions
4. **Wait**: Issues need to be at least 24 hours old
5. **Automated**: The system picks the top-voted issue and implements it
6. **Review**: A pull request is created for human review
7. **Merge**: If approved, the changes are merged!

## 🚀 Features

- **Multiple Run Modes**: One-time, cron daemon, specific issue, or custom task
- **Flexible Deployment**: Run on your machine, cloud server, or GitHub Actions
- **Multi-Provider Support**: Works with Anthropic, OpenAI, Google Gemini, Azure, and more via OpenCode
- **Abuse Detection**: Built-in security checks for malicious patterns
- **Automated PR Creation**: Creates PRs with proper formatting and links
- **Status Updates**: Comments on issues to keep everyone informed
- **Tracking**: Creates tracking issues when no eligible issues exist

## 📋 Prerequisites

1. **Bun** - Fast JavaScript runtime ([Install Bun](https://bun.sh))
2. **OpenCode CLI** - Open source AI coding agent ([Install OpenCode](https://opencode.ai))
3. **GitHub Token** - Personal access token with repo access
4. **API Key** - API key for your chosen AI provider (Anthropic, OpenAI, etc.)

## 🛠️ Setup

### 1. Install Dependencies

```bash
bun install
```

### 2. Install OpenCode CLI

```bash
curl -fsSL https://opencode.ai/install | bash
```

### 3. Configure API Keys

OpenCode supports multiple AI providers. Set the appropriate environment variable for your provider:

- **Anthropic**: `ANTHROPIC_API_KEY`
- **OpenAI**: `OPENAI_API_KEY`
- **Google**: `GOOGLE_API_KEY`
- **Azure**: `AZURE_API_KEY`

```bash
# Example for Anthropic
export ANTHROPIC_API_KEY=your_anthropic_key_here
```

### 4. Configure Environment

Create a `.env` file (copy from `.env.example`):

```bash
cp .env.example .env
```

Edit `.env` and set your configuration:

```env
GITHUB_TOKEN=your_github_token_here
GITHUB_OWNER=vs4vijay
GITHUB_REPO=CrowdCode
OPENCODE_MODEL=anthropic/claude-sonnet-4-20250514
```

### 5. Get a GitHub Token

1. Go to GitHub Settings > Personal Access Tokens
2. Click "Generate new token (classic)"
3. Give it a name (e.g., "CrowdCode")
4. Select scopes: `repo` (or `public_repo` for public repos)
5. Generate and copy the token
6. Add it to your `.env` file

## 📖 Usage

### Run Once (Testing Mode)

```bash
bun run index.ts
```

### Run as Cron Daemon

```bash
# Check every 24 hours (default)
bun run index.ts --cron

# Check every hour
bun run index.ts --cron 60
```

### Implement Specific Issue

```bash
bun run index.ts --issue-id 42
```

### Implement Custom Task

```bash
bun run index.ts --task "Add dark mode support"
```

## ⚙️ Configuration

Configure via environment variables in `.env`:

| Variable | Description | Default |
|----------|-------------|---------|
| `GITHUB_TOKEN` | GitHub personal access token (required) | - |
| `GITHUB_OWNER` | Repository owner | `vs4vijay` |
| `GITHUB_REPO` | Repository name | `CrowdCode` |
| `OPENCODE_MODEL` | OpenCode model (provider/model format) | `anthropic/claude-sonnet-4-20250514` |
| `ISSUE_LABEL` | Label to filter issues | `crowdcode` |
| `MIN_REACTIONS` | Minimum 👍 reactions required | `1` |
| `MIN_ISSUE_AGE_HOURS` | Minimum issue age in hours | `24` |
| `WORKSPACE_PATH` | Temporary workspace directory | `./workspace` |
| `TIMEOUT_MINUTES` | Maximum execution time | `30` |
| `CRON_INTERVAL_MINUTES` | Default daemon interval | `1440` (24h) |

## 🤝 Contributing

### For Feature Requests

1. Create a new issue
2. Describe your feature clearly
3. Add the `crowdcode` label
4. Get community support (👍 reactions)
5. Wait at least 24 hours
6. The system will automatically implement top-voted issues

### Issue Guidelines

**Good Issues** ✅
- Clear, specific requirements
- Well-defined scope
- Single responsibility

**Bad Issues** ❌
- Vague descriptions
- Overly broad scope
- Malicious requests

### Abuse Prevention

The system automatically rejects issues that:
- Contain dangerous shell commands
- Request access to credentials
- Attempt system-wide modifications
- Include crypto mining patterns

## 🔒 Security

- All PRs require human review before merging
- Built-in abuse detection
- Execution timeout (30 minutes)
- Isolated workspace per execution

## 📜 License

MIT License - see [LICENSE](LICENSE) file

---

**Made with ❤️ and 🤖 by [@vs4vijay](https://github.com/vs4vijay)**

Powered by [OpenCode](https://opencode.ai) - The open source AI coding agent.
