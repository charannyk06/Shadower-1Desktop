import { createHash } from "crypto";

export const CacheKeys = {
  thread: (threadId: string) => `thread-${threadId}`,
  user: (userId: string) => `user-${userId}`,
  mcpServerCustomizations: (userId: string) =>
    `mcp-server-customizations-${userId}`,
  agentInstructions: (agent: string) => `agent-instructions-${agent}`,
  dynamicModels: (provider: string) => `dynamic-models:${provider}`,
  allProviderModels: () => `dynamic-models:all-providers`,
  embedding: (text: string) => {
    // Use hash of text for cache key (texts can be long)
    const hash = createHash("sha256").update(text).digest("hex");
    return `embedding:${hash}`;
  },
};
