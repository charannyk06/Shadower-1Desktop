import { contextBridge, ipcRenderer } from "electron";

// Type definitions for auth operations
export interface RegisterData {
  email: string;
  password: string;
  name: string;
}

export interface SignInData {
  email: string;
  password: string;
}

export interface AuthResult {
  success: boolean;
  error?: string;
  session?: any;
}

// Type definitions for the Electron API
export interface ElectronAPI {
  // Platform information
  platform: NodeJS.Platform;

  // Authentication operations
  auth: {
    // Core auth methods
    isFirstLaunch: () => Promise<boolean>;
    register: (data: RegisterData) => Promise<AuthResult>;
    signIn: (data: SignInData) => Promise<AuthResult>;
    signOut: () => Promise<{ success: boolean; error?: string }>;
    validateSession: () => Promise<any>;

    // Backwards compatible methods
    getSession: () => Promise<any>;
    getCurrentUser: () => Promise<any>;
    isAuthenticated: () => Promise<boolean>;
    updateProfile: (data: {
      name?: string;
      image?: string | null;
    }) => Promise<any>;
    getPreferences: () => Promise<any>;
    updatePreferences: (preferences: any) => Promise<{ success: boolean }>;
  };

  // Database operations
  db: {
    chat: {
      getThreads: (userId: string) => Promise<any[]>;
      getThread: (id: string) => Promise<any>;
      getThreadWithMessages: (threadId: string, userId: string) => Promise<any>;
      getMessages: (threadId: string) => Promise<any[]>;
      createThread: (data: any) => Promise<any>;
      createMessage: (data: any) => Promise<any>;
      updateThread: (id: string, data: any) => Promise<void>;
      deleteThread: (id: string) => Promise<void>;
      deleteAllThreads: (userId: string) => Promise<{ success: boolean }>;
      deleteUnarchivedThreads: (
        userId: string,
      ) => Promise<{ success: boolean }>;
      // New handlers
      upsertMessage: (data: { message: any; threadId: string }) => Promise<any>;
      deleteMessage: (messageId: string) => Promise<{ success: boolean }>;
      deleteMessagesAfterTimestamp: (data: {
        threadId: string;
        messageId: string;
      }) => Promise<{ success: boolean }>;
      updateMessageParts: (data: {
        messageId: string;
        parts: any[];
      }) => Promise<any>;
    };
    archives: {
      getAll: (userId: string) => Promise<any[]>;
      getById: (id: string) => Promise<any>;
      create: (data: any) => Promise<any>;
      update: (id: string, data: any) => Promise<any>;
      delete: (id: string) => Promise<void>;
      archiveThread: (
        threadId: string,
        archiveId: string,
        userId: string,
      ) => Promise<{ success: boolean }>;
      unarchiveThread: (
        threadId: string,
        archiveId?: string,
      ) => Promise<{ success: boolean }>;
      getItems: (archiveId: string) => Promise<any[]>;
      getItemArchives: (itemId: string) => Promise<any[]>;
    };
    bookmark: {
      toggle: (
        userId: string,
        itemId: string,
        itemType: "agent" | "workflow" | "mcp",
        isCurrentlyBookmarked: boolean,
      ) => Promise<{ success: boolean; isBookmarked: boolean }>;
    };
    agents: {
      getAll: (userId: string) => Promise<any[]>;
      getById: (id: string) => Promise<any>;
      selectAgents: (
        userId: string,
        filters?: string[],
        limit?: number,
      ) => Promise<any[]>;
      create: (data: any) => Promise<any>;
      update: (id: string, data: any) => Promise<any>;
      delete: (id: string) => Promise<void>;
    };
    workflows: {
      getAll: (userId: string) => Promise<any[]>;
      getById: (id: string) => Promise<any>;
      create: (data: any) => Promise<any>;
      update: (id: string, data: any) => Promise<any>;
      delete: (id: string) => Promise<void>;
      saveNodes: (workflowId: string, nodes: any[]) => Promise<void>;
      saveEdges: (workflowId: string, edges: any[]) => Promise<void>;
      saveStructure: (
        workflowId: string,
        data: {
          nodes?: any[];
          edges?: any[];
          deleteNodes?: string[];
          deleteEdges?: string[];
        },
      ) => Promise<{ success: boolean }>;
    };
    mcp: {
      getServers: () => Promise<any[]>;
      getServerById: (id: string) => Promise<any>;
      saveServer: (data: any) => Promise<any>;
      deleteServer: (id: string) => Promise<void>;
      getToolCustomizations: (serverId: string) => Promise<any[]>;
      saveToolCustomization: (data: any) => Promise<any>;
      // New handlers
      existsByServerName: (name: string) => Promise<boolean>;
      refreshClient: (
        serverId: string,
      ) => Promise<{
        success: boolean;
        status?: string;
        toolInfo?: any[];
        error?: string;
      }>;
      callTool: (data: {
        serverId: string;
        toolName: string;
        args: any;
      }) => Promise<{ success: boolean; result?: any; error?: string }>;
      callToolByServerName: (data: {
        serverName: string;
        toolName: string;
        args: any;
      }) => Promise<{ success: boolean; result?: any; error?: string }>;
      getServerStatus: (serverId: string) => Promise<any>;
      updateVisibility: (data: {
        serverId: string;
        visibility: "public" | "private";
      }) => Promise<any>;
      getServersWithStatus: () => Promise<any[]>;
    };
    user: {
      getPreferences: () => Promise<any>;
      updatePreferences: (data: any) => Promise<void>;
      getCurrent: () => Promise<any>;
      updateProfile: (data: any) => Promise<any>;
      getById: (userId: string) => Promise<any>;
      getStats: (userId: string) => Promise<{
        threadCount: number;
        messageCount: number;
        modelStats: any[];
        totalTokens: number;
        period: string;
      }>;
      // New handlers
      updateImage: (imageUrl: string) => Promise<any>;
      updateDetails: (data: { name?: string }) => Promise<any>;
    };
  };

  // File operations
  files: {
    upload: (data: {
      content: string | Buffer;
      filename?: string;
      contentType?: string;
      category?: "uploads" | "fragments" | "exports" | "sandbox";
    }) => Promise<any>;
    download: (key: string) => Promise<string>;
    delete: (key: string) => Promise<{ success: boolean }>;
    exists: (key: string) => Promise<boolean>;
    getMetadata: (key: string) => Promise<any>;
    getSourceUrl: (key: string) => Promise<string | null>;
    getDownloadUrl: (key: string) => Promise<string | null>;
    listFiles: (
      category: "uploads" | "fragments" | "exports" | "sandbox",
    ) => Promise<any[]>;
    clearCategory: (
      category: "uploads" | "fragments" | "exports" | "sandbox",
    ) => Promise<{ success: boolean }>;
    getStats: () => Promise<any>;
  };

  // Vector search operations
  vector: {
    initialize: () => Promise<{ success: boolean }>;
    search: (queryEmbedding: number[], options: any) => Promise<any[]>;
    insert: (documents: any[]) => Promise<{ success: boolean }>;
    delete: (ids: string[]) => Promise<{ success: boolean }>;
    deleteByThread: (threadId: string) => Promise<{ success: boolean }>;
    getStats: () => Promise<{ documents: number; messages: number }>;
  };

  // Embedding generation
  embeddings: {
    generate: (texts: string[]) => Promise<number[][]>;
    generateBatch: (texts: string[], batchSize?: number) => Promise<number[][]>;
    cosineSimilarity: (
      embedding1: number[],
      embedding2: number[],
    ) => Promise<number>;
  };

  // RAG operations (to be implemented in Phase 4.5)
  rag: {
    query: (query: string, options: any) => Promise<any>;
  };

  // Graph memory operations (to be implemented in Phase 4.6)
  graph: {
    extractEntities: (document: any) => Promise<void>;
    search: (entityId: string, options: any) => Promise<any[]>;
    query: (naturalLanguageQuery: string) => Promise<any>;
  };

  // Sandbox operations (to be implemented in Phase 5)
  sandbox: {
    executeCode: (code: string, language: string) => Promise<any>;
    getFiles: (threadId: string) => Promise<string[]>;
  };

  // Chrome automation (to be implemented in Phase 5)
  chrome: {
    connect: (port: number) => Promise<boolean>;
    navigate: (url: string) => Promise<void>;
    screenshot: () => Promise<Buffer>;
    evaluate: (script: string) => Promise<any>;
  };

  // Terminal operations (for computer use agent)
  terminal: {
    execute: (options: {
      command: string;
      cwd?: string;
      timeout?: number;
      env?: Record<string, string>;
    }) => Promise<{
      success: boolean;
      stdout: string;
      stderr: string;
      exitCode: number;
      error?: string;
    }>;
    screenshot: (options?: {
      fullScreen?: boolean;
      displayId?: string;
    }) => Promise<{
      success: boolean;
      screenshot?: string;
      width?: number;
      height?: number;
      error?: string;
    }>;
    click: (
      x: number,
      y: number,
      button?: "left" | "right" | "double",
    ) => Promise<{ success: boolean; message?: string; error?: string }>;
    type: (
      text: string,
    ) => Promise<{ success: boolean; message?: string; error?: string }>;
    keyPress: (
      key: string,
    ) => Promise<{ success: boolean; message?: string; error?: string }>;
    scroll: (
      direction: "up" | "down",
      amount?: number,
    ) => Promise<{ success: boolean; message?: string; error?: string }>;
    drag: (
      startX: number,
      startY: number,
      endX: number,
      endY: number,
    ) => Promise<{ success: boolean; message?: string; error?: string }>;
    launch: (
      app: string,
      args?: string[],
    ) => Promise<{
      success: boolean;
      message?: string;
      pid?: number;
      error?: string;
    }>;
    getDisplayInfo: () => Promise<{
      displays: Array<{
        id: number;
        bounds: { x: number; y: number; width: number; height: number };
        workArea: { x: number; y: number; width: number; height: number };
        scaleFactor: number;
        isPrimary: boolean;
      }>;
    }>;
    getCursorPosition: () => Promise<{ x: number; y: number }>;
  };

  // App utilities
  app: {
    getVersion: () => Promise<string>;
    getPath: (name: string) => Promise<string>;
    quit: () => void;
  };

  // AI streaming (IPC-based, no HTTP server needed)
  ai: {
    stream: (request: {
      threadId: string;
      messages: any[];
      chatModel: { provider: string; model: string };
      toolChoice?: string;
      allowedAppDefaultToolkit?: string[];
      allowedMcpServers?: Record<string, any>;
      mentions?: any[];
      message: any;
      imageTool?: { model?: string };
      attachments?: any[];
    }) => Promise<{ success?: boolean; error?: string; threadId?: string }>;
    abort: (threadId: string) => Promise<{ success: boolean; error?: string }>;
    generateTitle: (request: {
      threadId: string;
      message: string;
      chatModel: { provider: string; model: string };
    }) => Promise<{ success?: boolean; title?: string; error?: string }>;
    generateObject: (request: {
      chatModel: { provider: string; model: string };
      prompt: { system?: string; user?: string };
      schema: any;
    }) => Promise<{ success?: boolean; object?: any; error?: string }>;
    onStreamChunk: (
      callback: (data: {
        threadId: string;
        chunk?: string;
        type?: string;
        text?: string;
      }) => void,
    ) => () => void;
    onStreamEnd: (
      callback: (data: {
        threadId: string;
        usage?: any;
        finishReason?: string;
      }) => void,
    ) => () => void;
    onStreamError: (
      callback: (data: { threadId: string; error: string }) => void,
    ) => () => void;
    onTitleGenerated: (
      callback: (data: { threadId: string; title: string }) => void,
    ) => () => void;
  };

  // Models management
  models: {
    // Provider configuration
    getProviders: () => Promise<any[]>;
    getProvider: (id: string) => Promise<any>;
    saveProvider: (data: {
      id?: string;
      name: string;
      providerId: string;
      type: "cloud" | "local";
      baseUrl?: string;
      authType: "api-key" | "oauth" | "none";
      enabled?: boolean;
      metadata?: Record<string, unknown>;
    }) => Promise<any>;
    deleteProvider: (id: string) => Promise<{ success: boolean }>;
    testProvider: (data: {
      providerId: string;
      baseUrl?: string;
      apiKey?: string;
    }) => Promise<{
      success: boolean;
      error?: string;
      modelCount?: number;
      models?: Array<{ name: string; size?: number; family?: string }>;
    }>;

    // API keys
    getApiKeys: () => Promise<
      Array<{
        id: string;
        providerId: string;
        keyHint: string;
        isValid: boolean;
        lastValidatedAt?: Date;
        errorMessage?: string;
      }>
    >;
    saveApiKey: (data: {
      providerId: string;
      apiKey: string;
      validate?: boolean;
    }) => Promise<{
      success: boolean;
      isValid?: boolean;
      error?: string;
      key?: {
        id: string;
        providerId: string;
        keyHint: string;
        isValid: boolean;
      };
    }>;
    deleteApiKey: (providerId: string) => Promise<{ success: boolean }>;
    validateApiKey: (data: {
      providerId: string;
      apiKey: string;
      baseUrl?: string;
    }) => Promise<{
      success: boolean;
      error?: string;
      modelCount?: number;
    }>;
    getDecryptedApiKey: (providerId: string) => Promise<string | null>;
    fetchProviderModels: (data: {
      providerId: string;
      apiKey: string;
    }) => Promise<{
      success: boolean;
      models?: Array<{
        id: string;
        name: string;
        displayName: string;
        isToolCallSupported: boolean;
        isImageInputSupported: boolean;
        isReasoningModel: boolean;
        workflowGenerationSupport: "full" | "limited" | "none";
        toolCallUnsupportedReason?:
          | "reasoning-model"
          | "built-in-tools"
          | "responses-api-only";
        reasoningEffort?: string[];
        thinkingLevel?: string[];
        supportedFileMimeTypes: string[];
      }>;
      error?: string;
    }>;

    // Local models
    getLocalModels: () => Promise<any[]>;
    refreshLocalModels: (data: {
      providerId: string;
      baseUrl?: string;
    }) => Promise<{
      success: boolean;
      models?: any[];
      error?: string;
    }>;
    downloadModel: (data: {
      modelName: string;
      baseUrl?: string;
    }) => Promise<{
      success: boolean;
      modelId?: string;
      error?: string;
    }>;
    deleteLocalModel: (data: {
      id?: string;
      modelName?: string;
      providerId?: string;
    }) => Promise<{ success: boolean }>;

    // Combined status
    getAvailableModels: () => Promise<{
      cloudProviders: string[];
      providers: any[];
      localModels: any[];
    }>;
    getStatus: () => Promise<{
      totalProviders: number;
      connectedProviders: number;
      validApiKeys: number;
      totalLocalModels: number;
      availableLocalModels: number;
      downloadingModels: number;
    }>;
  };
}

// Expose protected methods that allow the renderer process to use
// ipcRenderer without exposing the entire object
const electronAPI: ElectronAPI = {
  platform: process.platform,

  // Authentication operations
  auth: {
    // Core auth methods
    isFirstLaunch: () => ipcRenderer.invoke("auth:isFirstLaunch"),
    register: (data: RegisterData) => ipcRenderer.invoke("auth:register", data),
    signIn: (data: SignInData) => ipcRenderer.invoke("auth:signIn", data),
    signOut: () => ipcRenderer.invoke("auth:signOut"),
    validateSession: () => ipcRenderer.invoke("auth:validateSession"),

    // Backwards compatible methods
    getSession: () => ipcRenderer.invoke("auth:getSession"),
    getCurrentUser: () => ipcRenderer.invoke("auth:getCurrentUser"),
    isAuthenticated: () => ipcRenderer.invoke("auth:isAuthenticated"),
    updateProfile: (data: { name?: string; image?: string | null }) =>
      ipcRenderer.invoke("auth:updateProfile", data),
    getPreferences: () => ipcRenderer.invoke("auth:getPreferences"),
    updatePreferences: (preferences: any) =>
      ipcRenderer.invoke("auth:updatePreferences", preferences),
  },

  // Database operations
  db: {
    chat: {
      getThreads: (userId: string) =>
        ipcRenderer.invoke("db:chat:getThreads", userId),
      getThread: (id: string) => ipcRenderer.invoke("db:chat:getThread", id),
      getThreadWithMessages: (threadId: string, userId: string) =>
        ipcRenderer.invoke("db:chat:getThreadWithMessages", threadId, userId),
      getMessages: (threadId: string) =>
        ipcRenderer.invoke("db:chat:getMessages", threadId),
      createThread: (data: any) =>
        ipcRenderer.invoke("db:chat:createThread", data),
      createMessage: (data: any) =>
        ipcRenderer.invoke("db:chat:createMessage", data),
      updateThread: (id: string, data: any) =>
        ipcRenderer.invoke("db:chat:updateThread", id, data),
      deleteThread: (id: string) =>
        ipcRenderer.invoke("db:chat:deleteThread", id),
      deleteAllThreads: (userId: string) =>
        ipcRenderer.invoke("db:chat:deleteAllThreads", userId),
      deleteUnarchivedThreads: (userId: string) =>
        ipcRenderer.invoke("db:chat:deleteUnarchivedThreads", userId),
      // New handlers
      upsertMessage: (data: { message: any; threadId: string }) =>
        ipcRenderer.invoke("db:chat:upsertMessage", data),
      deleteMessage: (messageId: string) =>
        ipcRenderer.invoke("db:chat:deleteMessage", messageId),
      deleteMessagesAfterTimestamp: (data: {
        threadId: string;
        messageId: string;
      }) => ipcRenderer.invoke("db:chat:deleteMessagesAfterTimestamp", data),
      updateMessageParts: (data: { messageId: string; parts: any[] }) =>
        ipcRenderer.invoke("db:chat:updateMessageParts", data),
    },
    agents: {
      getAll: (userId: string) =>
        ipcRenderer.invoke("db:agents:getAll", userId),
      getById: (id: string) => ipcRenderer.invoke("db:agents:getById", id),
      selectAgents: (
        userId: string,
        filters: string[] = ["all"],
        limit: number = 50,
      ) => ipcRenderer.invoke("db:agents:selectAgents", userId, filters, limit),
      create: (data: any) => ipcRenderer.invoke("db:agents:create", data),
      update: (id: string, data: any) =>
        ipcRenderer.invoke("db:agents:update", id, data),
      delete: (id: string) => ipcRenderer.invoke("db:agents:delete", id),
    },
    workflows: {
      getAll: (userId: string) =>
        ipcRenderer.invoke("db:workflows:getAll", userId),
      getById: (id: string) => ipcRenderer.invoke("db:workflows:getById", id),
      create: (data: any) => ipcRenderer.invoke("db:workflows:create", data),
      update: (id: string, data: any) =>
        ipcRenderer.invoke("db:workflows:update", id, data),
      delete: (id: string) => ipcRenderer.invoke("db:workflows:delete", id),
      saveNodes: (workflowId: string, nodes: any[]) =>
        ipcRenderer.invoke("db:workflows:saveNodes", workflowId, nodes),
      saveEdges: (workflowId: string, edges: any[]) =>
        ipcRenderer.invoke("db:workflows:saveEdges", workflowId, edges),
      saveStructure: (
        workflowId: string,
        data: {
          nodes?: any[];
          edges?: any[];
          deleteNodes?: string[];
          deleteEdges?: string[];
        },
      ) => ipcRenderer.invoke("db:workflows:saveStructure", workflowId, data),
    },
    mcp: {
      getServers: () => ipcRenderer.invoke("db:mcp:getServers"),
      getServerById: (id: string) =>
        ipcRenderer.invoke("db:mcp:getServerById", id),
      saveServer: (data: any) => ipcRenderer.invoke("db:mcp:saveServer", data),
      deleteServer: (id: string) =>
        ipcRenderer.invoke("db:mcp:deleteServer", id),
      getToolCustomizations: (serverId: string) =>
        ipcRenderer.invoke("db:mcp:getToolCustomizations", serverId),
      saveToolCustomization: (data: any) =>
        ipcRenderer.invoke("db:mcp:saveToolCustomization", data),
      // New handlers
      existsByServerName: (name: string) =>
        ipcRenderer.invoke("db:mcp:existsByServerName", name),
      refreshClient: (serverId: string) =>
        ipcRenderer.invoke("db:mcp:refreshClient", serverId),
      callTool: (data: { serverId: string; toolName: string; args: any }) =>
        ipcRenderer.invoke("db:mcp:callTool", data),
      callToolByServerName: (data: {
        serverName: string;
        toolName: string;
        args: any;
      }) => ipcRenderer.invoke("db:mcp:callToolByServerName", data),
      getServerStatus: (serverId: string) =>
        ipcRenderer.invoke("db:mcp:getServerStatus", serverId),
      updateVisibility: (data: {
        serverId: string;
        visibility: "public" | "private";
      }) => ipcRenderer.invoke("db:mcp:updateVisibility", data),
      getServersWithStatus: () =>
        ipcRenderer.invoke("db:mcp:getServersWithStatus"),
    },
    user: {
      getPreferences: () => ipcRenderer.invoke("db:user:getPreferences"),
      updatePreferences: (data: any) =>
        ipcRenderer.invoke("db:user:updatePreferences", data),
      getCurrent: () => ipcRenderer.invoke("db:user:getCurrent"),
      updateProfile: (data: any) =>
        ipcRenderer.invoke("db:user:updateProfile", data),
      getById: (userId: string) =>
        ipcRenderer.invoke("db:user:getById", userId),
      getStats: (userId: string) =>
        ipcRenderer.invoke("db:user:getStats", userId),
      // New handlers
      updateImage: (imageUrl: string) =>
        ipcRenderer.invoke("db:user:updateImage", imageUrl),
      updateDetails: (data: { name?: string }) =>
        ipcRenderer.invoke("db:user:updateDetails", data),
    },
    archives: {
      getAll: (userId: string) =>
        ipcRenderer.invoke("db:archives:getAll", userId),
      getById: (id: string) => ipcRenderer.invoke("db:archives:getById", id),
      create: (data: any) => ipcRenderer.invoke("db:archives:create", data),
      update: (id: string, data: any) =>
        ipcRenderer.invoke("db:archives:update", id, data),
      delete: (id: string) => ipcRenderer.invoke("db:archives:delete", id),
      archiveThread: (threadId: string, archiveId: string, userId: string) =>
        ipcRenderer.invoke(
          "db:archives:archiveThread",
          threadId,
          archiveId,
          userId,
        ),
      unarchiveThread: (threadId: string, archiveId?: string) =>
        ipcRenderer.invoke("db:archives:unarchiveThread", threadId, archiveId),
      getItems: (archiveId: string) =>
        ipcRenderer.invoke("db:archives:getItems", archiveId),
      getItemArchives: (itemId: string) =>
        ipcRenderer.invoke("db:archives:getItemArchives", itemId),
    },
    bookmark: {
      toggle: (
        userId: string,
        itemId: string,
        itemType: "agent" | "workflow" | "mcp",
        isCurrentlyBookmarked: boolean,
      ) =>
        ipcRenderer.invoke(
          "db:bookmark:toggle",
          userId,
          itemId,
          itemType,
          isCurrentlyBookmarked,
        ),
    },
  },

  // File operations
  files: {
    upload: (data: {
      content: string | Buffer;
      filename?: string;
      contentType?: string;
      category?: "uploads" | "fragments" | "exports" | "sandbox";
    }) => ipcRenderer.invoke("files:upload", data),
    download: (key: string) => ipcRenderer.invoke("files:download", key),
    delete: (key: string) => ipcRenderer.invoke("files:delete", key),
    exists: (key: string) => ipcRenderer.invoke("files:exists", key),
    getMetadata: (key: string) => ipcRenderer.invoke("files:getMetadata", key),
    getSourceUrl: (key: string) =>
      ipcRenderer.invoke("files:getSourceUrl", key),
    getDownloadUrl: (key: string) =>
      ipcRenderer.invoke("files:getDownloadUrl", key),
    listFiles: (category: "uploads" | "fragments" | "exports" | "sandbox") =>
      ipcRenderer.invoke("files:listFiles", category),
    clearCategory: (
      category: "uploads" | "fragments" | "exports" | "sandbox",
    ) => ipcRenderer.invoke("files:clearCategory", category),
    getStats: () => ipcRenderer.invoke("files:getStats"),
  },

  // Vector search
  vector: {
    initialize: () => ipcRenderer.invoke("vector:initialize"),
    search: (queryEmbedding: number[], options: any) =>
      ipcRenderer.invoke("vector:search", queryEmbedding, options),
    insert: (documents: any[]) =>
      ipcRenderer.invoke("vector:insert", documents),
    delete: (ids: string[]) => ipcRenderer.invoke("vector:delete", ids),
    deleteByThread: (threadId: string) =>
      ipcRenderer.invoke("vector:deleteByThread", threadId),
    getStats: () => ipcRenderer.invoke("vector:getStats"),
  },

  // Embeddings
  embeddings: {
    generate: (texts: string[]) =>
      ipcRenderer.invoke("embeddings:generate", texts),
    generateBatch: (texts: string[], batchSize?: number) =>
      ipcRenderer.invoke("embeddings:generateBatch", texts, batchSize),
    cosineSimilarity: (embedding1: number[], embedding2: number[]) =>
      ipcRenderer.invoke("embeddings:cosineSimilarity", embedding1, embedding2),
  },

  // RAG
  rag: {
    query: (query: string, options: any) =>
      ipcRenderer.invoke("rag:query", query, options),
  },

  // Graph memory
  graph: {
    extractEntities: (document: any) =>
      ipcRenderer.invoke("graph:extractEntities", document),
    search: (entityId: string, options: any) =>
      ipcRenderer.invoke("graph:search", entityId, options),
    query: (naturalLanguageQuery: string) =>
      ipcRenderer.invoke("graph:query", naturalLanguageQuery),
  },

  // Sandbox
  sandbox: {
    executeCode: (code: string, language: string) =>
      ipcRenderer.invoke("sandbox:execute", code, language),
    getFiles: (threadId: string) =>
      ipcRenderer.invoke("sandbox:getFiles", threadId),
  },

  // Chrome automation
  chrome: {
    connect: (port: number) => ipcRenderer.invoke("chrome:connect", port),
    navigate: (url: string) => ipcRenderer.invoke("chrome:navigate", url),
    screenshot: () => ipcRenderer.invoke("chrome:screenshot"),
    evaluate: (script: string) => ipcRenderer.invoke("chrome:evaluate", script),
  },

  // Terminal operations
  terminal: {
    execute: (options: {
      command: string;
      cwd?: string;
      timeout?: number;
      env?: Record<string, string>;
    }) => ipcRenderer.invoke("terminal:execute", options),
    screenshot: (options?: { fullScreen?: boolean; displayId?: string }) =>
      ipcRenderer.invoke("terminal:screenshot", options),
    click: (x: number, y: number, button?: "left" | "right" | "double") =>
      ipcRenderer.invoke("terminal:click", x, y, button),
    type: (text: string) => ipcRenderer.invoke("terminal:type", text),
    keyPress: (key: string) => ipcRenderer.invoke("terminal:keyPress", key),
    scroll: (direction: "up" | "down", amount?: number) =>
      ipcRenderer.invoke("terminal:scroll", direction, amount),
    drag: (startX: number, startY: number, endX: number, endY: number) =>
      ipcRenderer.invoke("terminal:drag", startX, startY, endX, endY),
    launch: (app: string, args?: string[]) =>
      ipcRenderer.invoke("terminal:launch", app, args),
    getDisplayInfo: () => ipcRenderer.invoke("terminal:getDisplayInfo"),
    getCursorPosition: () => ipcRenderer.invoke("terminal:getCursorPosition"),
  },

  // App utilities
  app: {
    getVersion: () => ipcRenderer.invoke("app:getVersion"),
    getPath: (name: string) => ipcRenderer.invoke("app:getPath", name),
    quit: () => ipcRenderer.send("app:quit"),
  },

  // AI streaming (IPC-based, no HTTP server needed)
  ai: {
    stream: (request: {
      threadId: string;
      messages: any[];
      chatModel: { provider: string; model: string };
      toolChoice?: string;
      allowedAppDefaultToolkit?: string[];
      allowedMcpServers?: Record<string, any>;
      mentions?: any[];
      message: any;
      imageTool?: { model?: string };
      attachments?: any[];
    }) => ipcRenderer.invoke("ai:stream", request),
    abort: (threadId: string) => ipcRenderer.invoke("ai:abort", threadId),
    generateTitle: (request: {
      threadId: string;
      message: string;
      chatModel: { provider: string; model: string };
    }) => ipcRenderer.invoke("ai:generateTitle", request),
    generateObject: (request: {
      chatModel: { provider: string; model: string };
      prompt: { system?: string; user?: string };
      schema: any;
    }) => ipcRenderer.invoke("ai:generateObject", request),
    onStreamChunk: (
      callback: (data: {
        threadId: string;
        chunk?: string;
        type?: string;
        text?: string;
      }) => void,
    ) => {
      const handler = (_event: any, data: any) => callback(data);
      ipcRenderer.on("ai:stream:chunk", handler);
      return () => ipcRenderer.removeListener("ai:stream:chunk", handler);
    },
    onStreamEnd: (
      callback: (data: {
        threadId: string;
        usage?: any;
        finishReason?: string;
      }) => void,
    ) => {
      const handler = (_event: any, data: any) => callback(data);
      ipcRenderer.on("ai:stream:end", handler);
      return () => ipcRenderer.removeListener("ai:stream:end", handler);
    },
    onStreamError: (
      callback: (data: { threadId: string; error: string }) => void,
    ) => {
      const handler = (_event: any, data: any) => callback(data);
      ipcRenderer.on("ai:stream:error", handler);
      return () => ipcRenderer.removeListener("ai:stream:error", handler);
    },
    onTitleGenerated: (
      callback: (data: { threadId: string; title: string }) => void,
    ) => {
      const handler = (_event: any, data: any) => callback(data);
      ipcRenderer.on("ai:title:generated", handler);
      return () => ipcRenderer.removeListener("ai:title:generated", handler);
    },
  },

  // Models management
  models: {
    // Provider configuration
    getProviders: () => ipcRenderer.invoke("models:getProviders"),
    getProvider: (id: string) => ipcRenderer.invoke("models:getProvider", id),
    saveProvider: (data: {
      id?: string;
      name: string;
      providerId: string;
      type: "cloud" | "local";
      baseUrl?: string;
      authType: "api-key" | "oauth" | "none";
      enabled?: boolean;
      metadata?: Record<string, unknown>;
    }) => ipcRenderer.invoke("models:saveProvider", data),
    deleteProvider: (id: string) =>
      ipcRenderer.invoke("models:deleteProvider", id),
    testProvider: (data: {
      providerId: string;
      baseUrl?: string;
      apiKey?: string;
    }) => ipcRenderer.invoke("models:testProvider", data),

    // API keys
    getApiKeys: () => ipcRenderer.invoke("models:getApiKeys"),
    saveApiKey: (data: {
      providerId: string;
      apiKey: string;
      validate?: boolean;
    }) => ipcRenderer.invoke("models:saveApiKey", data),
    deleteApiKey: (providerId: string) =>
      ipcRenderer.invoke("models:deleteApiKey", providerId),
    validateApiKey: (data: {
      providerId: string;
      apiKey: string;
      baseUrl?: string;
    }) => ipcRenderer.invoke("models:validateApiKey", data),
    getDecryptedApiKey: (providerId: string) =>
      ipcRenderer.invoke("models:getDecryptedApiKey", providerId),
    fetchProviderModels: (data: {
      providerId: string;
      apiKey: string;
    }) => ipcRenderer.invoke("models:fetchProviderModels", data),

    // Local models
    getLocalModels: () => ipcRenderer.invoke("models:getLocalModels"),
    refreshLocalModels: (data: { providerId: string; baseUrl?: string }) =>
      ipcRenderer.invoke("models:refreshLocalModels", data),
    downloadModel: (data: { modelName: string; baseUrl?: string }) =>
      ipcRenderer.invoke("models:downloadModel", data),
    deleteLocalModel: (data: {
      id?: string;
      modelName?: string;
      providerId?: string;
    }) => ipcRenderer.invoke("models:deleteLocalModel", data),

    // Combined status
    getAvailableModels: () => ipcRenderer.invoke("models:getAvailableModels"),
    getStatus: () => ipcRenderer.invoke("models:getStatus"),
  },
};

// Use contextBridge to expose the API to the renderer process
contextBridge.exposeInMainWorld("electronAPI", electronAPI);

// Also expose Node.js process information (read-only)
contextBridge.exposeInMainWorld("process", {
  platform: process.platform,
  env: {
    NODE_ENV: process.env.NODE_ENV,
  },
});

// TypeScript declaration for global window object
declare global {
  interface Window {
    electronAPI: ElectronAPI;
    process: {
      platform: NodeJS.Platform;
      env: {
        NODE_ENV: string | undefined;
      };
    };
  }
}
