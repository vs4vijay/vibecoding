# API Studio

**Open Source REST Client for Every API**

API Studio is a next-generation, open source REST client designed to empower developers and teams to build, test, and collaborate on APIs with speed and confidence.

## Features

- **Universal API Support**: Interact with any RESTful API
- **Authentication Simplified**: OAuth 2.0, Azure AD, Bearer tokens, API keys, and more
- **Request Builder**: Customizable HTTP requests with headers, query params, and body content
- **Collections & Folders**: Organize requests into collections and folders
- **Environment Variables**: Switch between development, staging, and production environments
- **Response Viewer**: View responses in JSON, XML, or raw formats with syntax highlighting
- **Code Generation**: Generate code snippets for multiple languages
- **P2P Sharing**: Share collections via code or WebRTC links
- **History & Search**: Automatic request history with powerful search
- **Import & Export**: Support for Postman, Insomnia, and OpenAPI formats

## Technology Stack

- **Tauri 2.x**: Lightweight desktop framework
- **React 18**: UI framework with TypeScript
- **Bun**: JavaScript runtime and build tooling
- **SQLite**: Local data storage
- **TailwindCSS**: Styling

## Getting Started

### Prerequisites

- [Bun](https://bun.sh/) v1.0 or higher
- [Rust](https://www.rust-lang.org/) v1.70 or higher
- [Tauri CLI](https://tauri.app/)

### Installation

```bash
# Install dependencies
bun install

# Run in development mode
bun run tauri:dev

# Build for production
bun run tauri:build
```

## Development

```bash
# Run frontend only
bun run dev

# Run Tauri app
bun run tauri:dev
```

## Project Structure

```
APIStudio/
├── src/                 # React frontend
│   ├── components/      # UI components
│   ├── lib/             # Utilities and helpers
│   ├── stores/          # State management (Zustand)
│   ├── types/           # TypeScript types
│   └── styles/          # CSS files
├── src-tauri/          # Rust backend
│   ├── src/            # Rust source code
│   └── Cargo.toml      # Rust dependencies
└── package.json        # Node dependencies
```

## License

MIT License - see LICENSE file for details

## Contributing

Contributions are welcome! Please read our contributing guidelines before submitting PRs.

## Support

For issues and feature requests, please use the GitHub issue tracker.
