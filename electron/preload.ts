import { contextBridge, ipcRenderer } from "electron";

// Type definitions for the Electron API
export interface ElectronAPI {
  // Platform information
  platform: NodeJS.Platform;

  // Authentication operations
  auth: {
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
      getMessages: (threadId: string) => Promise<any[]>;
      createThread: (data: any) => Promise<any>;
      createMessage: (data: any) => Promise<any>;
      updateThread: (id: string, data: any) => Promise<void>;
      deleteThread: (id: string) => Promise<void>;
    };
    agents: {
      getAll: (userId: string) => Promise<any[]>;
      getById: (id: string) => Promise<any>;
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
    };
    mcp: {
      getServers: () => Promise<any[]>;
      saveServer: (data: any) => Promise<any>;
      deleteServer: (id: string) => Promise<void>;
      getToolCustomizations: (serverId: string) => Promise<any[]>;
      saveToolCustomization: (data: any) => Promise<any>;
    };
    user: {
      getPreferences: () => Promise<any>;
      updatePreferences: (data: any) => Promise<void>;
      getCurrent: () => Promise<any>;
      updateProfile: (data: any) => Promise<any>;
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
    execute: (
      command: string,
    ) => Promise<{ stdout: string; stderr: string; exitCode: number }>;
    screenshot: () => Promise<Buffer>;
    click: (x: number, y: number) => Promise<void>;
    type: (text: string) => Promise<void>;
    keyPress: (key: string) => Promise<void>;
  };

  // App utilities
  app: {
    getVersion: () => Promise<string>;
    getPath: (name: string) => Promise<string>;
    quit: () => void;
  };
}

// Expose protected methods that allow the renderer process to use
// ipcRenderer without exposing the entire object
const electronAPI: ElectronAPI = {
  platform: process.platform,

  // Authentication operations
  auth: {
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
    },
    mcp: {
      getServers: () => ipcRenderer.invoke("db:mcp:getServers"),
      saveServer: (data: any) => ipcRenderer.invoke("db:mcp:saveServer", data),
      deleteServer: (id: string) =>
        ipcRenderer.invoke("db:mcp:deleteServer", id),
      getToolCustomizations: (serverId: string) =>
        ipcRenderer.invoke("db:mcp:getToolCustomizations", serverId),
      saveToolCustomization: (data: any) =>
        ipcRenderer.invoke("db:mcp:saveToolCustomization", data),
    },
    user: {
      getPreferences: () => ipcRenderer.invoke("db:user:getPreferences"),
      updatePreferences: (data: any) =>
        ipcRenderer.invoke("db:user:updatePreferences", data),
      getCurrent: () => ipcRenderer.invoke("db:user:getCurrent"),
      updateProfile: (data: any) =>
        ipcRenderer.invoke("db:user:updateProfile", data),
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
    execute: (command: string) =>
      ipcRenderer.invoke("terminal:execute", command),
    screenshot: () => ipcRenderer.invoke("terminal:screenshot"),
    click: (x: number, y: number) => ipcRenderer.invoke("terminal:click", x, y),
    type: (text: string) => ipcRenderer.invoke("terminal:type", text),
    keyPress: (key: string) => ipcRenderer.invoke("terminal:keyPress", key),
  },

  // App utilities
  app: {
    getVersion: () => ipcRenderer.invoke("app:getVersion"),
    getPath: (name: string) => ipcRenderer.invoke("app:getPath", name),
    quit: () => ipcRenderer.send("app:quit"),
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
