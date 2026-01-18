import "server-only";

import { ToolCallOptions, jsonSchema } from "ai";
import {
  ComposioApp,
  ComposioConnection,
  ComposioToolInfo,
  VercelAIComposioTool,
  VercelAIComposioToolTag,
} from "app-types/composio";
import { colorize } from "consola/utils";
import { COMPOSIO_API_KEY } from "lib/const";
import { errorToString, toAny } from "lib/utils";
import globalLogger from "logger";

const logger = globalLogger.withDefaults({
  message: colorize("magenta", `Composio Client: `),
});

const COMPOSIO_BASE_URL = "https://backend.composio.dev/api/v1";

type ComposioClientOptions = {
  apiKey?: string;
  entityId?: string;
};

export class ComposioClient {
  private readonly apiKey: string;
  private entityId: string;
  private cachedApps: ComposioApp[] = [];
  private readonly cachedTools: Map<string, ComposioToolInfo[]> = new Map();

  constructor(options: ComposioClientOptions = {}) {
    this.apiKey = options.apiKey || COMPOSIO_API_KEY || "";
    this.entityId = options.entityId || "default";
  }

  private async fetch<T>(
    endpoint: string,
    options: RequestInit = {},
  ): Promise<T> {
    const url = `${COMPOSIO_BASE_URL}${endpoint}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        "X-API-KEY": this.apiKey,
        ...options.headers,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Composio API error: ${response.status} - ${errorText}`);
    }

    return response.json();
  }

  async getApps(): Promise<ComposioApp[]> {
    if (this.cachedApps.length > 0) {
      return this.cachedApps;
    }

    try {
      const result = await this.fetch<{ items: ComposioApp[] }>("/apps");
      this.cachedApps = result.items || [];
      return this.cachedApps;
    } catch (error) {
      logger.error("Failed to fetch Composio apps:", error);
      return [];
    }
  }

  async getAppsWithIntegrations(): Promise<ComposioApp[]> {
    try {
      const appsWithIntegrations = await this.getAppsWithIntegrationsSet();
      const allApps = await this.getApps();
      const connectableApps = allApps.filter((app) =>
        appsWithIntegrations.has(app.name),
      );
      logger.info(
        `Found ${connectableApps.length} apps with integrations out of ${allApps.length} total apps`,
      );
      return connectableApps;
    } catch (error) {
      logger.error("Failed to fetch apps with integrations:", error);
      return [];
    }
  }

  async getAppsWithIntegrationsSet(): Promise<Set<string>> {
    try {
      const integrationsResult = await this.fetch<{
        items: { appName: string }[];
      }>("/integrations");
      return new Set((integrationsResult.items || []).map((i) => i.appName));
    } catch (error) {
      logger.error("Failed to fetch integrations set:", error);
      return new Set();
    }
  }

  async getApp(appName: string): Promise<ComposioApp | null> {
    try {
      const result = await this.fetch<ComposioApp>(`/apps/${appName}`);
      return result;
    } catch (error) {
      logger.error(`Failed to fetch Composio app ${appName}:`, error);
      return null;
    }
  }

  async getToolsForApp(appName: string): Promise<ComposioToolInfo[]> {
    if (this.cachedTools.has(appName)) {
      return this.cachedTools.get(appName) || [];
    }

    try {
      const url = `https://backend.composio.dev/api/v2/actions?apps=${encodeURIComponent(appName)}&limit=100`;
      const response = await fetch(url, {
        headers: {
          "Content-Type": "application/json",
          "X-API-KEY": this.apiKey,
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch actions: ${response.status}`);
      }

      const result = await response.json();
      const tools: ComposioToolInfo[] = (result.items || []).map(
        (action: any) => ({
          name: action.name,
          displayName: action.displayName || action.display_name || action.name,
          description: action.description,
          appName: appName,
          appId: action.appId || "",
          parameters: action.parameters,
        }),
      );

      this.cachedTools.set(appName, tools);
      logger.info(`Loaded ${tools.length} tools for app ${appName}`);
      return tools;
    } catch (error) {
      logger.error(`Failed to fetch tools for app ${appName}:`, error);
      return [];
    }
  }

  async getToolsByUseCase(useCase: string): Promise<ComposioToolInfo[]> {
    try {
      const result = await this.fetch<{ items: ComposioToolInfo[] }>(
        `/actions/search?useCase=${encodeURIComponent(useCase)}&limit=10`,
      );
      return result.items || [];
    } catch (error) {
      logger.error("Failed to search tools by use case:", error);
      return [];
    }
  }

  async getToolsByUseCaseForApps(
    useCase: string,
    appNames: string[],
  ): Promise<ComposioToolInfo[]> {
    try {
      // Search with apps filter
      const appsParam = appNames.join(",");
      const result = await this.fetch<{ items: ComposioToolInfo[] }>(
        `/actions/search?useCase=${encodeURIComponent(useCase)}&apps=${encodeURIComponent(appsParam)}&limit=10`,
      );
      return result.items || [];
    } catch (error) {
      logger.error("Failed to search tools by use case for apps:", error);
      // Fallback: get tools for connected apps and filter locally
      try {
        const allTools: ComposioToolInfo[] = [];
        for (const appName of appNames.slice(0, 3)) {
          const tools = await this.getToolsForApp(appName);
          allTools.push(...tools);
        }
        // Simple keyword matching as fallback
        const keywords = useCase.toLowerCase().split(/\s+/);
        return allTools
          .filter((tool) => {
            const text = `${tool.name} ${tool.description || ""}`.toLowerCase();
            return keywords.some((kw) => text.includes(kw));
          })
          .slice(0, 10);
      } catch {
        return [];
      }
    }
  }

  async getConnections(): Promise<ComposioConnection[]> {
    try {
      // Filter by entityId to only return connections for this user
      const result = await this.fetch<{ items: any[] }>(
        `/connectedAccounts?user_uuid=${encodeURIComponent(this.entityId)}`,
      );

      const connections: ComposioConnection[] = (result.items || [])
        .filter((item) => item.status === "ACTIVE")
        .map((item) => ({
          id: item.id,
          appName: item.appName || item.appUniqueId,
          status: item.status?.toLowerCase() as
            | "active"
            | "pending"
            | "expired"
            | "error",
          createdAt: item.createdAt,
          expiresAt: item.connectionParams?.expires_in
            ? new Date(
                Date.now() + item.connectionParams.expires_in * 1000,
              ).toISOString()
            : undefined,
        }));

      return connections;
    } catch (error) {
      logger.error("Failed to fetch connections:", error);
      return [];
    }
  }

  async getIntegrationForApp(appName: string): Promise<string | null> {
    try {
      const result = await this.fetch<{ items: { id: string }[] }>(
        `/integrations?appName=${encodeURIComponent(appName)}`,
      );
      if (result.items && result.items.length > 0) {
        return result.items[0].id;
      }

      // No integration found, try to create one with Composio's default auth
      logger.info(`Creating integration for app ${appName}`);
      const createResult = await this.fetch<{ id: string }>("/integrations", {
        method: "POST",
        body: JSON.stringify({
          name: `${appName}_integration`,
          appName: appName,
          useComposioAuth: true,
        }),
      });

      if (createResult.id) {
        logger.info(
          `Created integration for app ${appName}: ${createResult.id}`,
        );
        return createResult.id;
      }

      return null;
    } catch (error) {
      logger.error(
        `Failed to get/create integration for app ${appName}:`,
        error,
      );
      return null;
    }
  }

  async initiateConnection(
    appName: string,
    redirectUrl?: string,
  ): Promise<{ redirectUrl: string; connectionId: string }> {
    const integrationId = await this.getIntegrationForApp(appName);

    if (!integrationId) {
      throw new Error(`No integration found for app: ${appName}`);
    }

    const result = await this.fetch<{
      redirectUrl: string;
      connectedAccountId: string;
    }>("/connectedAccounts", {
      method: "POST",
      body: JSON.stringify({
        integrationId: integrationId,
        entityId: this.entityId,
        redirectUri: redirectUrl,
        data: {},
      }),
    });

    return {
      redirectUrl: result.redirectUrl,
      connectionId: result.connectedAccountId,
    };
  }

  async disconnectApp(connectionId: string): Promise<void> {
    await this.fetch(`/connectedAccounts/${connectionId}`, {
      method: "DELETE",
    });
  }

  async executeAction(
    actionName: string,
    params: Record<string, unknown>,
  ): Promise<unknown> {
    logger.info(`Executing Composio action: ${actionName}`);

    try {
      // Extract app name from action name (e.g., GMAIL_FETCH_EMAILS -> gmail)
      const appName = actionName.split("_")[0].toLowerCase();

      // Get the connected account for this app
      const connections = await this.getConnections();
      const connection = connections.find(
        (c) => c.appName.toLowerCase() === appName && c.status === "active",
      );

      if (!connection) {
        throw new Error(
          `No active connection found for app: ${appName}. ` +
            `Please connect your ${appName.toUpperCase()} account in the Integrations settings.`,
        );
      }

      // Use v2 API with connectedAccountId
      const url = `https://backend.composio.dev/api/v2/actions/${actionName}/execute`;
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-KEY": this.apiKey,
        },
        body: JSON.stringify({
          connectedAccountId: connection.id,
          input: params,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        // Parse error for better messaging
        try {
          const errorJson = JSON.parse(errorText);
          if (errorJson.message?.includes("not found")) {
            throw new Error(
              `Action "${actionName}" not found. This may mean:\n` +
                `1. The ${appName.toUpperCase()} integration needs to be reconnected\n` +
                `2. The action requires additional permissions/scopes\n` +
                `3. The action name may have changed in Composio\n\n` +
                `Try disconnecting and reconnecting ${appName.toUpperCase()} in Integrations.`,
            );
          }
        } catch (parseError) {
          // If not JSON, use original error
          if (
            parseError instanceof Error &&
            parseError.message.includes("Action")
          ) {
            throw parseError;
          }
        }
        throw new Error(
          `Composio API error: ${response.status} - ${errorText}`,
        );
      }

      const result = await response.json();
      return result.data;
    } catch (error) {
      logger.error(`Failed to execute action ${actionName}:`, error);
      return {
        isError: true,
        error: {
          message: errorToString(error),
          name: "ComposioExecutionError",
        },
      };
    }
  }

  async getVercelAITools(
    appNames?: string[],
  ): Promise<Record<string, VercelAIComposioTool>> {
    const tools: Record<string, VercelAIComposioTool> = {};

    try {
      let allTools: ComposioToolInfo[] = [];

      if (appNames && appNames.length > 0) {
        const toolPromises = appNames.map((app) => this.getToolsForApp(app));
        const results = await Promise.all(toolPromises);
        allTools = results.flat();
      } else {
        const connections = await this.getConnections();
        const connectedApps = connections
          .filter((c) => c.status === "active")
          .map((c) => c.appName);

        if (connectedApps.length === 0) {
          return tools;
        }

        const toolPromises = connectedApps.map((app) =>
          this.getToolsForApp(app),
        );
        const results = await Promise.all(toolPromises);
        allTools = results.flat();
      }

      for (const tool of allTools) {
        // Truncate tool name to max 64 characters (API limit)
        let toolId = `app_${tool.appName}_${tool.name}`;
        if (toolId.length > 64) {
          toolId = toolId.substring(0, 64);
        }

        tools[toolId] = VercelAIComposioToolTag.create({
          description: tool.description || `${tool.displayName || tool.name}`,
          inputSchema: jsonSchema(
            toAny({
              type: "object",
              properties: tool.parameters?.properties ?? {},
              required: tool.parameters?.required ?? [],
              additionalProperties: false,
            }),
          ),
          _composioAppName: tool.appName,
          _composioAppId: tool.appId,
          _originToolName: tool.name,
          _isComposioTool: true,
          execute: async (params: unknown, options: ToolCallOptions) => {
            options?.abortSignal?.throwIfAborted();
            return this.executeAction(
              tool.name,
              params as Record<string, unknown>,
            );
          },
        });
      }

      logger.info(`Loaded ${Object.keys(tools).length} Composio tools`);
      return tools;
    } catch (error) {
      logger.error("Failed to get Vercel AI tools:", error);
      return tools;
    }
  }

  setEntityId(entityId: string) {
    this.entityId = entityId;
    this.cachedTools.clear();
  }

  clearCache() {
    this.cachedApps = [];
    this.cachedTools.clear();
  }

  async getIntegrations(): Promise<
    { id: string; appName: string; name: string }[]
  > {
    try {
      const result = await this.fetch<{
        items: { id: string; appName: string; name: string }[];
      }>("/integrations");
      return result.items || [];
    } catch (error) {
      logger.error("Failed to fetch integrations:", error);
      return [];
    }
  }

  async createCustomIntegration(
    appName: string,
    clientId: string,
    clientSecret: string,
    scopes?: string[],
  ): Promise<{ id: string }> {
    const result = await this.fetch<{ id: string }>("/integrations", {
      method: "POST",
      body: JSON.stringify({
        name: `${appName}_custom_${Date.now()}`,
        appName: appName,
        useComposioAuth: false,
        authConfig: {
          client_id: clientId,
          client_secret: clientSecret,
          ...(scopes && scopes.length > 0 && { scopes: scopes }),
        },
      }),
    });

    logger.info(`Created custom integration for ${appName}: ${result.id}`);
    return result;
  }
}

export function createComposioClient(
  options?: ComposioClientOptions,
): ComposioClient {
  return new ComposioClient(options);
}
