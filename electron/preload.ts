import { contextBridge, ipcRenderer } from 'electron';

// Type definitions for the Electron API
export interface ElectronAPI {
  // Platform information
  platform: NodeJS.Platform;

  // Database operations (to be implemented in Phase 2)
  db: {
    chat: {
      getThreads: (userId: string) => Promise<any[]>;
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
      update: (id: string, data: any) => Promise<void>;
      delete: (id: string) => Promise<void>;
    };
    workflows: {
      getAll: (userId: string) => Promise<any[]>;
      getById: (id: string) => Promise<any>;
      create: (data: any) => Promise<any>;
      update: (id: string, data: any) => Promise<void>;
      delete: (id: string) => Promise<void>;
    };
    mcp: {
      getServers: () => Promise<any[]>;
      saveServer: (data: any) => Promise<void>;
      deleteServer: (id: string) => Promise<void>;
    };
    user: {
      getPreferences: () => Promise<any>;
      updatePreferences: (data: any) => Promise<void>;
    };
  };

  // File operations (to be implemented in Phase 3)
  files: {
    upload: (buffer: Buffer, filename: string) => Promise<{ path: string; url: string }>;
    download: (path: string) => Promise<Buffer>;
    delete: (path: string) => Promise<void>;
    list: (directory: string) => Promise<string[]>;
  };

  // Vector search operations (to be implemented in Phase 2.5)
  vector: {
    search: (query: number[], options: any) => Promise<any[]>;
    insert: (documents: any[]) => Promise<void>;
    delete: (ids: string[]) => Promise<void>;
  };

  // Embedding generation (to be implemented in Phase 2.5)
  embeddings: {
    generate: (texts: string[]) => Promise<number[][]>;
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

  // Database operations - IPC handlers to be implemented
  db: {
    chat: {
      getThreads: (userId: string) => ipcRenderer.invoke('db:chat:getThreads', userId),
      getMessages: (threadId: string) => ipcRenderer.invoke('db:chat:getMessages', threadId),
      createThread: (data: any) => ipcRenderer.invoke('db:chat:createThread', data),
      createMessage: (data: any) => ipcRenderer.invoke('db:chat:createMessage', data),
      updateThread: (id: string, data: any) => ipcRenderer.invoke('db:chat:updateThread', id, data),
      deleteThread: (id: string) => ipcRenderer.invoke('db:chat:deleteThread', id),
    },
    agents: {
      getAll: (userId: string) => ipcRenderer.invoke('db:agents:getAll', userId),
      getById: (id: string) => ipcRenderer.invoke('db:agents:getById', id),
      create: (data: any) => ipcRenderer.invoke('db:agents:create', data),
      update: (id: string, data: any) => ipcRenderer.invoke('db:agents:update', id, data),
      delete: (id: string) => ipcRenderer.invoke('db:agents:delete', id),
    },
    workflows: {
      getAll: (userId: string) => ipcRenderer.invoke('db:workflows:getAll', userId),
      getById: (id: string) => ipcRenderer.invoke('db:workflows:getById', id),
      create: (data: any) => ipcRenderer.invoke('db:workflows:create', data),
      update: (id: string, data: any) => ipcRenderer.invoke('db:workflows:update', id, data),
      delete: (id: string) => ipcRenderer.invoke('db:workflows:delete', id),
    },
    mcp: {
      getServers: () => ipcRenderer.invoke('db:mcp:getServers'),
      saveServer: (data: any) => ipcRenderer.invoke('db:mcp:saveServer', data),
      deleteServer: (id: string) => ipcRenderer.invoke('db:mcp:deleteServer', id),
    },
    user: {
      getPreferences: () => ipcRenderer.invoke('db:user:getPreferences'),
      updatePreferences: (data: any) => ipcRenderer.invoke('db:user:updatePreferences', data),
    },
  },

  // File operations
  files: {
    upload: (buffer: Buffer, filename: string) =>
      ipcRenderer.invoke('files:upload', buffer, filename),
    download: (path: string) => ipcRenderer.invoke('files:download', path),
    delete: (path: string) => ipcRenderer.invoke('files:delete', path),
    list: (directory: string) => ipcRenderer.invoke('files:list', directory),
  },

  // Vector search
  vector: {
    search: (query: number[], options: any) =>
      ipcRenderer.invoke('vector:search', query, options),
    insert: (documents: any[]) => ipcRenderer.invoke('vector:insert', documents),
    delete: (ids: string[]) => ipcRenderer.invoke('vector:delete', ids),
  },

  // Embeddings
  embeddings: {
    generate: (texts: string[]) => ipcRenderer.invoke('embeddings:generate', texts),
  },

  // RAG
  rag: {
    query: (query: string, options: any) => ipcRenderer.invoke('rag:query', query, options),
  },

  // Graph memory
  graph: {
    extractEntities: (document: any) => ipcRenderer.invoke('graph:extractEntities', document),
    search: (entityId: string, options: any) =>
      ipcRenderer.invoke('graph:search', entityId, options),
    query: (naturalLanguageQuery: string) =>
      ipcRenderer.invoke('graph:query', naturalLanguageQuery),
  },

  // Sandbox
  sandbox: {
    executeCode: (code: string, language: string) =>
      ipcRenderer.invoke('sandbox:execute', code, language),
    getFiles: (threadId: string) => ipcRenderer.invoke('sandbox:getFiles', threadId),
  },

  // Chrome automation
  chrome: {
    connect: (port: number) => ipcRenderer.invoke('chrome:connect', port),
    navigate: (url: string) => ipcRenderer.invoke('chrome:navigate', url),
    screenshot: () => ipcRenderer.invoke('chrome:screenshot'),
    evaluate: (script: string) => ipcRenderer.invoke('chrome:evaluate', script),
  },

  // App utilities
  app: {
    getVersion: () => ipcRenderer.invoke('app:getVersion'),
    getPath: (name: string) => ipcRenderer.invoke('app:getPath', name),
    quit: () => ipcRenderer.send('app:quit'),
  },
};

// Use contextBridge to expose the API to the renderer process
contextBridge.exposeInMainWorld('electronAPI', electronAPI);

// Also expose Node.js process information (read-only)
contextBridge.exposeInMainWorld('process', {
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
