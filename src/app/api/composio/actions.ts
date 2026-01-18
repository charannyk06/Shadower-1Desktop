"use server";

import {
  ComposioApp,
  ComposioConnection,
  ComposioToolInfo,
} from "app-types/composio";
import { colorize } from "consola/utils";
import { getComposioClientForUser, isComposioEnabled } from "lib/ai/composio";
import { getCurrentUser } from "lib/auth/permissions";
import { composioRepository } from "lib/db/repository";
import globalLogger from "lib/logger";

const composioLogger = globalLogger.withDefaults({
  message: colorize("cyan", `Composio Action: `),
});

// Shared helper for action auth/client initialization
type ActionContext =
  | {
      success: true;
      client: ReturnType<typeof getComposioClientForUser>;
      userId: string;
    }
  | { success: false; error?: string };

async function getActionContext(options?: {
  throwOnError?: boolean;
}): Promise<ActionContext> {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    if (options?.throwOnError) throw new Error("Unauthorized");
    return { success: false, error: "Unauthorized" };
  }

  if (!isComposioEnabled()) {
    if (options?.throwOnError)
      throw new Error("App integrations are not enabled");
    return { success: false, error: "App integrations are not enabled" };
  }

  const client = getComposioClientForUser(currentUser.id);
  if (!client) {
    if (options?.throwOnError)
      throw new Error("Could not create Composio client");
    return { success: false, error: "Could not create Composio client" };
  }

  return { success: true, client, userId: currentUser.id };
}

export async function getComposioStatusAction() {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    return { enabled: false, connected: false };
  }

  const enabled = isComposioEnabled();
  if (!enabled) {
    return { enabled: false, connected: false };
  }

  const entity = await composioRepository.getEntityByUserId(currentUser.id);
  return {
    enabled: true,
    connected: !!entity,
    connectedApps: entity?.connectedApps || [],
  };
}

export async function getComposioAppsAction(): Promise<ComposioApp[]> {
  const ctx = await getActionContext();
  if (!ctx.success) return [];
  return ctx.client!.getApps();
}

export async function getComposioConnectionsAction(): Promise<
  ComposioConnection[]
> {
  const ctx = await getActionContext();
  if (!ctx.success) return [];
  return ctx.client!.getConnections();
}

export async function getComposioToolsForAppAction(
  appName: string,
): Promise<ComposioToolInfo[]> {
  const ctx = await getActionContext();
  if (!ctx.success) return [];
  return ctx.client!.getToolsForApp(appName);
}

export async function initiateComposioConnectionAction(
  appName: string,
  redirectUrl?: string,
): Promise<{ redirectUrl: string; connectionId: string }> {
  const ctx = await getActionContext({ throwOnError: true });
  if (!ctx.success) throw new Error(ctx.error);

  const result = await ctx.client!.initiateConnection(appName, redirectUrl);
  await composioRepository.addConnectedApp(ctx.userId, appName);

  return result;
}

export async function disconnectComposioAppAction(
  connectionId: string,
  appName: string,
): Promise<void> {
  const ctx = await getActionContext({ throwOnError: true });
  if (!ctx.success) throw new Error(ctx.error);

  await ctx.client!.disconnectApp(connectionId);
  await composioRepository.removeConnectedApp(ctx.userId, appName);
}

export async function searchComposioToolsAction(
  useCase: string,
): Promise<ComposioToolInfo[]> {
  const ctx = await getActionContext();
  if (!ctx.success) return [];
  return ctx.client!.getToolsByUseCase(useCase);
}

// Production-ready intent-to-tool mapping with comprehensive coverage
const INTENT_TO_TOOL_MAP: Record<
  string,
  Record<
    string,
    { tool: string; dangerous?: boolean; requiresParams?: string[] }
  >
> = {
  gmail: {
    // Read operations - HIGH PRIORITY
    inbox: { tool: "GMAIL_FETCH_EMAILS" },
    "get inbox": { tool: "GMAIL_FETCH_EMAILS" },
    "check inbox": { tool: "GMAIL_FETCH_EMAILS" },
    "read inbox": { tool: "GMAIL_FETCH_EMAILS" },
    "open inbox": { tool: "GMAIL_FETCH_EMAILS" },
    "show inbox": { tool: "GMAIL_FETCH_EMAILS" },
    emails: { tool: "GMAIL_FETCH_EMAILS" },
    "get emails": { tool: "GMAIL_FETCH_EMAILS" },
    "read emails": { tool: "GMAIL_FETCH_EMAILS" },
    "fetch emails": { tool: "GMAIL_FETCH_EMAILS" },
    "latest emails": { tool: "GMAIL_FETCH_EMAILS" },
    "recent emails": { tool: "GMAIL_FETCH_EMAILS" },
    "new emails": { tool: "GMAIL_FETCH_EMAILS" },
    "unread emails": { tool: "GMAIL_FETCH_EMAILS" },
    "check emails": { tool: "GMAIL_FETCH_EMAILS" },
    "list emails": { tool: "GMAIL_FETCH_EMAILS" },
    "show emails": { tool: "GMAIL_FETCH_EMAILS" },
    "retrieve emails": { tool: "GMAIL_FETCH_EMAILS" },
    mail: { tool: "GMAIL_FETCH_EMAILS" },
    "get mail": { tool: "GMAIL_FETCH_EMAILS" },
    "check mail": { tool: "GMAIL_FETCH_EMAILS" },
    // Single message
    "get message": { tool: "GMAIL_GET_MESSAGE" },
    "read message": { tool: "GMAIL_GET_MESSAGE" },
    "open message": { tool: "GMAIL_GET_MESSAGE" },
    "get email": { tool: "GMAIL_GET_MESSAGE" },
    "read email": { tool: "GMAIL_GET_MESSAGE" },
    "open email": { tool: "GMAIL_GET_MESSAGE" },
    // Send operations
    "send email": { tool: "GMAIL_SEND_EMAIL", requiresParams: ["to"] },
    "send an email": { tool: "GMAIL_SEND_EMAIL", requiresParams: ["to"] },
    "compose email": { tool: "GMAIL_SEND_EMAIL", requiresParams: ["to"] },
    "write email": { tool: "GMAIL_SEND_EMAIL", requiresParams: ["to"] },
    "new email": { tool: "GMAIL_SEND_EMAIL", requiresParams: ["to"] },
    "draft email": { tool: "GMAIL_CREATE_EMAIL_DRAFT" },
    "create draft": { tool: "GMAIL_CREATE_EMAIL_DRAFT" },
    // Reply
    reply: { tool: "GMAIL_REPLY_TO_THREAD" },
    "reply to": { tool: "GMAIL_REPLY_TO_THREAD" },
    "reply email": { tool: "GMAIL_REPLY_TO_THREAD" },
    "respond to": { tool: "GMAIL_REPLY_TO_THREAD" },
    // Search
    "search emails": { tool: "GMAIL_FETCH_EMAILS" },
    "search mail": { tool: "GMAIL_FETCH_EMAILS" },
    "find emails": { tool: "GMAIL_FETCH_EMAILS" },
    "find email": { tool: "GMAIL_FETCH_EMAILS" },
    // Labels
    "get labels": { tool: "GMAIL_LIST_LABELS" },
    "list labels": { tool: "GMAIL_LIST_LABELS" },
    "show labels": { tool: "GMAIL_LIST_LABELS" },
    // Dangerous operations
    "delete email": { tool: "GMAIL_DELETE_MESSAGE", dangerous: true },
    "delete message": { tool: "GMAIL_DELETE_MESSAGE", dangerous: true },
    "trash email": { tool: "GMAIL_TRASH_MESSAGE", dangerous: true },
  },
  github: {
    // Issues - Read
    issues: { tool: "GITHUB_LIST_REPOSITORY_ISSUES" },
    "get issues": { tool: "GITHUB_LIST_REPOSITORY_ISSUES" },
    "list issues": { tool: "GITHUB_LIST_REPOSITORY_ISSUES" },
    "show issues": { tool: "GITHUB_LIST_REPOSITORY_ISSUES" },
    "check issues": { tool: "GITHUB_LIST_REPOSITORY_ISSUES" },
    "open issues": { tool: "GITHUB_LIST_REPOSITORY_ISSUES" },
    // Issues - Create
    "create issue": {
      tool: "GITHUB_CREATE_AN_ISSUE",
      requiresParams: ["title"],
    },
    "new issue": { tool: "GITHUB_CREATE_AN_ISSUE", requiresParams: ["title"] },
    "open issue": { tool: "GITHUB_CREATE_AN_ISSUE", requiresParams: ["title"] },
    "file issue": { tool: "GITHUB_CREATE_AN_ISSUE", requiresParams: ["title"] },
    "report issue": {
      tool: "GITHUB_CREATE_AN_ISSUE",
      requiresParams: ["title"],
    },
    "report bug": { tool: "GITHUB_CREATE_AN_ISSUE", requiresParams: ["title"] },
    // PRs - Read
    "pull requests": { tool: "GITHUB_LIST_PULL_REQUESTS" },
    "get pull requests": { tool: "GITHUB_LIST_PULL_REQUESTS" },
    "list pull requests": { tool: "GITHUB_LIST_PULL_REQUESTS" },
    prs: { tool: "GITHUB_LIST_PULL_REQUESTS" },
    "get prs": { tool: "GITHUB_LIST_PULL_REQUESTS" },
    "list prs": { tool: "GITHUB_LIST_PULL_REQUESTS" },
    "show prs": { tool: "GITHUB_LIST_PULL_REQUESTS" },
    // PRs - Create
    "create pr": {
      tool: "GITHUB_CREATE_A_PULL_REQUEST",
      requiresParams: ["title"],
    },
    "create pull request": {
      tool: "GITHUB_CREATE_A_PULL_REQUEST",
      requiresParams: ["title"],
    },
    "new pr": {
      tool: "GITHUB_CREATE_A_PULL_REQUEST",
      requiresParams: ["title"],
    },
    "open pr": {
      tool: "GITHUB_CREATE_A_PULL_REQUEST",
      requiresParams: ["title"],
    },
    // Repos
    repos: { tool: "GITHUB_LIST_REPOSITORIES_FOR_THE_AUTHENTICATED_USER" },
    repositories: {
      tool: "GITHUB_LIST_REPOSITORIES_FOR_THE_AUTHENTICATED_USER",
    },
    "list repos": {
      tool: "GITHUB_LIST_REPOSITORIES_FOR_THE_AUTHENTICATED_USER",
    },
    "get repos": {
      tool: "GITHUB_LIST_REPOSITORIES_FOR_THE_AUTHENTICATED_USER",
    },
    "my repos": { tool: "GITHUB_LIST_REPOSITORIES_FOR_THE_AUTHENTICATED_USER" },
    "my repositories": {
      tool: "GITHUB_LIST_REPOSITORIES_FOR_THE_AUTHENTICATED_USER",
    },
    "show repos": {
      tool: "GITHUB_LIST_REPOSITORIES_FOR_THE_AUTHENTICATED_USER",
    },
    "create repo": {
      tool: "GITHUB_CREATE_A_REPOSITORY_FOR_THE_AUTHENTICATED_USER",
      requiresParams: ["name"],
    },
    "new repo": {
      tool: "GITHUB_CREATE_A_REPOSITORY_FOR_THE_AUTHENTICATED_USER",
      requiresParams: ["name"],
    },
    // Commits
    commits: { tool: "GITHUB_LIST_COMMITS" },
    "list commits": { tool: "GITHUB_LIST_COMMITS" },
    "get commits": { tool: "GITHUB_LIST_COMMITS" },
    "show commits": { tool: "GITHUB_LIST_COMMITS" },
    "recent commits": { tool: "GITHUB_LIST_COMMITS" },
    // Stars
    starred: {
      tool: "GITHUB_LIST_REPOSITORIES_STARRED_BY_THE_AUTHENTICATED_USER",
    },
    "starred repos": {
      tool: "GITHUB_LIST_REPOSITORIES_STARRED_BY_THE_AUTHENTICATED_USER",
    },
    "my stars": {
      tool: "GITHUB_LIST_REPOSITORIES_STARRED_BY_THE_AUTHENTICATED_USER",
    },
    // Notifications
    notifications: {
      tool: "GITHUB_LIST_NOTIFICATIONS_FOR_THE_AUTHENTICATED_USER",
    },
    "get notifications": {
      tool: "GITHUB_LIST_NOTIFICATIONS_FOR_THE_AUTHENTICATED_USER",
    },
    // Dangerous
    "delete repo": { tool: "GITHUB_DELETE_A_REPOSITORY", dangerous: true },
    "delete repository": {
      tool: "GITHUB_DELETE_A_REPOSITORY",
      dangerous: true,
    },
  },
  slack: {
    // Messages
    "send message": {
      tool: "SLACK_SENDS_A_MESSAGE_TO_A_SLACK_CHANNEL",
      requiresParams: ["channel", "text"],
    },
    "post message": {
      tool: "SLACK_SENDS_A_MESSAGE_TO_A_SLACK_CHANNEL",
      requiresParams: ["channel", "text"],
    },
    message: {
      tool: "SLACK_SENDS_A_MESSAGE_TO_A_SLACK_CHANNEL",
      requiresParams: ["channel", "text"],
    },
    "send slack": {
      tool: "SLACK_SENDS_A_MESSAGE_TO_A_SLACK_CHANNEL",
      requiresParams: ["channel", "text"],
    },
    // Channels
    channels: { tool: "SLACK_LIST_CHANNELS" },
    "list channels": { tool: "SLACK_LIST_CHANNELS" },
    "get channels": { tool: "SLACK_LIST_CHANNELS" },
    "show channels": { tool: "SLACK_LIST_CHANNELS" },
    // Users
    users: { tool: "SLACK_LIST_USERS" },
    "list users": { tool: "SLACK_LIST_USERS" },
    "team members": { tool: "SLACK_LIST_USERS" },
  },
  notion: {
    // Pages
    pages: { tool: "NOTION_LIST_ALL_PAGES" },
    "list pages": { tool: "NOTION_LIST_ALL_PAGES" },
    "get pages": { tool: "NOTION_LIST_ALL_PAGES" },
    "show pages": { tool: "NOTION_LIST_ALL_PAGES" },
    "create page": { tool: "NOTION_CREATE_A_PAGE", requiresParams: ["title"] },
    "new page": { tool: "NOTION_CREATE_A_PAGE", requiresParams: ["title"] },
    // Databases
    databases: { tool: "NOTION_LIST_ALL_DATABASES" },
    "list databases": { tool: "NOTION_LIST_ALL_DATABASES" },
    "get databases": { tool: "NOTION_LIST_ALL_DATABASES" },
  },
  calendar: {
    // Events
    events: { tool: "GOOGLECALENDAR_LIST_EVENTS" },
    calendar: { tool: "GOOGLECALENDAR_LIST_EVENTS" },
    "get events": { tool: "GOOGLECALENDAR_LIST_EVENTS" },
    "list events": { tool: "GOOGLECALENDAR_LIST_EVENTS" },
    "show events": { tool: "GOOGLECALENDAR_LIST_EVENTS" },
    "my calendar": { tool: "GOOGLECALENDAR_LIST_EVENTS" },
    schedule: { tool: "GOOGLECALENDAR_LIST_EVENTS" },
    "my schedule": { tool: "GOOGLECALENDAR_LIST_EVENTS" },
    meetings: { tool: "GOOGLECALENDAR_LIST_EVENTS" },
    upcoming: { tool: "GOOGLECALENDAR_LIST_EVENTS" },
    "upcoming events": { tool: "GOOGLECALENDAR_LIST_EVENTS" },
    today: { tool: "GOOGLECALENDAR_LIST_EVENTS" },
    tomorrow: { tool: "GOOGLECALENDAR_LIST_EVENTS" },
    // Create
    "create event": {
      tool: "GOOGLECALENDAR_CREATE_EVENT",
      requiresParams: ["summary"],
    },
    "new event": {
      tool: "GOOGLECALENDAR_CREATE_EVENT",
      requiresParams: ["summary"],
    },
    "schedule meeting": {
      tool: "GOOGLECALENDAR_CREATE_EVENT",
      requiresParams: ["summary"],
    },
    "add event": {
      tool: "GOOGLECALENDAR_CREATE_EVENT",
      requiresParams: ["summary"],
    },
  },
  linear: {
    issues: { tool: "LINEAR_LIST_LINEAR_ISSUES" },
    "list issues": { tool: "LINEAR_LIST_LINEAR_ISSUES" },
    "get issues": { tool: "LINEAR_LIST_LINEAR_ISSUES" },
    "create issue": {
      tool: "LINEAR_CREATE_LINEAR_ISSUE",
      requiresParams: ["title"],
    },
    "new issue": {
      tool: "LINEAR_CREATE_LINEAR_ISSUE",
      requiresParams: ["title"],
    },
  },
  jira: {
    issues: { tool: "JIRA_GET_ISSUE" },
    "get issues": { tool: "JIRA_SEARCH_ISSUES" },
    "search issues": { tool: "JIRA_SEARCH_ISSUES" },
    "create issue": { tool: "JIRA_CREATE_ISSUE", requiresParams: ["summary"] },
    "new issue": { tool: "JIRA_CREATE_ISSUE", requiresParams: ["summary"] },
    "create ticket": { tool: "JIRA_CREATE_ISSUE", requiresParams: ["summary"] },
    "new ticket": { tool: "JIRA_CREATE_ISSUE", requiresParams: ["summary"] },
  },
};

// App keywords for intent detection
const APP_KEYWORDS: Record<string, string[]> = {
  gmail: ["gmail", "email", "mail", "inbox"],
  github: [
    "github",
    "repo",
    "repository",
    "issue",
    "pull request",
    "pr",
    "commit",
  ],
  slack: ["slack", "channel"],
  notion: ["notion", "page", "database"],
  calendar: ["calendar", "event", "meeting", "schedule"],
};

/** Detect target app from intent */
function detectTargetApp(
  intentLower: string,
  connectedAppNames: string[],
): string | null {
  for (const [app, keywords] of Object.entries(APP_KEYWORDS)) {
    if (
      keywords.some((kw) => intentLower.includes(kw)) &&
      connectedAppNames.includes(app)
    ) {
      return app;
    }
  }
  return null;
}

/** Find tool by direct mapping */
function findToolByMapping(
  appToUse: string,
  intentLower: string,
): { toolName: string | null; isDangerous: boolean } {
  const appMapping = INTENT_TO_TOOL_MAP[appToUse];
  if (!appMapping) return { toolName: null, isDangerous: false };

  let bestMatch = { pattern: "", score: 0 };
  for (const pattern of Object.keys(appMapping)) {
    const patternWords = pattern.split(" ");
    const matchCount = patternWords.filter((w) =>
      intentLower.includes(w),
    ).length;
    const score = matchCount / patternWords.length;
    if (score > bestMatch.score) {
      bestMatch = { pattern, score };
    }
  }

  if (bestMatch.score >= 0.5) {
    const matched = appMapping[bestMatch.pattern];
    return { toolName: matched.tool, isDangerous: matched.dangerous ?? false };
  }
  return { toolName: null, isDangerous: false };
}

/** Score a tool based on intent action type */
function scoreTool(
  toolName: string,
  isRead: boolean,
  isSend: boolean,
  isDelete: boolean,
): number {
  const name = toolName.toUpperCase();
  let score = 0;

  if (isRead && /GET|LIST|FETCH|READ/.test(name)) score += 100;
  if (isSend && /SEND|CREATE|POST|REPLY/.test(name)) score += 100;
  if (isDelete && name.includes("DELETE")) score += 100;
  if (!isDelete && name.includes("DELETE")) score -= 500;

  return score;
}

/** Find tool by smart matching */
function findToolBySmartMatch(
  tools: ComposioToolInfo[],
  intentLower: string,
): string | null {
  const isRead =
    /\b(get|fetch|retrieve|read|check|show|list|find|search|view|latest|recent|inbox)\b/i.test(
      intentLower,
    );
  const isSend = /\b(send|compose|write|post|create|new|add|reply)\b/i.test(
    intentLower,
  );
  const isDelete = /\b(delete|remove|trash)\b/i.test(intentLower);

  const scored = tools.map((tool) => ({
    tool,
    score: scoreTool(tool.name, isRead, isSend, isDelete),
  }));

  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.tool.name ?? null;
}

/**
 * Meta-tool for voice mode: discovers and executes Composio actions by intent
 * Uses direct mapping for accuracy, falls back to smart matching
 */
export async function executeComposioByIntentAction(
  intent: string,
  params?: Record<string, unknown>,
): Promise<{
  success: boolean;
  result?: unknown;
  error?: string;
  toolUsed?: string;
}> {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error("Unauthorized");
  }

  if (!isComposioEnabled()) {
    return { success: false, error: "App integrations are not enabled" };
  }

  const client = getComposioClientForUser(currentUser.id);
  if (!client) {
    return { success: false, error: "Could not create Composio client" };
  }

  try {
    const connections = await client.getConnections();
    if (!connections || connections.length === 0) {
      return {
        success: false,
        error:
          "No apps connected. Please connect an app first in the Composio dashboard.",
      };
    }

    const connectedAppNames = connections.map((c) => c.appName.toLowerCase());
    const intentLower = intent.toLowerCase();
    const targetApp = detectTargetApp(intentLower, connectedAppNames);
    const appToUse = targetApp || connectedAppNames[0];

    // Try direct mapping first
    const { toolName: mappedTool, isDangerous } = findToolByMapping(
      appToUse,
      intentLower,
    );
    let toolName = mappedTool;

    if (isDangerous && toolName) {
      composioLogger.warn(`Dangerous action requested: ${toolName}`);
    }

    // Fallback to smart matching
    if (!toolName) {
      const appTools = await client.getToolsForApp(appToUse);
      if (!appTools || appTools.length === 0) {
        return { success: false, error: `No tools found for ${appToUse}` };
      }
      toolName = findToolBySmartMatch(appTools, intentLower);
    }

    if (!toolName) {
      return {
        success: false,
        error: `Could not find appropriate tool for: "${intent}"`,
      };
    }

    composioLogger.info(`Executing: ${toolName} for intent: "${intent}"`);
    const result = await client.executeAction(toolName, params || {});
    composioLogger.info(`Success: ${toolName}`);

    return { success: true, result, toolUsed: toolName };
  } catch (error) {
    const errorMsg =
      error instanceof Error ? error.message : "Failed to execute action";
    composioLogger.error(`Failed: ${errorMsg}`);
    return { success: false, error: errorMsg };
  }
}
