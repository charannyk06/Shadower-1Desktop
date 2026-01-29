"use client";
import {
  ArrowUpRight,
  Brain,
  Clock,
  Database,
  FileText,
  Folder,
  GitBranch,
  Globe,
  Lightbulb,
  Search,
  Terminal,
} from "lucide-react";
import { Link } from "@tanstack/react-router";
import { navigateTo } from "@/router";
import { MCPIcon } from "ui/mcp-icon";

import { AsanaIcon } from "ui/asana-icon";
import { AtlassianIcon } from "ui/atlassian-icon";
import { BraveIcon } from "ui/brave-icon";
import { Button } from "ui/button";
import { CanvaIcon } from "ui/canva-icon";
import { ExaIcon } from "ui/exa-icon";
import { FigmaIcon } from "ui/figma-icon";
import { GitIcon } from "ui/git-icon";
import { GithubIcon } from "ui/github-icon";
import { LinearIcon } from "ui/linear-icon";
import { NeonIcon } from "ui/neon-icon";
import { NotionIcon } from "ui/notion-icon";
import { PaypalIcon } from "ui/paypal-icon";
import { PlaywrightIcon } from "ui/playwright-icon";
import { PostgreSQLIcon } from "ui/postgresql-icon";
import { PuppeteerIcon } from "ui/puppeteer-icon";
import { StripeIcon } from "ui/stripe-icon";
import type { ComponentType, SVGProps } from "react";
import type { MCPServerConfig } from "app-types/mcp";

// MCP Server categories
export type MCPCategory =
  | "all"
  | "development"
  | "automation"
  | "database"
  | "productivity"
  | "system"
  | "search"
  | "design"
  | "payments"
  | "cloud";

export const MCP_CATEGORIES: {
  id: MCPCategory;
  label: string;
  icon: ComponentType<any>;
}[] = [
  { id: "all", label: "All", icon: Globe },
  { id: "development", label: "Development", icon: GitBranch },
  { id: "automation", label: "Automation", icon: Terminal },
  { id: "database", label: "Database", icon: Database },
  { id: "productivity", label: "Productivity", icon: FileText },
  { id: "system", label: "System", icon: Folder },
  { id: "search", label: "Search", icon: Search },
  { id: "design", label: "Design", icon: CanvaIcon },
  { id: "payments", label: "Payments", icon: StripeIcon },
  { id: "cloud", label: "Cloud", icon: Globe },
];

// Recommended MCP server type
// Environment variable that needs to be prompted during installation
export interface RequiredEnvVar {
  name: string;
  label: string;
  description: string;
  isSecret?: boolean; // If true, input will be masked
  helpUrl?: string; // URL to help page for getting this value
}

export interface RecommendedMCP {
  name: string;
  label: string;
  description: string;
  category: MCPCategory;
  official: boolean;
  requiresAuth: boolean;
  requiredEnvVars?: RequiredEnvVar[]; // Env vars that need to be prompted
  config: MCPServerConfig;
  icon: ComponentType<SVGProps<SVGSVGElement> & { className?: string }>;
}

// Official MCP servers registry - organized by category
export const RECOMMENDED_MCPS: RecommendedMCP[] = [
  // === DEVELOPMENT ===
  {
    name: "github",
    label: "GitHub",
    description:
      "Access GitHub repositories, issues, and PRs. Requires a GitHub Personal Access Token.",
    category: "development",
    official: true,
    requiresAuth: false, // Uses PAT via env var, not OAuth
    requiredEnvVars: [
      {
        name: "GITHUB_PERSONAL_ACCESS_TOKEN",
        label: "GitHub Personal Access Token",
        description: "Create a PAT with repo, read:org, and gist scopes",
        isSecret: true,
        helpUrl:
          "https://github.com/settings/tokens/new?scopes=repo,read:org,gist",
      },
    ],
    config: {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-github"],
      env: {
        GITHUB_PERSONAL_ACCESS_TOKEN: "",
      },
    },
    icon: GithubIcon,
  },
  {
    name: "git",
    label: "Git",
    description: "Local Git operations - commits, branches, diffs, and history",
    category: "development",
    official: true,
    requiresAuth: false,
    config: {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-git"],
    },
    icon: GitIcon,
  },

  // === BROWSER/AUTOMATION ===
  {
    name: "playwright",
    label: "Playwright",
    description: "Browser automation for testing and web scraping",
    category: "automation",
    official: true,
    requiresAuth: false,
    config: {
      command: "npx",
      args: ["-y", "@playwright/mcp@latest"],
    },
    icon: PlaywrightIcon,
  },
  {
    name: "puppeteer",
    label: "Puppeteer",
    description: "Headless browser automation with Chrome DevTools Protocol",
    category: "automation",
    official: true,
    requiresAuth: false,
    config: {
      command: "npx",
      args: ["-y", "@anthropic-ai/mcp-server-puppeteer"],
    },
    icon: PuppeteerIcon,
  },
  {
    name: "fetch",
    label: "Fetch",
    description: "HTTP requests - fetch URLs and web content",
    category: "automation",
    official: true,
    requiresAuth: false,
    config: {
      command: "npx",
      args: ["-y", "@anthropic-ai/mcp-server-fetch"],
    },
    icon: Globe,
  },

  // === DATABASE ===
  {
    name: "neon",
    label: "Neon",
    description: "Serverless Postgres database with branching and scaling",
    category: "database",
    official: true,
    requiresAuth: true,
    config: {
      url: "https://mcp.neon.tech/mcp",
    },
    icon: NeonIcon,
  },
  {
    name: "postgres",
    label: "PostgreSQL",
    description: "Connect to PostgreSQL databases - query, schema, and data",
    category: "database",
    official: true,
    requiresAuth: false,
    config: {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-postgres"],
    },
    icon: PostgreSQLIcon,
  },
  {
    name: "sqlite",
    label: "SQLite",
    description: "Local SQLite database operations and queries",
    category: "database",
    official: true,
    requiresAuth: false,
    config: {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-sqlite"],
    },
    icon: Database,
  },

  // === PRODUCTIVITY ===
  {
    name: "notion",
    label: "Notion",
    description: "Access Notion pages, databases, and workspace content",
    category: "productivity",
    official: true,
    requiresAuth: true,
    config: {
      url: "https://mcp.notion.com/mcp",
    },
    icon: NotionIcon,
  },
  {
    name: "linear",
    label: "Linear",
    description: "Project management - issues, projects, and team workflows",
    category: "productivity",
    official: true,
    requiresAuth: true,
    config: {
      url: "https://mcp.linear.app/sse",
    },
    icon: LinearIcon,
  },
  {
    name: "asana",
    label: "Asana",
    description: "Task and project management for teams",
    category: "productivity",
    official: true,
    requiresAuth: true,
    config: {
      url: "https://mcp.asana.com/sse",
    },
    icon: AsanaIcon,
  },
  {
    name: "atlassian",
    label: "Atlassian",
    description: "Jira, Confluence, and Atlassian suite integration",
    category: "productivity",
    official: true,
    requiresAuth: true,
    config: {
      url: "https://mcp.atlassian.com/v1/sse",
    },
    icon: AtlassianIcon,
  },
  {
    name: "slack",
    label: "Slack",
    description: "Slack messaging, channels, and workspace management",
    category: "productivity",
    official: true,
    requiresAuth: true,
    config: {
      url: "https://mcp.slack.com/sse",
    },
    icon: FileText, // TODO: Add SlackIcon
  },

  // === FILESYSTEM/MEMORY/SYSTEM ===
  {
    name: "filesystem",
    label: "Filesystem",
    description: "Read, write, and manage local files and directories",
    category: "system",
    official: true,
    requiresAuth: false,
    config: {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem", "."],
    },
    icon: Folder,
  },
  {
    name: "memory",
    label: "Memory",
    description: "Persistent memory storage for knowledge and context",
    category: "system",
    official: true,
    requiresAuth: false,
    config: {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-memory"],
    },
    icon: Brain,
  },
  {
    name: "sequential-thinking",
    label: "Sequential Thinking",
    description: "Step-by-step reasoning and problem decomposition",
    category: "system",
    official: true,
    requiresAuth: false,
    config: {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-sequential-thinking"],
    },
    icon: Lightbulb,
  },
  {
    name: "time",
    label: "Time",
    description: "Time and timezone utilities for scheduling and dates",
    category: "system",
    official: true,
    requiresAuth: false,
    config: {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-time"],
    },
    icon: Clock,
  },

  // === SEARCH ===
  {
    name: "brave-search",
    label: "Brave Search",
    description: "Web search using Brave's privacy-focused search engine",
    category: "search",
    official: true,
    requiresAuth: true,
    config: {
      command: "npx",
      args: ["-y", "@anthropic-ai/mcp-server-brave-search"],
      env: {
        BRAVE_API_KEY: "${input:brave_api_key}",
      },
    },
    icon: BraveIcon,
  },
  {
    name: "exa",
    label: "Exa Search",
    description: "AI-powered semantic search for research and discovery",
    category: "search",
    official: true,
    requiresAuth: true,
    config: {
      url: "https://mcp.exa.ai/sse",
    },
    icon: ExaIcon,
  },

  // === DESIGN ===
  {
    name: "figma",
    label: "Figma",
    description: "Access Figma designs, components, and design systems",
    category: "design",
    official: true,
    requiresAuth: true,
    config: {
      url: "https://mcp.figma.com/sse",
    },
    icon: FigmaIcon,
  },
  {
    name: "canva",
    label: "Canva",
    description: "Design creation and editing with Canva",
    category: "design",
    official: true,
    requiresAuth: true,
    config: {
      url: "https://mcp.canva.com/mcp",
    },
    icon: CanvaIcon,
  },

  // === PAYMENTS ===
  {
    name: "stripe",
    label: "Stripe",
    description: "Payment processing, subscriptions, and billing",
    category: "payments",
    official: true,
    requiresAuth: true,
    config: {
      url: "https://mcp.stripe.com",
    },
    icon: StripeIcon,
  },
  {
    name: "paypal",
    label: "PayPal",
    description: "PayPal payments and transaction management",
    category: "payments",
    official: true,
    requiresAuth: true,
    config: {
      url: "https://mcp.paypal.com/mcp",
    },
    icon: PaypalIcon,
  },

  // === CLOUD ===
  {
    name: "cloudflare",
    label: "Cloudflare",
    description: "Cloudflare Workers, KV, R2, and edge services",
    category: "cloud",
    official: true,
    requiresAuth: true,
    config: {
      url: "https://mcp.cloudflare.com/sse",
    },
    icon: Globe, // TODO: Add CloudflareIcon
  },
  {
    name: "vercel",
    label: "Vercel",
    description: "Vercel deployments, projects, and serverless functions",
    category: "cloud",
    official: true,
    requiresAuth: true,
    config: {
      url: "https://mcp.vercel.com/sse",
    },
    icon: Globe, // TODO: Add VercelIcon
  },
];

// Helper to get MCPs by category
export function getMCPsByCategory(category: MCPCategory): RecommendedMCP[] {
  if (category === "all") {
    return RECOMMENDED_MCPS;
  }
  return RECOMMENDED_MCPS.filter((mcp) => mcp.category === category);
}

// Helper to get free (no auth required) MCPs
export function getFreeMCPs(): RecommendedMCP[] {
  return RECOMMENDED_MCPS.filter((mcp) => !mcp.requiresAuth);
}

// Helper to get MCPs that require authentication
export function getAuthRequiredMCPs(): RecommendedMCP[] {
  return RECOMMENDED_MCPS.filter((mcp) => mcp.requiresAuth);
}

export function MCPOverview() {
  const handleMcpClick = (e: React.MouseEvent, mcp: RecommendedMCP) => {
    e.preventDefault();
    e.stopPropagation();

    const params = new URLSearchParams();
    params.set("name", mcp.name);
    params.set("config", JSON.stringify(mcp.config));

    navigateTo(`/mcp/create?${params.toString()}`);
  };

  return (
    <div className="flex flex-col gap-4">
      <Link
        to="/mcp/create"
        search={{ name: undefined, config: undefined }}
        className="rounded-lg overflow-hidden cursor-pointer p-12 text-center relative group transition-all duration-300 "
      >
        <div className="flex flex-col items-center justify-center space-y-4 my-20">
          <h3 className="text-2xl md:text-4xl font-semibold flex items-center gap-3">
            <MCPIcon className="fill-foreground size-6 hidden sm:block" />
            Model Context Protocol
          </h3>

          <p className="text-muted-foreground max-w-md">
            Extend your AI assistant with powerful tools and integrations
          </p>

          <div className="flex items-center gap-2 text-xl font-bold">
            Add MCP Server
            <ArrowUpRight className="size-6" />
          </div>
        </div>
        <div className="flex gap-2 flex-wrap justify-center">
          {RECOMMENDED_MCPS.slice(0, 12).map((mcp) => (
            <Button
              key={mcp.name}
              variant={"secondary"}
              className="hover:translate-y-[-2px] transition-all duration-300"
              onClick={(e) => handleMcpClick(e, mcp)}
            >
              <mcp.icon className="size-4" />
              {mcp.label}
            </Button>
          ))}
        </div>
      </Link>
    </div>
  );
}
