# Introduction to Shadower

Welcome to **Shadower**, the **Enterprise Agentic Orchestration Platform**.

Shadower is a modern, full-stack AI platform built to enable businesses to build, deploy, and manage intelligent agents. Unlike simple chatbots, Shadower is designed for **Agentic Workflows**—where AI models are given the tools, context, and secure environments they need to perform real work.

## The Architecture

Shadower avoids black-box magic. It is built on a rock-solid, verifiable stack:

*   **Core Engine**: **Vercel AI SDK** provides the streaming and reasoning capabilities.
*   **Frontend**: **Next.js 16** with React Server Components for high performance.
*   **Infrastructure**: **Docker**, **PostgreSQL**, and **Redis** for reliable state management.

## Key Differentiators

### 1. The Theater Mode
Shadower introduces **Theater Mode**, a specialized workspace interface. When an agent generates code, a report, or a visualization, it isn't buried in the chat log. It opens in a dedicated, high-fidelity panel where you can interact with it—rendering React apps live or viewing Excel sheets natively.

### 2. Universal Integration
We believe in connectivity, not walled gardens.
*   **MCP (Model Context Protocol)**: Connect any internal data source or tool using the open standard.
*   **Native Ecosystem**: Instantly connect to Salesforce, GitHub, Gmail, and 200+ other SaaS platforms through our managed integration layer.

### 3. Local Execution
Complex tasks require code. Shadower provides **local terminal access** for direct code execution. Your agents can write Python scripts to analyze data or generate files with full access to your local development environment.

## Getting Started

*   **[Deployment Guide](/docs/tips-guides/docker)**: Get Shadower running in minutes using Docker.
*   **[MCP Setup](/docs/tips-guides/mcp-server-setup-and-tool-testing)**: Learn how to connect your own tools.
*   **[Authentication](/docs/tips-guides/oauth)**: Configure SSO for your organization.
