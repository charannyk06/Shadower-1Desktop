import { appStore } from "@/app/store";
import { modelsFetcher } from "@/lib/electron/models-api";
import useSWR, { SWRConfiguration } from "swr";

/**
 * Model information with capability fields for client-side validation
 */
interface ChatModelInfo {
  name: string;
  displayName: string;
  isToolCallUnsupported: boolean;
  isImageInputUnsupported: boolean;
  supportedFileMimeTypes: string[];
  // New capability fields
  isReasoningModel: boolean;
  workflowGenerationSupport: "full" | "limited" | "none";
  toolCallUnsupportedReason?:
    | "reasoning-model"
    | "built-in-tools"
    | "responses-api-only";
  reasoningEffort?: string[];
  thinkingLevel?: string[];
  // ACP Agent-specific fields
  isACPAgent?: boolean;
  acpProvider?: "anthropic" | "openai" | "google";
  acpAuthenticated?: boolean;
  acpRunning?: boolean;
}

/**
 * Provider models response
 */
interface ProviderModels {
  provider: string;
  hasAPIKey: boolean;
  models: ChatModelInfo[];
}

export const useChatModels = (options?: SWRConfiguration) => {
  return useSWR<ProviderModels[]>("/api/chat/models", modelsFetcher, {
    // Reduced from 5 minutes to 10 seconds to allow faster updates when models change
    dedupingInterval: 10_000,
    revalidateOnFocus: true,
    fallbackData: [],
    onSuccess: (data) => {
      if (data && data.length > 0) {
        // Find the first provider with an API key and models
        const availableProvider = data.find(
          (p) => p.hasAPIKey && p.models && p.models.length > 0,
        );

        if (availableProvider) {
          const status = appStore.getState();
          const currentModel = status.chatModel;

          // Check if current model is still valid
          const isValidModel = currentModel
            ? data.some(
                (p) =>
                  p.provider === currentModel.provider &&
                  p.models.some((m) => m.name === currentModel.model) &&
                  p.hasAPIKey,
              )
            : false;

          // Set default model if none is set or current model is invalid
          if (!currentModel || !isValidModel) {
            appStore.setState({
              chatModel: {
                provider: availableProvider.provider,
                model: availableProvider.models[0].name,
              },
            });
          }
        } else {
          // No models with API keys available - clear the model
          appStore.setState({ chatModel: undefined });
        }
      } else {
        // No models available at all - clear the model
        appStore.setState({ chatModel: undefined });
      }
    },
    ...options,
  });
};
