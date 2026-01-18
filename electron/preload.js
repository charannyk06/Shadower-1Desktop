"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
// Expose protected methods that allow the renderer process to use
// ipcRenderer without exposing the entire object
const electronAPI = {
    platform: process.platform,
    // Database operations - IPC handlers to be implemented
    db: {
        chat: {
            getThreads: (userId) => electron_1.ipcRenderer.invoke('db:chat:getThreads', userId),
            getMessages: (threadId) => electron_1.ipcRenderer.invoke('db:chat:getMessages', threadId),
            createThread: (data) => electron_1.ipcRenderer.invoke('db:chat:createThread', data),
            createMessage: (data) => electron_1.ipcRenderer.invoke('db:chat:createMessage', data),
            updateThread: (id, data) => electron_1.ipcRenderer.invoke('db:chat:updateThread', id, data),
            deleteThread: (id) => electron_1.ipcRenderer.invoke('db:chat:deleteThread', id),
        },
        agents: {
            getAll: (userId) => electron_1.ipcRenderer.invoke('db:agents:getAll', userId),
            getById: (id) => electron_1.ipcRenderer.invoke('db:agents:getById', id),
            create: (data) => electron_1.ipcRenderer.invoke('db:agents:create', data),
            update: (id, data) => electron_1.ipcRenderer.invoke('db:agents:update', id, data),
            delete: (id) => electron_1.ipcRenderer.invoke('db:agents:delete', id),
        },
        workflows: {
            getAll: (userId) => electron_1.ipcRenderer.invoke('db:workflows:getAll', userId),
            getById: (id) => electron_1.ipcRenderer.invoke('db:workflows:getById', id),
            create: (data) => electron_1.ipcRenderer.invoke('db:workflows:create', data),
            update: (id, data) => electron_1.ipcRenderer.invoke('db:workflows:update', id, data),
            delete: (id) => electron_1.ipcRenderer.invoke('db:workflows:delete', id),
        },
        mcp: {
            getServers: () => electron_1.ipcRenderer.invoke('db:mcp:getServers'),
            saveServer: (data) => electron_1.ipcRenderer.invoke('db:mcp:saveServer', data),
            deleteServer: (id) => electron_1.ipcRenderer.invoke('db:mcp:deleteServer', id),
        },
        user: {
            getPreferences: () => electron_1.ipcRenderer.invoke('db:user:getPreferences'),
            updatePreferences: (data) => electron_1.ipcRenderer.invoke('db:user:updatePreferences', data),
        },
    },
    // File operations
    files: {
        upload: (buffer, filename) => electron_1.ipcRenderer.invoke('files:upload', buffer, filename),
        download: (path) => electron_1.ipcRenderer.invoke('files:download', path),
        delete: (path) => electron_1.ipcRenderer.invoke('files:delete', path),
        list: (directory) => electron_1.ipcRenderer.invoke('files:list', directory),
    },
    // Vector search
    vector: {
        search: (query, options) => electron_1.ipcRenderer.invoke('vector:search', query, options),
        insert: (documents) => electron_1.ipcRenderer.invoke('vector:insert', documents),
        delete: (ids) => electron_1.ipcRenderer.invoke('vector:delete', ids),
    },
    // Embeddings
    embeddings: {
        generate: (texts) => electron_1.ipcRenderer.invoke('embeddings:generate', texts),
    },
    // RAG
    rag: {
        query: (query, options) => electron_1.ipcRenderer.invoke('rag:query', query, options),
    },
    // Graph memory
    graph: {
        extractEntities: (document) => electron_1.ipcRenderer.invoke('graph:extractEntities', document),
        search: (entityId, options) => electron_1.ipcRenderer.invoke('graph:search', entityId, options),
        query: (naturalLanguageQuery) => electron_1.ipcRenderer.invoke('graph:query', naturalLanguageQuery),
    },
    // Sandbox
    sandbox: {
        executeCode: (code, language) => electron_1.ipcRenderer.invoke('sandbox:execute', code, language),
        getFiles: (threadId) => electron_1.ipcRenderer.invoke('sandbox:getFiles', threadId),
    },
    // Chrome automation
    chrome: {
        connect: (port) => electron_1.ipcRenderer.invoke('chrome:connect', port),
        navigate: (url) => electron_1.ipcRenderer.invoke('chrome:navigate', url),
        screenshot: () => electron_1.ipcRenderer.invoke('chrome:screenshot'),
        evaluate: (script) => electron_1.ipcRenderer.invoke('chrome:evaluate', script),
    },
    // App utilities
    app: {
        getVersion: () => electron_1.ipcRenderer.invoke('app:getVersion'),
        getPath: (name) => electron_1.ipcRenderer.invoke('app:getPath', name),
        quit: () => electron_1.ipcRenderer.send('app:quit'),
    },
};
// Use contextBridge to expose the API to the renderer process
electron_1.contextBridge.exposeInMainWorld('electronAPI', electronAPI);
// Also expose Node.js process information (read-only)
electron_1.contextBridge.exposeInMainWorld('process', {
    platform: process.platform,
    env: {
        NODE_ENV: process.env.NODE_ENV,
    },
});
//# sourceMappingURL=preload.js.map