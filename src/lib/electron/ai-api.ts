/**
 * Electron AI API for Desktop
 *
 * This module provides client-side wrappers for AI operations via IPC.
 */

import { ChatModel } from "app-types/chat";

/**
 * Check if we're running in Electron mode with AI support
 */
export function isElectronMode(): boolean {
  return (
    typeof window !== "undefined" &&
    window.electronAPI !== undefined &&
    window.electronAPI.ai !== undefined
  );
}

/**
 * AI API for Electron
 */
export const aiApi = {
  /**
   * Generate a structured object using AI
   * Used for AI-powered schema and input generation
   */
  async generateObject<T = any>(params: {
    model: ChatModel;
    prompt: {
      system?: string;
      user?: string;
    };
    schema: any; // JSON Schema
  }): Promise<T> {
    if (!isElectronMode()) {
      throw new Error("Not in Electron mode");
    }

    const result = await window.electronAPI.ai.generateObject({
      chatModel: {
        provider: params.model.provider,
        model: params.model.model,
      },
      prompt: params.prompt,
      schema: params.schema,
    });

    if (result.error) {
      throw new Error(result.error);
    }

    return result.object as T;
  },

  /**
   * Generate a title for a chat thread
   */
  async generateTitle(params: {
    threadId: string;
    message: string;
    model: ChatModel;
  }): Promise<string> {
    if (!isElectronMode()) {
      throw new Error("Not in Electron mode");
    }

    const result = await window.electronAPI.ai.generateTitle({
      threadId: params.threadId,
      message: params.message,
      chatModel: {
        provider: params.model.provider,
        model: params.model.model,
      },
    });

    if (result.error) {
      throw new Error(result.error);
    }

    return result.title || "Untitled Chat";
  },

  /**
   * Generate text using AI (for inline text enhancement)
   */
  async generateText(params: {
    model: ChatModel;
    system: string;
    prompt: string;
    maxTokens?: number;
  }): Promise<string> {
    if (!isElectronMode()) {
      throw new Error("Not in Electron mode");
    }

    const result = await window.electronAPI.ai.generateText({
      chatModel: {
        provider: params.model.provider,
        model: params.model.model,
      },
      system: params.system,
      prompt: params.prompt,
      maxTokens: params.maxTokens,
    });

    if (result.error) {
      throw new Error(result.error);
    }

    return result.text || "";
  },
};

export default aiApi;
