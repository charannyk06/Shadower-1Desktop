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
    bookmark: {
      toggle: (
        userId: string,
        itemId: string,
        itemType: "agent" | "mcp",
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
    mcp: {
      getServers: () => Promise<any[]>;
      getServerById: (id: string) => Promise<any>;
      saveServer: (data: any) => Promise<any>;
      deleteServer: (id: string) => Promise<void>;
      getToolCustomizations: (serverId: string) => Promise<any[]>;
      saveToolCustomization: (data: any) => Promise<any>;
      // New handlers
      existsByServerName: (name: string) => Promise<boolean>;
      refreshClient: (serverId: string) => Promise<{
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
      authorize: (serverId: string) => Promise<{
        success: boolean;
        authUrl?: string;
        needsAuth?: boolean;
        error?: string;
      }>;
      checkToken: (serverId: string) => Promise<{
        valid: boolean;
        reason?: string;
      }>;
      finishOAuth: (data: { code: string; state: string }) => Promise<{
        success: boolean;
        serverId?: string;
        serverName?: string;
        status?: string;
        toolInfo?: any[];
        error?: string;
      }>;
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
      category?: "uploads" | "fragments" | "exports" | "workspace";
    }) => Promise<any>;
    download: (key: string) => Promise<string>;
    delete: (key: string) => Promise<{ success: boolean }>;
    exists: (key: string) => Promise<boolean>;
    getMetadata: (key: string) => Promise<any>;
    getSourceUrl: (key: string) => Promise<string | null>;
    getDownloadUrl: (key: string) => Promise<string | null>;
    listFiles: (
      category: "uploads" | "fragments" | "exports" | "workspace",
    ) => Promise<any[]>;
    listWorkingDirectory: (options: {
      directoryPath: string;
      maxDepth?: number;
    }) => Promise<{
      success: boolean;
      error?: string;
      files: Array<{
        name: string;
        path: string;
        relativePath: string;
        size: number;
        type: string;
        isDirectory: boolean;
        uploadedAt: string;
        source: "working-directory";
      }>;
    }>;
    readTextFile: (options: {
      filePath: string;
      maxSize?: number;
    }) => Promise<{
      success: boolean;
      error?: string;
      content: string | null;
      size?: number;
      modifiedAt?: string;
    }>;
    clearCategory: (
      category: "uploads" | "fragments" | "exports" | "workspace",
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

  // Memory (semantic search over past conversations)
  memory: {
    search: (
      query: string,
      options?: {
        collections?: Array<"messages" | "documents" | "knowledge">;
        limit?: number;
        scoreThreshold?: number;
        userId?: string;
        threadId?: string;
      },
    ) => Promise<{
      results: Array<{
        id: string;
        content: string;
        score: number;
        source: "messages" | "documents" | "knowledge";
        threadId?: string;
        messageId?: string;
        role?: string;
        createdAt?: string;
        metadata?: Record<string, unknown>;
      }>;
      elapsedMs: number;
    }>;
    index: (
      items: Array<{
        id?: string;
        content: string;
        threadId?: string;
        messageId?: string;
        userId: string;
        role?: string;
        collection?: "messages" | "documents" | "knowledge";
        metadata?: Record<string, unknown>;
      }>,
    ) => Promise<{ indexed: number; errors: string[] }>;
    delete: (
      ids: string[],
      collection?: "messages" | "documents",
    ) => Promise<{ success: boolean; deleted: number }>;
    deleteByThread: (threadId: string) => Promise<{ success: boolean }>;
    getStats: () => Promise<{
      messages: number;
      documents: number;
      available: boolean;
      embeddingCacheSize: number;
    }>;
    clearCache: () => Promise<{ success: boolean }>;
    generateEmbedding: (text: string) => Promise<number[]>;
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

  // Knowledge Base & Document Management (Full RAG System)
  knowledge: {
    // Knowledge Base CRUD
    createBase: (data: {
      name: string;
      description?: string;
      userId: string;
    }) => Promise<{
      knowledgeBase: {
        id: string;
        name: string;
        description?: string;
        documentCount: number;
        totalChunks: number;
        isActive: boolean;
        createdAt: string;
        updatedAt: string;
      } | null;
      error?: string;
    }>;
    listBases: (userId: string) => Promise<{
      knowledgeBases: Array<{
        id: string;
        name: string;
        description?: string;
        documentCount: number;
        totalChunks: number;
        isActive: boolean;
        createdAt: string;
        updatedAt: string;
      }>;
    }>;
    getBase: (
      id: string,
      userId: string,
    ) => Promise<{
      knowledgeBase: {
        id: string;
        name: string;
        description?: string;
        documentCount: number;
        totalChunks: number;
        isActive: boolean;
        createdAt: string;
        updatedAt: string;
      } | null;
    }>;
    updateBase: (
      id: string,
      userId: string,
      data: { name?: string; description?: string },
    ) => Promise<{
      knowledgeBase: {
        id: string;
        name: string;
        description?: string;
        documentCount: number;
        totalChunks: number;
        isActive: boolean;
        createdAt: string;
        updatedAt: string;
      } | null;
      error?: string;
    }>;
    deleteBase: (
      id: string,
      userId: string,
    ) => Promise<{ success: boolean; error?: string }>;

    // Document Management
    selectFile: () => Promise<{
      filePath: string;
      fileName: string;
    } | null>;
    uploadDocument: (data: {
      knowledgeBaseId: string;
      userId: string;
      filePath: string;
      fileName: string;
    }) => Promise<{
      document: {
        id: string;
        knowledgeBaseId: string;
        fileName: string;
        fileType: string;
        fileSize: number;
        chunkCount: number;
        status: "pending" | "processing" | "indexed" | "failed";
        errorMessage?: string;
        createdAt: string;
        updatedAt: string;
      } | null;
      error?: string;
    }>;
    listDocuments: (
      knowledgeBaseId: string,
      userId: string,
    ) => Promise<{
      documents: Array<{
        id: string;
        knowledgeBaseId: string;
        fileName: string;
        fileType: string;
        fileSize: number;
        chunkCount: number;
        status: "pending" | "processing" | "indexed" | "failed";
        errorMessage?: string;
        createdAt: string;
        updatedAt: string;
      }>;
    }>;
    deleteDocument: (
      documentId: string,
      userId: string,
    ) => Promise<{ success: boolean; error?: string }>;

    // Memory List
    listMemories: (params: {
      userId: string;
      page?: number;
      limit?: number;
      source?: "all" | "messages" | "documents" | "knowledge";
      search?: string;
    }) => Promise<{
      memories: Array<{
        id: string;
        content: string;
        role?: "user" | "assistant";
        source?: "messages" | "knowledge" | "documents";
        threadId?: string;
        messageId?: string;
        createdAt?: string;
        knowledgeBaseId?: string;
        knowledgeBaseName?: string;
        fileName?: string;
        documentType?: string;
        title?: string;
      }>;
      pagination: {
        page: number;
        limit: number;
        total: number;
        totalPages: number;
        hasMore: boolean;
      };
    }>;

    // Statistics
    getStats: () => Promise<{
      messages: number;
      documents: number;
      available: boolean;
      totalKnowledgeBases?: number;
      totalChunks?: number;
    }>;
  };

  // Browser automation (agent-browser powered)
  browser: {
    // Session management
    createSession: (options?: {
      headless?: boolean;
      executablePath?: string;
      cdpPort?: number;
      cdpUrl?: string;
      viewport?: { width: number; height: number };
    }) => Promise<{
      sessionId?: string;
      url?: string;
      title?: string;
      error?: string;
    }>;
    closeSession: (sessionId?: string) => Promise<{
      success?: boolean;
      error?: string;
    }>;
    listSessions: () => Promise<
      Array<{ id: string; createdAt: Date; isActive: boolean }>
    >;
    switchSession: (sessionId: string) => Promise<{
      success?: boolean;
      error?: string;
    }>;

    // Navigation
    navigate: (
      url: string,
      options?: {
        waitUntil?: "load" | "domcontentloaded" | "networkidle";
        sessionId?: string;
      },
    ) => Promise<{ url?: string; title?: string; error?: string }>;
    goBack: (sessionId?: string) => Promise<{ url?: string; error?: string }>;
    goForward: (
      sessionId?: string,
    ) => Promise<{ url?: string; error?: string }>;
    reload: (sessionId?: string) => Promise<{ url?: string; error?: string }>;

    // AI-optimized snapshot (the key feature!)
    getSnapshot: (options?: {
      interactive?: boolean;
      maxDepth?: number;
      compact?: boolean;
      selector?: string;
      sessionId?: string;
    }) => Promise<{
      tree?: string;
      refs?: Record<string, { selector: string; role: string; name?: string }>;
      stats?: {
        lines: number;
        chars: number;
        refs: number;
        interactive: number;
      };
      error?: string;
    }>;

    // Actions (support refs like @e1 or CSS selectors)
    click: (
      selector: string,
      options?: { sessionId?: string },
    ) => Promise<{ success?: boolean; error?: string }>;
    fill: (
      selector: string,
      value: string,
      options?: { sessionId?: string },
    ) => Promise<{ success?: boolean; error?: string }>;
    type: (
      selector: string,
      text: string,
      options?: { delay?: number; sessionId?: string },
    ) => Promise<{ success?: boolean; error?: string }>;
    press: (
      key: string,
      options?: { selector?: string; sessionId?: string },
    ) => Promise<{ success?: boolean; error?: string }>;
    screenshot: (options?: {
      fullPage?: boolean;
      path?: string;
      sessionId?: string;
    }) => Promise<{
      success?: boolean;
      data?: { base64?: string; path?: string };
      error?: string;
    }>;
    scroll: (options?: {
      direction?: "up" | "down";
      amount?: number;
      selector?: string;
      sessionId?: string;
    }) => Promise<{ success?: boolean; error?: string }>;

    // Utilities
    evaluate: (
      script: string,
      options?: { sessionId?: string },
    ) => Promise<{ result?: any; error?: string }>;
    wait: (options: {
      selector?: string;
      state?: "visible" | "hidden" | "attached" | "detached";
      timeout?: number;
      loadState?: "load" | "domcontentloaded" | "networkidle";
      sessionId?: string;
    }) => Promise<{ success?: boolean; error?: string }>;
    getContent: (options?: {
      selector?: string;
      sessionId?: string;
    }) => Promise<{ html?: string; error?: string }>;
    getUrl: (sessionId?: string) => Promise<{ url?: string; error?: string }>;
    getTitle: (
      sessionId?: string,
    ) => Promise<{ title?: string; error?: string }>;

    // Multi-tab support
    newTab: (options?: {
      url?: string;
      sessionId?: string;
    }) => Promise<{
      index?: number;
      total?: number;
      url?: string;
      error?: string;
    }>;
    newWindow: (options?: {
      viewport?: { width: number; height: number };
      sessionId?: string;
    }) => Promise<{
      index?: number;
      total?: number;
      error?: string;
    }>;
    switchTab: (
      index: number,
      sessionId?: string,
    ) => Promise<{
      index?: number;
      url?: string;
      title?: string;
      error?: string;
    }>;
    closeTab: (options?: {
      index?: number;
      sessionId?: string;
    }) => Promise<{
      closed?: number;
      remaining?: number;
      error?: string;
    }>;
    listTabs: (
      sessionId?: string,
    ) => Promise<
      Array<{ index: number; url: string; title: string; active: boolean }>
    >;
    getActiveTabIndex: (sessionId?: string) => Promise<{
      index?: number;
      error?: string;
    }>;

    // Additional actions
    hover: (
      selector: string,
      options?: { sessionId?: string },
    ) => Promise<{ success?: boolean; error?: string }>;
    select: (
      selector: string,
      values: string | string[],
      options?: { sessionId?: string },
    ) => Promise<{ success?: boolean; error?: string }>;
    check: (
      selector: string,
      options?: { sessionId?: string },
    ) => Promise<{ success?: boolean; error?: string }>;
    uncheck: (
      selector: string,
      options?: { sessionId?: string },
    ) => Promise<{ success?: boolean; error?: string }>;
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

  // Auto-update API
  update: {
    check: () => Promise<{ updateAvailable: boolean; version?: string; error?: string }>;
    install: () => void;
    getStatus: () => Promise<{ currentVersion: string; isDev: boolean }>;
    onAvailable: (
      callback: (data: {
        version: string;
        releaseNotes?: string;
        releaseDate?: string;
      }) => void,
    ) => () => void;
    onProgress: (
      callback: (data: {
        percent: number;
        transferred: number;
        total: number;
        bytesPerSecond: number;
      }) => void,
    ) => () => void;
    onDownloaded: (
      callback: (data: {
        version: string;
        releaseNotes?: string;
        releaseDate?: string;
      }) => void,
    ) => () => void;
    onError: (callback: (data: { message: string }) => void) => () => void;
  };

  // Dialog operations
  dialog: {
    openDirectory: (options?: {
      title?: string;
      defaultPath?: string;
      buttonLabel?: string;
    }) => Promise<{
      success: boolean;
      canceled?: boolean;
      path?: string;
      name?: string;
      error?: string;
    }>;
    openInFileManager: (directoryPath: string) => Promise<{
      success: boolean;
      error?: string;
    }>;
    showInFileManager: (filePath: string) => Promise<{
      success: boolean;
      error?: string;
    }>;
    openPath: (filePath: string) => Promise<{
      success: boolean;
      error?: string;
    }>;
    saveFile: (options: {
      filename: string;
      content: string;
      defaultPath?: string;
      filters?: { name: string; extensions: string[] }[];
    }) => Promise<{
      success: boolean;
      canceled?: boolean;
      path?: string;
      filename?: string;
      error?: string;
    }>;
    writeToPath: (options: {
      filePath: string;
      content: string;
    }) => Promise<{
      success: boolean;
      path?: string;
      filename?: string;
      error?: string;
    }>;
    // File change listener for tracking changes in session
    onFileChanged: (
      callback: (data: {
        filePath: string;
        filename: string;
        status: "created" | "modified" | "deleted";
        originalContent: string | null;
        newContent: string;
        timestamp: number;
        threadId?: string;
      }) => void,
    ) => () => void;
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
      workingDirectory?: {
        path: string;
        name: string;
      };
    }) => Promise<{
      success?: boolean;
      error?: string;
      threadId?: string;
      status?: string;
    }>;
    startStream: (request: { threadId: string }) => Promise<{
      success?: boolean;
      error?: string;
    }>;
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
    generateText: (request: {
      chatModel: { provider: string; model: string };
      system: string;
      prompt: string;
      maxTokens?: number;
    }) => Promise<{ success?: boolean; text?: string; error?: string }>;
    onStreamChunk: (
      callback: (data: {
        threadId: string;
        chunk?: string;
        type?: string;
        text?: string;
      }) => void,
    ) => () => void;
    // PERFORMANCE: Batched chunk handler for faster streaming
    onStreamChunkBatch: (
      callback: (data: {
        threadId: string;
        chunks: any[];
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
    onStreamStep: (
      callback: (data: {
        threadId: string;
        stepType: string;
        toolCallCount: number;
      }) => void,
    ) => () => void;
    onTitleGenerated: (
      callback: (data: { threadId: string; title: string }) => void,
    ) => () => void;
    onStreamWarning: (
      callback: (data: {
        threadId: string;
        message: string;
        type?: string;
      }) => void,
    ) => () => void;
    onThreadCreated: (
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
    downloadModel: (data: { modelName: string; baseUrl?: string }) => Promise<{
      success: boolean;
      modelId?: string;
      error?: string;
    }>;
    deleteLocalModel: (data: {
      id?: string;
      modelName?: string;
      providerId?: string;
      deleteFromProvider?: boolean;
    }) => Promise<{ success: boolean; error?: string }>;

    // Combined status
    getAvailableModels: () => Promise<{
      cloudProviders: string[];
      providers: any[];
      localModels: any[];
      acpAgents?: Array<{
        id: string;
        displayName: string;
        iconProvider: string;
        authenticated: boolean;
        running: boolean;
      }>;
    }>;
    getStatus: () => Promise<{
      totalProviders: number;
      connectedProviders: number;
      validApiKeys: number;
      totalLocalModels: number;
      availableLocalModels: number;
      downloadingModels: number;
    }>;

    // Ollama-specific
    ollamaIsInstalled: () => Promise<{
      installed: boolean;
      path?: string;
      version?: string;
    }>;
    ollamaCheckHealth: () => Promise<{
      installed: boolean;
      running: boolean;
      version?: string;
      error?: string;
      installPath?: string;
    }>;
    ollamaTryStart: () => Promise<{
      success: boolean;
      message: string;
    }>;
    ollamaInstall: () => Promise<{
      success: boolean;
      message: string;
    }>;
    ollamaGetModels: () => Promise<{
      success: boolean;
      models?: any[];
      error?: string;
    }>;
    ollamaShowModel: (data: { modelName: string }) => Promise<{
      success: boolean;
      model?: any;
      error?: string;
    }>;
    ollamaGetLibraryModels: () => Promise<{
      success: boolean;
      models?: Array<{
        name: string;
        description: string;
        tags?: string[];
        pulls?: number;
        updated?: string;
      }>;
      error?: string;
    }>;
    ollamaSearchLibrary: (data: { query: string }) => Promise<{
      success: boolean;
      models?: Array<{
        name: string;
        description: string;
        tags?: string[];
      }>;
      error?: string;
    }>;
    ollamaWarmup: (data: { modelName: string; baseUrl?: string }) => Promise<{
      success: boolean;
      message?: string;
      loadDuration?: number;
      error?: string;
    }>;
    ollamaUnload: (data: { modelName: string; baseUrl?: string }) => Promise<{
      success: boolean;
      message?: string;
      error?: string;
    }>;
    // Ollama auto-detection (zero-config support)
    ollamaAutoDetect: () => Promise<{
      success: boolean;
      detected: boolean;
      running: boolean;
      modelCount: number;
      models: Array<{
        name: string;
        size: number;
        family?: string;
      }>;
      baseUrl: string;
      isRemote: boolean;
      version?: string;
      error?: string;
    }>;
    ollamaStartAutoDetectPolling: (intervalMs?: number) => Promise<{
      success: boolean;
      error?: string;
    }>;
    ollamaStopAutoDetectPolling: () => Promise<{
      success: boolean;
    }>;

    // LM Studio-specific
    lmstudioCheckHealth: () => Promise<{
      installed: boolean;
      running: boolean;
      version?: string;
      error?: string;
      installPath?: string;
    }>;
    lmstudioGetModels: () => Promise<{
      success: boolean;
      models?: any[];
      error?: string;
    }>;

    // Curated models
    getCuratedModels: () => Promise<{
      success: boolean;
      models?: any[];
      error?: string;
    }>;

    // Cancel download
    cancelDownload: (data: { modelId: string }) => Promise<{
      success: boolean;
      error?: string;
    }>;

    // Event listeners
    onDownloadProgress: (
      callback: (data: {
        modelId: string;
        modelName: string;
        progress: number;
        status?: string;
        total?: number;
        completed?: number;
      }) => void,
    ) => () => void;
    onDownloadComplete: (
      callback: (data: { modelId: string; modelName: string }) => void,
    ) => () => void;
    onDownloadError: (
      callback: (data: {
        modelId: string;
        modelName: string;
        error: string;
      }) => void,
    ) => () => void;
    onOllamaInstallProgress: (
      callback: (data: {
        stage: string;
        percent: number;
        message: string;
      }) => void,
    ) => () => void;
  };

  // Voice operations (OpenAI Realtime + Local STT/TTS)
  voice: {
    // OpenAI Realtime session
    createOpenAISession: (data: {
      model?: string;
      voice?: string;
      agentId?: string;
      mentions?: any[];
      instructions?: string;
      tools?: any[];
    }) => Promise<{
      id: string;
      object: string;
      model: string;
      expires_at: number;
      modalities: string[];
      instructions: string;
      voice: string;
      input_audio_format: string;
      output_audio_format: string;
      input_audio_transcription: any;
      turn_detection: any;
      tools: any[];
      tool_choice: string;
      temperature: number;
      max_response_output_tokens: number | string;
      client_secret: {
        value: string;
        expires_at: number;
      };
    }>;

    // Local TTS (Text-to-Speech)
    synthesize: (data: {
      text: string;
      voice?: string;
      rate?: number;
    }) => Promise<{
      audio: string; // base64 encoded audio
      format: "aiff" | "wav";
    }>;

    // Get available TTS voices
    getAvailableVoices: () => Promise<
      Array<{
        name: string;
        language: string;
      }>
    >;

    // Local STT (Speech-to-Text) - Whisper
    transcribe: (data: {
      audio: string; // base64 encoded audio
      language?: string;
    }) => Promise<{
      text: string;
    }>;
  };

  // ACP (Agent Client Protocol) - External coding agents
  acp: {
    // Agent management
    listAgents: (forceRefresh?: boolean) => Promise<
      Array<{
        id: string;
        installed: boolean;
        authenticated: boolean;
        running: boolean;
        error?: string;
        version?: string;
      }>
    >;
    getAgentStatus: (agentId: string) => Promise<
      | {
          id: string;
          installed: boolean;
          authenticated: boolean;
          running: boolean;
          error?: string;
          version?: string;
        }
      | undefined
    >;
    getInstalledAgents: () => Promise<
      Array<{
        id: string;
        installed: boolean;
        authenticated: boolean;
        running: boolean;
        error?: string;
        version?: string;
      }>
    >;
    startAgent: (agentId: string) => Promise<void>;
    stopAgent: (agentId: string) => Promise<void>;

    // Session management
    createSession: (request: {
      agentId: string;
      workingDirectory?: string;
      mcpServers?: Array<{
        name: string;
        command: string;
        args?: string[];
        env?: Record<string, string>;
      }>;
    }) => Promise<{
      sessionId: string;
      agentId: string;
      workingDirectory?: string;
      createdAt: Date;
      availableModes?: string[];
      currentMode?: string;
      configOptions?: Array<any>;
      models?: any;
    }>;
    setSessionModel: (request: {
      agentId: string;
      sessionId: string;
      modelId: string;
    }) => Promise<void>;
    setSessionConfigOption: (request: {
      agentId: string;
      sessionId: string;
      configId: string;
      value: string;
    }) => Promise<{ configOptions?: Array<any> }>;
    setSessionMode: (request: {
      agentId: string;
      sessionId: string;
      modeId: string;
    }) => Promise<void>;

    // Prompting
    prompt: (request: {
      agentId: string;
      sessionId: string;
      message: string;
      contextFiles?: Array<{ path: string; content?: string }>;
    }) => Promise<{
      sessionId: string;
      stopReason:
        | "end_turn"
        | "tool_use"
        | "max_tokens"
        | "cancelled"
        | "error";
      error?: string;
    }>;
    cancel: (agentId: string, sessionId: string) => Promise<void>;

    // Authentication
    authenticate: (
      agentId: string,
      methodId: string,
    ) => Promise<{ success: boolean; message?: string }>;

    // Permission handling
    respondPermission: (request: {
      requestId: string;
      optionId: string;
      rememberGlobally?: boolean;
    }) => Promise<void>;

    // Agentic loop controls - enables true autonomous agent behavior
    setAutoResume: (
      agentId: string,
      sessionId: string,
      enabled: boolean,
    ) => Promise<void>;
    getAgenticLoopStatus: (
      agentId: string,
      sessionId: string,
    ) => Promise<{
      active: boolean;
      iteration: number;
      pendingTools: number;
      autoResume: boolean;
    } | null>;

    // Session context update - allows updating working directory
    updateSessionContext: (
      agentId: string,
      sessionId: string,
      context: { workingDirectory?: string },
    ) => Promise<{
      sessionId: string;
      workingDirectory?: string;
      contextUpdated: boolean;
    }>;

    // Feature 2: Session list/load/resume and capabilities
    getAgentCapabilities: (agentId: string) => Promise<
      | {
          loadSession: boolean;
          sessionList: boolean;
          sessionResume: boolean;
          prompt?: {
            image?: boolean;
            audio?: boolean;
            embeddedContext?: boolean;
          };
        }
      | undefined
    >;
    listSessions: (
      agentId: string,
      request?: {
        cwd?: string;
        cursor?: string;
      },
    ) => Promise<{
      sessions: Array<{
        sessionId: string;
        cwd?: string;
        title?: string;
        updatedAt?: Date;
        meta?: Record<string, unknown>;
      }>;
      nextCursor?: string;
      meta?: Record<string, unknown>;
    }>;
    loadSession: (request: {
      agentId: string;
      sessionId: string;
      workingDirectory: string;
      mcpServers?: Array<{
        name: string;
        command: string;
        args?: string[];
        env?: Record<string, string>;
      }>;
    }) => Promise<{
      sessionId: string;
      agentId: string;
      workingDirectory: string;
      createdAt: Date;
      availableModes?: string[];
      currentMode?: string;
      configOptions?: Array<any>;
      models?: any;
    }>;
    resumeSession: (request: {
      agentId: string;
      sessionId: string;
      workingDirectory: string;
      mcpServers?: Array<{
        name: string;
        command: string;
        args?: string[];
        env?: Record<string, string>;
      }>;
    }) => Promise<{
      sessionId: string;
      agentId: string;
      workingDirectory: string;
      createdAt: Date;
      availableModes?: string[];
      currentMode?: string;
      configOptions?: Array<any>;
      models?: any;
    }>;

    // Event listeners
    onAgentStarted: (
      callback: (data: { agentId: string }) => void,
    ) => () => void;
    onAgentExit: (
      callback: (data: { agentId: string; code: number | null }) => void,
    ) => () => void;
    onAgentError: (
      callback: (data: { agentId: string; error: string }) => void,
    ) => () => void;
    onAgentAuthenticated: (
      callback: (data: { agentId: string }) => void,
    ) => () => void;
    onAuthRequired: (
      callback: (data: {
        agentId: string;
        methods: Array<{ id: string; name: string; description?: string }>;
      }) => void,
    ) => () => void;
    onSessionCreated: (
      callback: (data: {
        agentId: string;
        session: {
          sessionId: string;
          agentId: string;
          workingDirectory?: string;
          createdAt: Date;
          availableModes?: string[];
          currentMode?: string;
        };
      }) => void,
    ) => () => void;
    onSessionUpdate: (
      callback: (data: {
        agentId: string;
        sessionId: string;
        status: "active" | "idle" | "error";
      }) => void,
    ) => () => void;
    onMessageChunk: (
      callback: (data: {
        sessionId: string;
        agentId: string;
        messageId: string;
        type:
          | "text"
          | "thinking"
          | "tool_call"
          | "tool_result"
          | "error"
          | "plan"
          | "terminal_output"
          | "terminal_exit"
          | "commands_update"
          | "session_info";
        content:
          | string
          | {
              id?: string;
              name?: string;
              input?: unknown;
              output?: unknown;
              state?: string;
              toolName?: string;
              isSubagent?: boolean;
              kind?: string;
            }
          | {
              planId: string;
              title?: string;
              steps: Array<{
                id: string;
                description: string;
                status: "pending" | "in_progress" | "completed" | "failed";
              }>;
              status: "pending" | "in_progress" | "completed" | "failed";
            }
          | Array<{
              id: string;
              name: string;
              description?: string;
              arguments?: Array<{
                name: string;
                description?: string;
                required?: boolean;
              }>;
            }>;
        done?: boolean;
      }) => void,
    ) => () => void;
    onPermissionRequest: (
      callback: (data: {
        agentId: string;
        sessionId: string;
        requestId: string;
        title: string;
        description?: string;
        options: Array<{
          id: string;
          label: string;
          description?: string;
          isDefault?: boolean;
        }>;
        metadata?: Record<string, unknown>;
      }) => void,
    ) => () => void;

    // Feature 2: Session load/resume events
    onSessionLoaded: (
      callback: (data: {
        sessionId: string;
        agentId: string;
        workingDirectory: string;
      }) => void,
    ) => () => void;
    onSessionResumed: (
      callback: (data: {
        sessionId: string;
        agentId: string;
        workingDirectory: string;
      }) => void,
    ) => () => void;
    onSessionRecreated: (
      callback: (data: {
        agentId: string;
        oldSessionId: string;
        newSession: {
          sessionId: string;
          agentId: string;
          workingDirectory: string;
        };
      }) => void,
    ) => () => void;
    onSessionContextUpdated: (
      callback: (data: {
        agentId: string;
        sessionId: string;
        workingDirectory?: string;
      }) => void,
    ) => () => void;

    // Feature 3: Terminal events
    onTerminalCreated: (
      callback: (data: {
        agentId: string;
        sessionId: string;
        terminalId: string;
        cwd?: string;
        label?: string;
      }) => void,
    ) => () => void;
    onTerminalOutput: (
      callback: (data: {
        agentId: string;
        sessionId: string;
        terminalId: string;
        data: string;
      }) => void,
    ) => () => void;
    onTerminalExit: (
      callback: (data: {
        agentId: string;
        sessionId: string;
        terminalId: string;
        exitCode?: number;
        signal?: string;
      }) => void,
    ) => () => void;

    // Feature 4: Commands update event
    onCommandsUpdate: (
      callback: (data: {
        agentId: string;
        sessionId: string;
        commands: Array<{
          id: string;
          name: string;
          description?: string;
          arguments?: Array<{
            name: string;
            description?: string;
            required?: boolean;
          }>;
        }>;
      }) => void,
    ) => () => void;

    // Feature 6: Session info update event
    onSessionInfoUpdate: (
      callback: (data: {
        agentId: string;
        sessionId: string;
        title?: string;
        meta?: Record<string, unknown>;
      }) => void,
    ) => () => void;

    // Session mode update event
    onSessionModeUpdate: (
      callback: (data: {
        agentId: string;
        sessionId: string;
        currentModeId?: string;
        availableModes?: Array<{ id: string; name: string }>;
      }) => void,
    ) => () => void;

    // Session model update event
    onSessionModelUpdate: (
      callback: (data: {
        agentId: string;
        sessionId: string;
        currentModelId?: string;
        availableModels?: Array<{ modelId: string; name: string }>;
      }) => void,
    ) => () => void;

    // Session config update event
    onSessionConfigUpdate: (
      callback: (data: {
        agentId: string;
        sessionId: string;
        configOptions?: Array<{
          id: string;
          name: string;
          type: string;
          value?: string | boolean;
        }>;
      }) => void,
    ) => () => void;
  };
}

// Expose protected methods that allow the renderer process to use
// ipcRenderer without exposing the entire object
const electronAPI: ElectronAPI = {
  platform:
    (typeof window !== "undefined" && window.electronPlatform) ||
    process.platform,

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
      authorize: (serverId: string) =>
        ipcRenderer.invoke("db:mcp:authorize", serverId),
      checkToken: (serverId: string) =>
        ipcRenderer.invoke("db:mcp:checkToken", serverId),
      finishOAuth: (data: { code: string; state: string }) =>
        ipcRenderer.invoke("db:mcp:finishOAuth", data),
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
    bookmark: {
      toggle: (
        userId: string,
        itemId: string,
        itemType: "agent" | "mcp",
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
      category?: "uploads" | "fragments" | "exports" | "workspace";
    }) => ipcRenderer.invoke("files:upload", data),
    download: (key: string) => ipcRenderer.invoke("files:download", key),
    delete: (key: string) => ipcRenderer.invoke("files:delete", key),
    exists: (key: string) => ipcRenderer.invoke("files:exists", key),
    getMetadata: (key: string) => ipcRenderer.invoke("files:getMetadata", key),
    getSourceUrl: (key: string) =>
      ipcRenderer.invoke("files:getSourceUrl", key),
    getDownloadUrl: (key: string) =>
      ipcRenderer.invoke("files:getDownloadUrl", key),
    listFiles: (category: "uploads" | "fragments" | "exports" | "workspace") =>
      ipcRenderer.invoke("files:listFiles", category),
    listWorkingDirectory: (options: {
      directoryPath: string;
      maxDepth?: number;
    }) => ipcRenderer.invoke("files:listWorkingDirectory", options),
    readTextFile: (options: {
      filePath: string;
      maxSize?: number;
    }) => ipcRenderer.invoke("files:readTextFile", options),
    clearCategory: (
      category: "uploads" | "fragments" | "exports" | "workspace",
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

  // Memory (semantic search over past conversations)
  memory: {
    search: (
      query: string,
      options?: {
        collections?: Array<"messages" | "documents" | "knowledge">;
        limit?: number;
        scoreThreshold?: number;
        userId?: string;
        threadId?: string;
      },
    ) => ipcRenderer.invoke("memory:search", query, options),
    index: (
      items: Array<{
        id?: string;
        content: string;
        threadId?: string;
        messageId?: string;
        userId: string;
        role?: string;
        collection?: "messages" | "documents" | "knowledge";
        metadata?: Record<string, unknown>;
      }>,
    ) => ipcRenderer.invoke("memory:index", items),
    delete: (ids: string[], collection?: "messages" | "documents") =>
      ipcRenderer.invoke("memory:delete", ids, collection),
    deleteByThread: (threadId: string) =>
      ipcRenderer.invoke("memory:deleteByThread", threadId),
    getStats: () => ipcRenderer.invoke("memory:getStats"),
    clearCache: () => ipcRenderer.invoke("memory:clearCache"),
    generateEmbedding: (text: string) =>
      ipcRenderer.invoke("memory:generateEmbedding", text),
  },

  // Knowledge Base & Document Management (Full RAG System)
  knowledge: {
    // Knowledge Base CRUD
    createBase: (data: {
      name: string;
      description?: string;
      userId: string;
    }) => ipcRenderer.invoke("knowledge:createBase", data),
    listBases: (userId: string) =>
      ipcRenderer.invoke("knowledge:listBases", userId),
    getBase: (id: string, userId: string) =>
      ipcRenderer.invoke("knowledge:getBase", id, userId),
    updateBase: (
      id: string,
      userId: string,
      data: { name?: string; description?: string },
    ) => ipcRenderer.invoke("knowledge:updateBase", id, userId, data),
    deleteBase: (id: string, userId: string) =>
      ipcRenderer.invoke("knowledge:deleteBase", id, userId),

    // Document Management
    selectFile: () => ipcRenderer.invoke("knowledge:selectFile"),
    uploadDocument: (data: {
      knowledgeBaseId: string;
      userId: string;
      filePath: string;
      fileName: string;
    }) => ipcRenderer.invoke("knowledge:uploadDocument", data),
    listDocuments: (knowledgeBaseId: string, userId: string) =>
      ipcRenderer.invoke("knowledge:listDocuments", knowledgeBaseId, userId),
    deleteDocument: (documentId: string, userId: string) =>
      ipcRenderer.invoke("knowledge:deleteDocument", documentId, userId),

    // Memory List
    listMemories: (params: {
      userId: string;
      page?: number;
      limit?: number;
      source?: "all" | "messages" | "documents" | "knowledge";
      search?: string;
    }) => ipcRenderer.invoke("knowledge:listMemories", params),

    // Statistics
    getStats: () => ipcRenderer.invoke("knowledge:getStats"),
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

  // Browser automation (agent-browser powered)
  browser: {
    // Session management
    createSession: (options) =>
      ipcRenderer.invoke("browser:createSession", options),
    closeSession: (sessionId) =>
      ipcRenderer.invoke("browser:closeSession", sessionId),
    listSessions: () => ipcRenderer.invoke("browser:listSessions"),
    switchSession: (sessionId) =>
      ipcRenderer.invoke("browser:switchSession", sessionId),

    // Navigation
    navigate: (url, options) =>
      ipcRenderer.invoke("browser:navigate", url, options),
    goBack: (sessionId) => ipcRenderer.invoke("browser:goBack", sessionId),
    goForward: (sessionId) =>
      ipcRenderer.invoke("browser:goForward", sessionId),
    reload: (sessionId) => ipcRenderer.invoke("browser:reload", sessionId),

    // AI-optimized snapshot
    getSnapshot: (options) =>
      ipcRenderer.invoke("browser:getSnapshot", options),

    // Actions
    click: (selector, options) =>
      ipcRenderer.invoke("browser:click", selector, options),
    fill: (selector, value, options) =>
      ipcRenderer.invoke("browser:fill", selector, value, options),
    type: (selector, text, options) =>
      ipcRenderer.invoke("browser:type", selector, text, options),
    press: (key, options) => ipcRenderer.invoke("browser:press", key, options),
    screenshot: (options) => ipcRenderer.invoke("browser:screenshot", options),
    scroll: (options) => ipcRenderer.invoke("browser:scroll", options),

    // Utilities
    evaluate: (script, options) =>
      ipcRenderer.invoke("browser:evaluate", script, options),
    wait: (options) => ipcRenderer.invoke("browser:wait", options),
    getContent: (options) => ipcRenderer.invoke("browser:getContent", options),
    getUrl: (sessionId) => ipcRenderer.invoke("browser:getUrl", sessionId),
    getTitle: (sessionId) => ipcRenderer.invoke("browser:getTitle", sessionId),

    // Multi-tab support
    newTab: (options) => ipcRenderer.invoke("browser:newTab", options),
    newWindow: (options) => ipcRenderer.invoke("browser:newWindow", options),
    switchTab: (index, sessionId) =>
      ipcRenderer.invoke("browser:switchTab", index, sessionId),
    closeTab: (options) => ipcRenderer.invoke("browser:closeTab", options),
    listTabs: (sessionId) => ipcRenderer.invoke("browser:listTabs", sessionId),
    getActiveTabIndex: (sessionId) =>
      ipcRenderer.invoke("browser:getActiveTabIndex", sessionId),

    // Additional actions
    hover: (selector, options) =>
      ipcRenderer.invoke("browser:hover", selector, options),
    select: (selector, values, options) =>
      ipcRenderer.invoke("browser:select", selector, values, options),
    check: (selector, options) =>
      ipcRenderer.invoke("browser:check", selector, options),
    uncheck: (selector, options) =>
      ipcRenderer.invoke("browser:uncheck", selector, options),
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

  // Auto-update API
  update: {
    check: () => ipcRenderer.invoke("update:check"),
    install: () => ipcRenderer.invoke("update:install"),
    getStatus: () => ipcRenderer.invoke("update:getStatus"),
    onAvailable: (
      callback: (data: {
        version: string;
        releaseNotes?: string;
        releaseDate?: string;
      }) => void,
    ) => {
      const handler = (_event: any, data: any) => callback(data);
      ipcRenderer.on("update:available", handler);
      return () => ipcRenderer.removeListener("update:available", handler);
    },
    onProgress: (
      callback: (data: {
        percent: number;
        transferred: number;
        total: number;
        bytesPerSecond: number;
      }) => void,
    ) => {
      const handler = (_event: any, data: any) => callback(data);
      ipcRenderer.on("update:progress", handler);
      return () => ipcRenderer.removeListener("update:progress", handler);
    },
    onDownloaded: (
      callback: (data: {
        version: string;
        releaseNotes?: string;
        releaseDate?: string;
      }) => void,
    ) => {
      const handler = (_event: any, data: any) => callback(data);
      ipcRenderer.on("update:downloaded", handler);
      return () => ipcRenderer.removeListener("update:downloaded", handler);
    },
    onError: (callback: (data: { message: string }) => void) => {
      const handler = (_event: any, data: any) => callback(data);
      ipcRenderer.on("update:error", handler);
      return () => ipcRenderer.removeListener("update:error", handler);
    },
    onUpToDate: (callback: (data: { version: string }) => void) => {
      const handler = (_event: any, data: any) => callback(data);
      ipcRenderer.on("update:upToDate", handler);
      return () => ipcRenderer.removeListener("update:upToDate", handler);
    },
  },

  // Dialog operations
  dialog: {
    openDirectory: (options?: {
      title?: string;
      defaultPath?: string;
      buttonLabel?: string;
    }) => ipcRenderer.invoke("dialog:openDirectory", options),
    openInFileManager: (directoryPath: string) =>
      ipcRenderer.invoke("dialog:openInFileManager", directoryPath),
    showInFileManager: (filePath: string) =>
      ipcRenderer.invoke("dialog:showInFileManager", filePath),
    openPath: (filePath: string) =>
      ipcRenderer.invoke("shell:openPath", filePath),
    saveFile: (options: {
      filename: string;
      content: string;
      defaultPath?: string;
      filters?: { name: string; extensions: string[] }[];
    }) => ipcRenderer.invoke("dialog:saveFile", options),
    writeToPath: (options: { filePath: string; content: string }) =>
      ipcRenderer.invoke("files:writeToPath", options),
    // File change listener for tracking changes in session
    onFileChanged: (
      callback: (data: {
        filePath: string;
        filename: string;
        status: "created" | "modified" | "deleted";
        originalContent: string | null;
        newContent: string;
        timestamp: number;
        threadId?: string;
      }) => void,
    ) => {
      const handler = (_event: any, data: any) => callback(data);
      ipcRenderer.on("file:changed", handler);
      return () => ipcRenderer.removeListener("file:changed", handler);
    },
  },

  // AI streaming (IPC-based, no HTTP server needed)
  // Uses two-phase approach: stream() prepares, startStream() begins
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
    startStream: (request: { threadId: string }) =>
      ipcRenderer.invoke("ai:stream:start", request),
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
    generateText: (request: {
      chatModel: { provider: string; model: string };
      system: string;
      prompt: string;
      maxTokens?: number;
    }) => ipcRenderer.invoke("ai:generateText", request),
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
    // PERFORMANCE: Batched chunk handler for faster streaming
    onStreamChunkBatch: (
      callback: (data: {
        threadId: string;
        chunks: any[];
      }) => void,
    ) => {
      const handler = (_event: any, data: any) => callback(data);
      ipcRenderer.on("ai:stream:chunk:batch", handler);
      return () => ipcRenderer.removeListener("ai:stream:chunk:batch", handler);
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
    onStreamStep: (
      callback: (data: {
        threadId: string;
        stepType: string;
        toolCallCount: number;
      }) => void,
    ) => {
      const handler = (_event: any, data: any) => callback(data);
      ipcRenderer.on("ai:stream:step", handler);
      return () => ipcRenderer.removeListener("ai:stream:step", handler);
    },
    onTitleGenerated: (
      callback: (data: { threadId: string; title: string }) => void,
    ) => {
      const handler = (_event: any, data: any) => callback(data);
      ipcRenderer.on("ai:title:generated", handler);
      return () => ipcRenderer.removeListener("ai:title:generated", handler);
    },
    onStreamWarning: (
      callback: (data: {
        threadId: string;
        message: string;
        type?: string;
      }) => void,
    ) => {
      const handler = (_event: any, data: any) => callback(data);
      ipcRenderer.on("ai:stream:warning", handler);
      return () => ipcRenderer.removeListener("ai:stream:warning", handler);
    },
    onThreadCreated: (
      callback: (data: { threadId: string; title: string }) => void,
    ) => {
      const handler = (_event: any, data: any) => callback(data);
      ipcRenderer.on("ai:thread:created", handler);
      return () => ipcRenderer.removeListener("ai:thread:created", handler);
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
    fetchProviderModels: (data: { providerId: string; apiKey: string }) =>
      ipcRenderer.invoke("models:fetchProviderModels", data),

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
      deleteFromProvider?: boolean;
    }) => ipcRenderer.invoke("models:deleteLocalModel", data),

    // Combined status
    getAvailableModels: () => ipcRenderer.invoke("models:getAvailableModels"),
    getStatus: () => ipcRenderer.invoke("models:getStatus"),

    // Ollama-specific
    ollamaIsInstalled: () => ipcRenderer.invoke("models:ollama:isInstalled"),
    ollamaCheckHealth: () => ipcRenderer.invoke("models:ollama:checkHealth"),
    ollamaTryStart: () => ipcRenderer.invoke("models:ollama:tryStart"),
    ollamaInstall: () => ipcRenderer.invoke("models:ollama:install"),
    ollamaGetModels: () => ipcRenderer.invoke("models:ollama:getModels"),
    ollamaShowModel: (data: { modelName: string }) =>
      ipcRenderer.invoke("models:ollama:showModel", data),
    ollamaGetLibraryModels: () =>
      ipcRenderer.invoke("models:ollama:getLibraryModels"),
    ollamaSearchLibrary: (data: { query: string }) =>
      ipcRenderer.invoke("models:ollama:searchLibrary", data),
    ollamaWarmup: (data: { modelName: string; baseUrl?: string }) =>
      ipcRenderer.invoke("models:ollama:warmup", data),
    ollamaUnload: (data: { modelName: string; baseUrl?: string }) =>
      ipcRenderer.invoke("models:ollama:unload", data),
    // Ollama auto-detection (zero-config support)
    ollamaAutoDetect: () => ipcRenderer.invoke("models:ollama:autoDetect"),
    ollamaStartAutoDetectPolling: (intervalMs?: number) =>
      ipcRenderer.invoke("models:ollama:startAutoDetectPolling", intervalMs),
    ollamaStopAutoDetectPolling: () =>
      ipcRenderer.invoke("models:ollama:stopAutoDetectPolling"),

    // LM Studio-specific
    lmstudioCheckHealth: () =>
      ipcRenderer.invoke("models:lmstudio:checkHealth"),
    lmstudioGetModels: () => ipcRenderer.invoke("models:lmstudio:getModels"),

    // Curated models
    getCuratedModels: () => ipcRenderer.invoke("models:getCuratedModels"),

    // Cancel download
    cancelDownload: (data: { modelId: string }) =>
      ipcRenderer.invoke("models:cancelDownload", data),

    // Event listeners
    onDownloadProgress: (callback) => {
      const handler = (_event: any, data: any) => callback(data);
      ipcRenderer.on("models:download:progress", handler);
      return () =>
        ipcRenderer.removeListener("models:download:progress", handler);
    },
    onDownloadComplete: (callback) => {
      const handler = (_event: any, data: any) => callback(data);
      ipcRenderer.on("models:download:complete", handler);
      return () =>
        ipcRenderer.removeListener("models:download:complete", handler);
    },
    onDownloadError: (callback) => {
      const handler = (_event: any, data: any) => callback(data);
      ipcRenderer.on("models:download:error", handler);
      return () => ipcRenderer.removeListener("models:download:error", handler);
    },
    onOllamaInstallProgress: (callback) => {
      const handler = (_event: any, data: any) => callback(data);
      ipcRenderer.on("models:ollama:install:progress", handler);
      return () =>
        ipcRenderer.removeListener("models:ollama:install:progress", handler);
    },
  },

  // Voice operations (OpenAI Realtime + Local STT/TTS)
  voice: {
    // OpenAI Realtime session creation
    createOpenAISession: (data: {
      model?: string;
      voice?: string;
      agentId?: string;
      mentions?: any[];
      instructions?: string;
      tools?: any[];
    }) => ipcRenderer.invoke("voice:createOpenAISession", data),

    // Local TTS (Text-to-Speech)
    synthesize: (data: { text: string; voice?: string; rate?: number }) =>
      ipcRenderer.invoke("voice:synthesize", data),

    // Get available TTS voices
    getAvailableVoices: () => ipcRenderer.invoke("voice:getAvailableVoices"),

    // Local STT (Speech-to-Text)
    transcribe: (data: { audio: string; language?: string }) =>
      ipcRenderer.invoke("voice:transcribe", data),
  },

  // ACP (Agent Client Protocol) - External coding agents
  acp: {
    // Agent management
    listAgents: (forceRefresh?: boolean) =>
      ipcRenderer.invoke("acp:list-agents", forceRefresh),
    getAgentStatus: (agentId: string) =>
      ipcRenderer.invoke("acp:get-agent-status", agentId),
    getInstalledAgents: () => ipcRenderer.invoke("acp:get-installed-agents"),
    startAgent: (agentId: string) =>
      ipcRenderer.invoke("acp:start-agent", agentId),
    stopAgent: (agentId: string) =>
      ipcRenderer.invoke("acp:stop-agent", agentId),

    // Session management
    createSession: (request: {
      agentId: string;
      workingDirectory?: string;
      mcpServers?: Array<{
        name: string;
        command: string;
        args?: string[];
        env?: Record<string, string>;
      }>;
    }) => ipcRenderer.invoke("acp:create-session", request),
    setSessionModel: (request: {
      agentId: string;
      sessionId: string;
      modelId: string;
    }) => ipcRenderer.invoke("acp:set-session-model", request),
    setSessionConfigOption: (request: {
      agentId: string;
      sessionId: string;
      configId: string;
      value: string;
    }) => ipcRenderer.invoke("acp:set-session-config", request),
    setSessionMode: (request: {
      agentId: string;
      sessionId: string;
      modeId: string;
    }) => ipcRenderer.invoke("acp:set-session-mode", request),

    // Prompting
    prompt: (request: {
      agentId: string;
      sessionId: string;
      message: string;
      contextFiles?: Array<{ path: string; content?: string }>;
    }) => ipcRenderer.invoke("acp:prompt", request),
    cancel: (agentId: string, sessionId: string) =>
      ipcRenderer.invoke("acp:cancel", agentId, sessionId),

    // Authentication
    authenticate: (agentId: string, methodId: string) =>
      ipcRenderer.invoke("acp:authenticate", agentId, methodId),

    // Permission handling
    respondPermission: (request: {
      requestId: string;
      optionId: string;
      rememberGlobally?: boolean;
    }) => ipcRenderer.invoke("acp:respond-permission", request),

    // Agentic loop controls - enables true autonomous agent behavior
    setAutoResume: (agentId: string, sessionId: string, enabled: boolean) =>
      ipcRenderer.invoke("acp:set-auto-resume", agentId, sessionId, enabled),
    getAgenticLoopStatus: (agentId: string, sessionId: string) =>
      ipcRenderer.invoke("acp:get-agentic-loop-status", agentId, sessionId),

    // Session context update - allows updating working directory
    updateSessionContext: (
      agentId: string,
      sessionId: string,
      context: { workingDirectory?: string },
    ) =>
      ipcRenderer.invoke(
        "acp:update-session-context",
        agentId,
        sessionId,
        context,
      ),

    // Feature 2: Session list/load/resume and capabilities
    getAgentCapabilities: (agentId: string) =>
      ipcRenderer.invoke("acp:get-agent-capabilities", agentId),
    listSessions: (
      agentId: string,
      request?: {
        cwd?: string;
        cursor?: string;
      },
    ) => ipcRenderer.invoke("acp:list-sessions", agentId, request),
    loadSession: (request: {
      agentId: string;
      sessionId: string;
      workingDirectory: string;
      mcpServers?: Array<{
        name: string;
        command: string;
        args?: string[];
        env?: Record<string, string>;
      }>;
    }) => ipcRenderer.invoke("acp:load-session", request),
    resumeSession: (request: {
      agentId: string;
      sessionId: string;
      workingDirectory: string;
      mcpServers?: Array<{
        name: string;
        command: string;
        args?: string[];
        env?: Record<string, string>;
      }>;
    }) => ipcRenderer.invoke("acp:resume-session", request),

    // Event listeners
    onAgentStarted: (callback: (data: { agentId: string }) => void) => {
      const handler = (_event: any, data: any) => callback(data);
      ipcRenderer.on("acp:agent-started", handler);
      return () => ipcRenderer.removeListener("acp:agent-started", handler);
    },
    onAgentExit: (
      callback: (data: { agentId: string; code: number | null }) => void,
    ) => {
      const handler = (_event: any, data: any) => callback(data);
      ipcRenderer.on("acp:agent-exit", handler);
      return () => ipcRenderer.removeListener("acp:agent-exit", handler);
    },
    onAgentError: (
      callback: (data: { agentId: string; error: string }) => void,
    ) => {
      const handler = (_event: any, data: any) => callback(data);
      ipcRenderer.on("acp:agent-error", handler);
      return () => ipcRenderer.removeListener("acp:agent-error", handler);
    },
    onAgentAuthenticated: (callback: (data: { agentId: string }) => void) => {
      const handler = (_event: any, data: any) => callback(data);
      ipcRenderer.on("acp:agent-authenticated", handler);
      return () =>
        ipcRenderer.removeListener("acp:agent-authenticated", handler);
    },
    onAuthRequired: (
      callback: (data: {
        agentId: string;
        methods: Array<{ id: string; name: string; description?: string }>;
      }) => void,
    ) => {
      const handler = (_event: any, data: any) => callback(data);
      ipcRenderer.on("acp:auth-required", handler);
      return () => ipcRenderer.removeListener("acp:auth-required", handler);
    },
    onSessionCreated: (
      callback: (data: {
        agentId: string;
        session: {
          sessionId: string;
          agentId: string;
          workingDirectory?: string;
          createdAt: Date;
          availableModes?: string[];
          currentMode?: string;
          configOptions?: Array<any>;
          models?: any;
        };
      }) => void,
    ) => {
      const handler = (_event: any, data: any) => callback(data);
      ipcRenderer.on("acp:session-created", handler);
      return () => ipcRenderer.removeListener("acp:session-created", handler);
    },
    onSessionUpdate: (
      callback: (data: {
        agentId: string;
        sessionId: string;
        status: "active" | "idle" | "error";
      }) => void,
    ) => {
      const handler = (_event: any, data: any) => callback(data);
      ipcRenderer.on("acp:session-update", handler);
      return () => ipcRenderer.removeListener("acp:session-update", handler);
    },
    onMessageChunk: (
      callback: (data: {
        sessionId: string;
        agentId: string;
        messageId: string;
        type: "text" | "thinking" | "tool_call" | "tool_result" | "error";
        content:
          | string
          | {
              id?: string;
              name?: string;
              input?: unknown;
              output?: unknown;
              state?: string;
            };
        role?: "user" | "assistant";
        done?: boolean;
      }) => void,
    ) => {
      const handler = (_event: any, data: any) => {
        console.log(
          "[Preload] ACP message-chunk received:",
          JSON.stringify(data, null, 2),
        );
        callback(data);
      };
      ipcRenderer.on("acp:message-chunk", handler);
      return () => ipcRenderer.removeListener("acp:message-chunk", handler);
    },
    onPermissionRequest: (
      callback: (data: {
        agentId: string;
        sessionId: string;
        requestId: string;
        title: string;
        description?: string;
        options: Array<{
          id: string;
          label: string;
          description?: string;
          isDefault?: boolean;
        }>;
        metadata?: Record<string, unknown>;
      }) => void,
    ) => {
      const handler = (_event: any, data: any) => callback(data);
      ipcRenderer.on("acp:permission-request", handler);
      return () =>
        ipcRenderer.removeListener("acp:permission-request", handler);
    },

    // Feature 2: Session load/resume events
    onSessionLoaded: (
      callback: (data: {
        sessionId: string;
        agentId: string;
        workingDirectory: string;
      }) => void,
    ) => {
      const handler = (_event: any, data: any) => callback(data);
      ipcRenderer.on("acp:session-loaded", handler);
      return () => ipcRenderer.removeListener("acp:session-loaded", handler);
    },
    onSessionResumed: (
      callback: (data: {
        sessionId: string;
        agentId: string;
        workingDirectory: string;
      }) => void,
    ) => {
      const handler = (_event: any, data: any) => callback(data);
      ipcRenderer.on("acp:session-resumed", handler);
      return () => ipcRenderer.removeListener("acp:session-resumed", handler);
    },
    onSessionRecreated: (
      callback: (data: {
        agentId: string;
        oldSessionId: string;
        newSession: {
          sessionId: string;
          agentId: string;
          workingDirectory: string;
        };
      }) => void,
    ) => {
      const handler = (_event: any, data: any) => callback(data);
      ipcRenderer.on("acp:session-recreated", handler);
      return () => ipcRenderer.removeListener("acp:session-recreated", handler);
    },
    onSessionContextUpdated: (
      callback: (data: {
        agentId: string;
        sessionId: string;
        workingDirectory?: string;
      }) => void,
    ) => {
      const handler = (_event: any, data: any) => callback(data);
      ipcRenderer.on("acp:session-context-updated", handler);
      return () =>
        ipcRenderer.removeListener("acp:session-context-updated", handler);
    },

    // Feature 3: Terminal events
    onTerminalCreated: (
      callback: (data: {
        agentId: string;
        sessionId: string;
        terminalId: string;
        cwd?: string;
        label?: string;
      }) => void,
    ) => {
      const handler = (_event: any, data: any) => callback(data);
      ipcRenderer.on("acp:terminal-created", handler);
      return () => ipcRenderer.removeListener("acp:terminal-created", handler);
    },
    onTerminalOutput: (
      callback: (data: {
        agentId: string;
        sessionId: string;
        terminalId: string;
        data: string;
      }) => void,
    ) => {
      const handler = (_event: any, data: any) => callback(data);
      ipcRenderer.on("acp:terminal-output", handler);
      return () => ipcRenderer.removeListener("acp:terminal-output", handler);
    },
    onTerminalExit: (
      callback: (data: {
        agentId: string;
        sessionId: string;
        terminalId: string;
        exitCode?: number;
        signal?: string;
      }) => void,
    ) => {
      const handler = (_event: any, data: any) => callback(data);
      ipcRenderer.on("acp:terminal-exit", handler);
      return () => ipcRenderer.removeListener("acp:terminal-exit", handler);
    },

    // Feature 4: Commands update event
    onCommandsUpdate: (
      callback: (data: {
        agentId: string;
        sessionId: string;
        commands: Array<{
          id: string;
          name: string;
          description?: string;
          arguments?: Array<{
            name: string;
            description?: string;
            required?: boolean;
          }>;
        }>;
      }) => void,
    ) => {
      const handler = (_event: any, data: any) => callback(data);
      ipcRenderer.on("acp:commands-update", handler);
      return () => ipcRenderer.removeListener("acp:commands-update", handler);
    },

    // Feature 6: Session info update event
    onSessionInfoUpdate: (
      callback: (data: {
        agentId: string;
        sessionId: string;
        title?: string;
        meta?: Record<string, unknown>;
      }) => void,
    ) => {
      const handler = (_event: any, data: any) => callback(data);
      ipcRenderer.on("acp:session-info-update", handler);
      return () =>
        ipcRenderer.removeListener("acp:session-info-update", handler);
    },

    // Session mode update event
    onSessionModeUpdate: (
      callback: (data: {
        agentId: string;
        sessionId: string;
        currentModeId?: string;
        availableModes?: Array<{ id: string; name: string }>;
      }) => void,
    ) => {
      const handler = (_event: any, data: any) => callback(data);
      ipcRenderer.on("acp:session-mode-update", handler);
      return () =>
        ipcRenderer.removeListener("acp:session-mode-update", handler);
    },

    // Session model update event
    onSessionModelUpdate: (
      callback: (data: {
        agentId: string;
        sessionId: string;
        currentModelId?: string;
        availableModels?: Array<{ modelId: string; name: string }>;
      }) => void,
    ) => {
      const handler = (_event: any, data: any) => callback(data);
      ipcRenderer.on("acp:session-model-update", handler);
      return () =>
        ipcRenderer.removeListener("acp:session-model-update", handler);
    },

    // Session config update event
    onSessionConfigUpdate: (
      callback: (data: {
        agentId: string;
        sessionId: string;
        configOptions?: Array<{
          id: string;
          name: string;
          type: string;
          value?: string | boolean;
        }>;
      }) => void,
    ) => {
      const handler = (_event: any, data: any) => callback(data);
      ipcRenderer.on("acp:session-config-update", handler);
      return () =>
        ipcRenderer.removeListener("acp:session-config-update", handler);
    },

    // =========================================================================
    // AUTO-DETECTION (Zero-Config Agent Support)
    // =========================================================================

    // Force refresh agent detection - useful after installing a new agent
    autoDetect: () => ipcRenderer.invoke("acp:auto-detect"),

    // Start background polling for agent detection
    startAutoDetectPolling: (intervalMs?: number) =>
      ipcRenderer.invoke("acp:start-auto-detect-polling", intervalMs),

    // Stop background polling for agent detection
    stopAutoDetectPolling: () => ipcRenderer.invoke("acp:stop-auto-detect-polling"),

    // Subscribe to agents detected event (emitted at startup)
    onAgentsDetected: (
      callback: (data: {
        agents: Array<{
          id: string;
          installed: boolean;
          authenticated: boolean;
          running: boolean;
          version?: string;
        }>;
        timestamp: number;
      }) => void,
    ) => {
      const handler = (_event: any, data: any) => callback(data);
      ipcRenderer.on("acp:agents-detected", handler);
      return () => ipcRenderer.removeListener("acp:agents-detected", handler);
    },

    // Subscribe to agents updated event (emitted during polling)
    onAgentsUpdated: (
      callback: (data: {
        agents: Array<{
          id: string;
          installed: boolean;
          authenticated: boolean;
          running: boolean;
          version?: string;
        }>;
        timestamp: number;
      }) => void,
    ) => {
      const handler = (_event: any, data: any) => callback(data);
      ipcRenderer.on("acp:agents-updated", handler);
      return () => ipcRenderer.removeListener("acp:agents-updated", handler);
    },
  },
};

// Use contextBridge to expose the API to the renderer process
contextBridge.exposeInMainWorld("electronAPI", electronAPI);

// Expose platform info separately (Vite handles process.env in dev mode)
contextBridge.exposeInMainWorld("electronPlatform", process.platform);

// TypeScript declaration for global window object
declare global {
  interface Window {
    electronAPI: ElectronAPI;
    electronPlatform: NodeJS.Platform;
  }
}
