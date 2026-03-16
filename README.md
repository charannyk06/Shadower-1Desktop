# Shadower Desktop — Open-Source AI Orchestration Platform

**A local-first desktop AI agent builder.**

[![MIT License](https://img.shields.io/badge/License-MIT-green?style=flat-square)](./LICENSE)
[![MCP Native](https://img.shields.io/badge/MCP-Native-22c55e?style=flat-square)](https://modelcontextprotocol.io)
[![Electron](https://img.shields.io/badge/Electron-40-47848F?style=flat-square&logo=electron&logoColor=white)](https://www.electronjs.org/)

---

## What is Shadower Desktop?

Shadower Desktop is a local-first **AI Orchestration Platform** built on **Electron**, **React**, and the **Vercel AI SDK**. It provides a complete desktop environment for building, testing, and deploying AI agents that can browse the web, execute code, and connect to your tools — all running locally on your machine.

### Key Features

| Feature | Description |
| :--- | :--- |
| **Agentic Core** | Multi-step reasoning and tool chaining via Vercel AI SDK |
| **Universal Connectivity** | Native MCP support + 200+ app integrations |
| **Theater Mode** | High-fidelity workspace for visualizing agent outputs (apps, PDFs, charts) |
| **Code Execution** | Secure sandboxed execution via E2B |
| **Local-First** | SQLite database, all data stays on your machine |
| **Voice** | Real-time voice assistant with low-latency WebSockets |

---

## Tech Stack

- **Framework**: [Electron 40](https://www.electronjs.org/) + [React 18](https://react.dev/) + [Vite 5](https://vite.dev/)
- **AI Engine**: [Vercel AI SDK](https://sdk.vercel.ai)
- **Database**: SQLite (local, via better-sqlite3) with optional PostgreSQL
- **ORM**: Drizzle ORM
- **Router**: TanStack Router
- **Styling**: Tailwind CSS v4, Shadcn UI, Framer Motion
- **Testing**: Playwright (E2E), Vitest (Unit)

---

## Getting Started

### Prerequisites

- [Node.js 20+](https://nodejs.org)
- [pnpm](https://pnpm.io/)

### Development

```bash
# Clone the repo
git clone https://github.com/shadower-app/Shadower-Desktop.git
cd Shadower-Desktop

# Install dependencies
pnpm i

# Configure environment
cp .env.example .env
# Edit .env and add your LLM API keys

# Start dev server (Electron + Vite with hot-reload)
pnpm dev
```

### Building

```bash
# Build for your platform
pnpm build:mac    # macOS (DMG)
pnpm build:win    # Windows (NSIS installer)
pnpm build:linux  # Linux (AppImage + deb)
```

### Environment Variables

Copy `.env.example` and add the API keys you want to use:

```bash
# At least one LLM provider key
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
GOOGLE_GENERATIVE_AI_API_KEY=

# Optional enhancements
EXA_API_KEY=         # Web search
```

See `.env.example` for the full list.

---

## Project Structure

```
electron/          # Electron main process
  ├── ipc/         # IPC handlers (AI, browser, files, etc.)
  ├── services/    # Background services (updater, telemetry, etc.)
  └── main.ts      # App entry point
src/               # Renderer process (React)
  ├── components/  # UI components
  ├── hooks/       # Custom React hooks
  ├── lib/         # Core logic (AI, auth, db, tools)
  └── routes/      # TanStack Router pages
resources/         # App icons and platform assets
scripts/           # Build and utility scripts
```

---

## Roadmap

- [x] Electron Desktop Migration
- [x] Theater Mode V3
- [x] MCP Native Integration
- [ ] RAG Knowledge Base
- [ ] Multi-Agent Collaboration
- [ ] Plugin System

---

## Contributing

We welcome contributions! See [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.

## Security

To report a vulnerability, see [SECURITY.md](./SECURITY.md).

## License

[MIT](./LICENSE)
