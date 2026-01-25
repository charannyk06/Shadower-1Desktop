import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  MCPRemoteConfigZodSchema,
  type MCPServerConfig,
  type MCPServerInfo,
  MCPStdioConfigZodSchema,
  type MCPToolInfo,
} from "app-types/mcp";

import type { ConsolaInstance } from "consola";
import { colorize } from "consola/utils";
import {
  Locker,
  createDebounce,
  errorToString,
  generateUUID,
  isNull,
  withTimeout,
} from "lib/utils";
import logger from "logger";
import { isMaybeRemoteConfig, isMaybeStdioConfig } from "./is-mcp-config";

import {
  UnauthorizedError,
  discoverAuthorizationServerMetadata,
  discoverOAuthProtectedResourceMetadata,
  startAuthorization,
} from "@modelcontextprotocol/sdk/client/auth.js";
import { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { BASE_URL } from "lib/const";
import { safe } from "ts-safe";
import { PgOAuthClientProvider } from "./pg-oauth-provider";

type ClientOptions = {
  autoDisconnectSeconds?: number;
};

const CONNET_TIMEOUT = 120000; // 2 minutes for Electron
const MCP_MAX_TOTAL_TIMEOUT = process.env.MCP_MAX_TOTAL_TIMEOUT
  ? Number.parseInt(process.env.MCP_MAX_TOTAL_TIMEOUT, 10)
  : undefined;

/**
 * Client class for Model Context Protocol (MCP) server connections
 */
export class MCPClient {
  private client?: Client;
  private error?: unknown;
  private authorizationUrl?: URL;
  protected isConnected = false;
  private logger: ConsolaInstance;
  private locker = new Locker();
  private transport?: Transport;
  private oauthProvider?: PgOAuthClientProvider;
  // Information about available tools from the server
  toolInfo: MCPToolInfo[] = [];
  private disconnectDebounce = createDebounce();
  private needOauthProvider = false;
  private inProgressToolCallIds: string[] = [];
  // Flag to indicate OAuth is required but auth URL not yet available
  private needsOAuthAuthorization = false;
  constructor(
    private id: string,
    private name: string,
    private serverConfig: MCPServerConfig,

    private options: ClientOptions = {},
  ) {
    this.logger = logger.withDefaults({
      message: colorize(
        "cyan",
        `[${this.id.slice(0, 4)}] MCP Client ${this.name}: `,
      ),
    });
  }

  get status() {
    if (this.locker.isLocked) return "loading";
    if (this.authorizationUrl || this.needsOAuthAuthorization)
      return "authorizing";
    if (this.isConnected) return "connected";
    return "disconnected";
  }

  get hasActiveToolCalls() {
    return this.inProgressToolCallIds.length > 0;
  }

  getAuthorizationUrl(): URL | undefined {
    return this.authorizationUrl;
  }

  async finishAuth(code: string, state: string) {
    if (!isMaybeRemoteConfig(this.serverConfig))
      throw new Error("OAuth flow requires a remote MCP server");

    if (this.status != "authorizing" || this.oauthProvider?.state() != state) {
      if (this.oauthProvider && this.oauthProvider.state() != state) {
        await this.oauthProvider.adoptState(state);
      } else {
        await this.disconnect();
        await this.connect(state);
      }
    }
    const finish = (this.transport as StreamableHTTPClientTransport)
      ?.finishAuth;

    if (!finish) throw new Error("Not Found finishAuth");

    this.logger.info("OAuth authorization: exchanging code for token");

    await finish.call(this.transport, code);
    this.authorizationUrl = undefined;
    this.logger.info("OAuth authorization: token exchange completed");
  }

  getInfo(): MCPServerInfo {
    return {
      id: this.id,
      name: this.name,
      config: this.serverConfig,
      status: this.status,
      error: this.error,
      toolInfo: this.toolInfo,
      enabled: true,
      userId: "", // This will be filled by the manager
    };
  }

  private createOAuthProvider(oauthState?: string) {
    if (isMaybeRemoteConfig(this.serverConfig) && this.needOauthProvider) {
      this.logger.info("Creating OAuth provider for MCP server authentication");
      if (this.oauthProvider) {
        if (oauthState && oauthState != this.oauthProvider.state()) {
          this.oauthProvider.adoptState(oauthState);
        }
        return this.oauthProvider;
      }
      this.oauthProvider = new PgOAuthClientProvider({
        name: this.name,
        mcpServerId: this.id,
        serverUrl: this.serverConfig.url,
        state: oauthState,
        _clientMetadata: {
          client_name: `Shadower-${this.name}`,
          grant_types: ["authorization_code", "refresh_token"],
          response_types: ["code"],
          token_endpoint_auth_method: "none", // PKCE flow
          scope: "mcp:tools",
          redirect_uris: [`${BASE_URL}/api/mcp/oauth/callback`],
          software_id: "Shadower",
          software_version: "1.0.0",
        },
        onRedirectToAuthorization: async (authorizationUrl: URL) => {
          this.logger.info(
            "OAuth authorization required - user interaction needed",
          );
          this.authorizationUrl = authorizationUrl;
          throw new OAuthAuthorizationRequiredError(authorizationUrl);
        },
      });
      return this.oauthProvider;
    }
    return undefined;
  }

  private scheduleAutoDisconnect() {
    if (!isNull(this.options.autoDisconnectSeconds)) {
      this.disconnectDebounce(() => {
        // Don't disconnect if there are tool calls in progress
        if (this.inProgressToolCallIds.length === 0) {
          this.disconnect();
        } else {
          this.logger.info(
            `Skipping auto-disconnect: ${this.inProgressToolCallIds.length} tool calls in progress`,
          );
          // Reschedule the disconnect check
          this.scheduleAutoDisconnect();
        }
      }, this.options.autoDisconnectSeconds * 1000);
    }
  }

  async connect(oauthState?: string): Promise<Client | undefined> {
    if (this.status === "loading") {
      await this.locker.wait();
      return this.client;
    }
    if (this.status === "connected") {
      return this.client;
    }
    try {
      const startedAt = Date.now();
      this.locker.lock();
      this.error = undefined;
      this.authorizationUrl = undefined;
      this.isConnected = false;
      this.client = undefined;

      const client = new Client({
        name: `Shadower-${this.name}`,
        version: "1.0.0",
      });

      // Create appropriate transport based on server config type
      if (isMaybeStdioConfig(this.serverConfig)) {
        const config = MCPStdioConfigZodSchema.parse(this.serverConfig);
        this.transport = new StdioClientTransport({
          command: config.command,
          args: config.args,
          // Merge process.env with config.env, ensuring PATH is preserved and filtering out undefined values
          env: Object.entries({ ...process.env, ...config.env }).reduce(
            (acc, [key, value]) => {
              if (value !== undefined) {
                acc[key] = value;
              }
              return acc;
            },
            {} as Record<string, string>,
          ),
          cwd: process.cwd(),
        });

        await withTimeout(
          client.connect(this.transport, {
            maxTotalTimeout: MCP_MAX_TOTAL_TIMEOUT,
          }),
          CONNET_TIMEOUT,
        );
      } else if (isMaybeRemoteConfig(this.serverConfig)) {
        const config = MCPRemoteConfigZodSchema.parse(this.serverConfig);
        const abortController = new AbortController();
        const url = new URL(config.url);
        try {
          this.transport = new StreamableHTTPClientTransport(url, {
            requestInit: {
              headers: config.headers,
              signal: abortController.signal,
            },
            authProvider: this.createOAuthProvider(oauthState),
          });
          await withTimeout(
            client.connect(this.transport, {
              maxTotalTimeout: MCP_MAX_TOTAL_TIMEOUT,
            }),
            CONNET_TIMEOUT,
          );
        } catch (streamableHttpError: any) {
          // Check if it's OAuth error and we haven't tried OAuth yet
          if (isUnauthorized(streamableHttpError) && !this.needOauthProvider) {
            this.logger.info(
              "OAuth authentication required, retrying with OAuth provider",
            );
            this.needOauthProvider = true;
            this.locker.unlock();
            await this.disconnect();
            return this.connect(oauthState); // Recursive call with OAuth
          }

          // Check if this is an auth-related error that requires OAuth
          const isAuthError =
            streamableHttpError?.message?.includes(
              "Incompatible auth server",
            ) ||
            streamableHttpError?.message?.includes(
              "does not support dynamic client registration",
            );

          if (isAuthError) {
            // This error indicates OAuth is required but dynamic registration isn't supported
            // We need to manually trigger the OAuth flow to get the authorization URL
            this.needOauthProvider = true;
            this.logger.info(
              "Auth server doesn't support dynamic registration - manually initiating OAuth",
            );

            // Create OAuth provider
            const oauthProvider = this.createOAuthProvider(oauthState);
            if (oauthProvider && isMaybeRemoteConfig(this.serverConfig)) {
              try {
                // Step 1: Get the MCP server URL
                const serverUrl = new URL(this.serverConfig.url);
                this.logger.info(
                  `Discovering OAuth for MCP server: ${serverUrl}`,
                );

                // Step 2: Try to discover protected resource metadata to find the authorization server
                let authServerUrl: URL;
                let resourceMetadata;
                try {
                  resourceMetadata =
                    await discoverOAuthProtectedResourceMetadata(serverUrl);
                  this.logger.info(
                    "Protected resource metadata discovered:",
                    JSON.stringify(resourceMetadata),
                  );

                  // Get authorization server from resource metadata
                  if (
                    resourceMetadata.authorization_servers &&
                    resourceMetadata.authorization_servers.length > 0
                  ) {
                    authServerUrl = new URL(
                      resourceMetadata.authorization_servers[0],
                    );
                    this.logger.info(
                      `Using authorization server from metadata: ${authServerUrl}`,
                    );
                  } else {
                    // Fallback to server root
                    authServerUrl = new URL("/", serverUrl);
                    this.logger.info(
                      `No authorization_servers in metadata, using server root: ${authServerUrl}`,
                    );
                  }
                } catch (resourceError: any) {
                  this.logger.warn(
                    "Could not discover protected resource metadata:",
                    resourceError?.message,
                  );
                  // Fallback to server root as auth server
                  authServerUrl = new URL("/", serverUrl);
                }

                // Step 3: Try to discover authorization server metadata
                let metadata;
                try {
                  metadata =
                    await discoverAuthorizationServerMetadata(authServerUrl);
                  this.logger.info(
                    "OAuth authorization server metadata discovered",
                  );
                } catch (metadataError: any) {
                  this.logger.warn(
                    "Could not discover OAuth metadata, using defaults:",
                    metadataError?.message,
                  );
                  // Continue without metadata - startAuthorization will use defaults
                }

                // Step 4: Get or create client information
                const redirectUri = `${BASE_URL}/api/mcp/oauth/callback`;
                const clientInfo =
                  (await oauthProvider.clientInformation()) || {
                    client_id: redirectUri, // Use redirect URI as client ID for public clients
                  };

                // Save client info if we created it
                if (!(await oauthProvider.clientInformation())) {
                  await oauthProvider.saveClientInformation(clientInfo as any);
                }

                // Step 5: Generate the authorization URL with PKCE
                const state = oauthProvider.state();
                const { authorizationUrl, codeVerifier } =
                  await startAuthorization(authServerUrl, {
                    metadata,
                    clientInformation: clientInfo,
                    redirectUrl: new URL(redirectUri),
                    scope:
                      resourceMetadata?.scopes_supported?.join(" ") ||
                      "mcp:tools",
                    state,
                    resource: serverUrl, // Pass the MCP server as the resource
                  });

                // Save the code verifier for the token exchange later
                await oauthProvider.saveCodeVerifier(codeVerifier);

                this.logger.info(
                  `OAuth authorization URL generated: ${authorizationUrl.toString()}`,
                );

                // Set the authorization URL
                this.authorizationUrl = authorizationUrl;
                return undefined; // Status will be "authorizing"
              } catch (oauthError: any) {
                // If OAuthAuthorizationRequiredError is thrown, authorizationUrl was set
                if (oauthError instanceof OAuthAuthorizationRequiredError) {
                  this.logger.info(
                    "OAuth authorization URL obtained via callback",
                  );
                  return undefined; // Status will be "authorizing"
                }
                this.logger.error(
                  "Failed to generate OAuth authorization URL:",
                  oauthError,
                );
                // Fall through to set needsOAuthAuthorization flag
              }
            }

            // If we couldn't generate the URL, mark that OAuth is required
            this.needsOAuthAuthorization = true;
            this.logger.info(
              "OAuth authorization required - status set to authorizing",
            );
            return undefined;
          }

          if (!isOAuthAuthorizationRequired(streamableHttpError)) {
            this.logger.warn(
              `Streamable HTTP connection failed, Because ${streamableHttpError.message}, falling back to SSE transport`,
            );

            this.transport = new SSEClientTransport(url, {
              requestInit: {
                headers: config.headers,
                signal: abortController.signal,
              },
              authProvider: this.createOAuthProvider(oauthState),
            });

            try {
              await withTimeout(
                client.connect(this.transport, {
                  maxTotalTimeout: MCP_MAX_TOTAL_TIMEOUT,
                }),
                CONNET_TIMEOUT,
              );
            } catch (sseError: any) {
              if (isUnauthorized(sseError) && !this.needOauthProvider) {
                this.logger.info(
                  "OAuth authentication required for SSE, retrying with OAuth provider",
                );
                this.needOauthProvider = true;
                this.locker.unlock();
                await this.disconnect();
                return this.connect(oauthState); // Recursive call with OAuth
              }

              // Check for auth server incompatibility error in SSE transport too
              const isSSEAuthError =
                sseError?.message?.includes("Incompatible auth server") ||
                sseError?.message?.includes(
                  "does not support dynamic client registration",
                );

              if (isSSEAuthError) {
                this.needOauthProvider = true;
                this.logger.info(
                  "OAuth authorization required (SSE - dynamic registration not supported)",
                );

                // Try to manually generate OAuth authorization URL
                const oauthProvider = this.createOAuthProvider(oauthState);
                if (oauthProvider && isMaybeRemoteConfig(this.serverConfig)) {
                  try {
                    const serverUrl = new URL(this.serverConfig.url);

                    // Discover protected resource metadata to find auth server
                    let authServerUrl: URL;
                    let resourceMetadata;
                    try {
                      resourceMetadata =
                        await discoverOAuthProtectedResourceMetadata(serverUrl);
                      if (resourceMetadata.authorization_servers?.length > 0) {
                        authServerUrl = new URL(
                          resourceMetadata.authorization_servers[0],
                        );
                      } else {
                        authServerUrl = new URL("/", serverUrl);
                      }
                    } catch {
                      authServerUrl = new URL("/", serverUrl);
                    }

                    let metadata;
                    try {
                      metadata =
                        await discoverAuthorizationServerMetadata(
                          authServerUrl,
                        );
                    } catch {
                      // Continue without metadata
                    }

                    const redirectUri = `${BASE_URL}/api/mcp/oauth/callback`;
                    const clientInfo =
                      (await oauthProvider.clientInformation()) || {
                        client_id: redirectUri,
                      };

                    if (!(await oauthProvider.clientInformation())) {
                      await oauthProvider.saveClientInformation(
                        clientInfo as any,
                      );
                    }

                    const state = oauthProvider.state();
                    const { authorizationUrl, codeVerifier } =
                      await startAuthorization(authServerUrl, {
                        metadata,
                        clientInformation: clientInfo,
                        redirectUrl: new URL(redirectUri),
                        scope:
                          resourceMetadata?.scopes_supported?.join(" ") ||
                          "mcp:tools",
                        state,
                        resource: serverUrl,
                      });

                    await oauthProvider.saveCodeVerifier(codeVerifier);
                    this.authorizationUrl = authorizationUrl;
                    this.logger.info(
                      "OAuth authorization URL generated (SSE fallback)",
                    );
                    return undefined;
                  } catch (oauthError: any) {
                    if (oauthError instanceof OAuthAuthorizationRequiredError) {
                      return undefined;
                    }
                    this.logger.error(
                      "Failed to generate OAuth URL (SSE):",
                      oauthError,
                    );
                  }
                }

                // Fallback: mark OAuth required without URL
                this.needsOAuthAuthorization = true;
                return undefined;
              }

              if (!isOAuthAuthorizationRequired(sseError)) throw sseError;
            }
          }
        }
      } else {
        throw new Error("Invalid server config");
      }

      this.logger.info(
        `Connected to MCP server in ${((Date.now() - startedAt) / 1000).toFixed(2)}s`,
      );
      this.client = client;
      this.isConnected = true;

      this.scheduleAutoDisconnect();
    } catch (error) {
      this.logger.error(error);
      this.isConnected = false;
      this.error = errorToString(error);
      this.transport = undefined;
      throw error;
    } finally {
      this.locker.unlock();
    }

    await this.updateToolInfo();

    return this.client;
  }

  /**
   * Ensure the underlying OAuth provider adopts the callback state
   * so that PKCE code_verifier matches in multi-instance environments.
   */
  async ensureOAuthState(state: string): Promise<void> {
    if (!state) return;
    await this.oauthProvider?.adoptState(state);
  }

  async disconnect() {
    this.logger.info("Disconnecting from MCP server");
    await this.locker.wait();
    this.isConnected = false;
    const client = this.client;
    this.client = undefined;
    this.transport = undefined;
    void client?.close?.().catch((e) => this.logger.error(e));
  }
  async updateToolInfo() {
    if (this.status === "connected" && this.client) {
      this.logger.info("Updating tool info");
      const toolResponse = await this.client.listTools();
      this.toolInfo = toolResponse.tools.map(
        (tool) =>
          ({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema,
          }) as MCPToolInfo,
      );
    }
  }

  async callTool(toolName: string, input?: unknown) {
    const id = generateUUID();
    this.inProgressToolCallIds.push(id);
    const execute = async () => {
      const client = await this.connect();
      if (this.status === "authorizing") {
        throw new Error("OAuth authorization required. Try Refresh MCP Client");
      }
      return client?.callTool({
        name: toolName,
        arguments: input as Record<string, unknown>,
      });
    };
    return safe(() => this.logger.info("tool call", toolName))
      .ifOk(() => this.scheduleAutoDisconnect()) // disconnect if autoDisconnectSeconds is set
      .map(() => execute())
      .ifFail(async (err) => {
        if (err?.message?.includes("Transport is closed")) {
          this.logger.info("Transport is closed, reconnecting...");
          await this.disconnect();
          return execute();
        }
        throw err;
      })
      .ifOk((v) => {
        if (isNull(v)) {
          throw new Error("Tool call failed with null");
        }
        return v;
      })
      .ifOk(() => this.scheduleAutoDisconnect())
      .watch(() => {
        this.inProgressToolCallIds = this.inProgressToolCallIds.filter(
          (toolId) => toolId !== id,
        );
      })
      .watch((status) => {
        if (!status.isOk) {
          this.logger.error("Tool call failed", toolName, status.error);
        } else if (status.value?.isError) {
          this.logger.error(
            "Tool call failed content",
            toolName,
            status.value.content,
          );
        }
      })
      .ifFail((err) => {
        return {
          isError: true,
          error: {
            message: errorToString(err),
            name: err?.name || "ERROR",
          },
          content: [],
        };
      })
      .unwrap();
  }
}

/**
 * Factory function to create a new MCP client
 */
export const createMCPClient = (
  id: string,
  name: string,
  serverConfig: MCPServerConfig,
  options: ClientOptions = {},
): MCPClient => new MCPClient(id, name, serverConfig, options);

class OAuthAuthorizationRequiredError extends Error {
  constructor(public authorizationUrl: URL) {
    super("OAuth user authorization required");
    this.name = "OAuthAuthorizationRequiredError";
  }
}

function isUnauthorized(error: any): boolean {
  return (
    error instanceof UnauthorizedError ||
    error?.status === 401 ||
    error?.message?.includes("401") ||
    error?.message?.includes("Unauthorized") ||
    error?.message?.includes("invalid_token") ||
    error?.message?.includes("HTTP 401")
  );
}

function isOAuthAuthorizationRequired(error: any): boolean {
  return (
    error instanceof OAuthAuthorizationRequiredError ||
    error?.message?.includes("Incompatible auth server") ||
    error?.message?.includes("does not support dynamic client registration")
  );
}
