import {
  getAllProviderModels,
  transformToAPIResponse,
} from "lib/ai/dynamic-models";

export const GET = async () => {
  const providerModels = await getAllProviderModels();

  // Filter to only include providers with API keys (or local providers with models)
  const filtered = providerModels.filter((p) => {
    // Local providers (ollama, lmstudio) don't need API keys - include if they have models
    if (p.provider === "ollama" || p.provider === "lmstudio") {
      return p.models && p.models.length > 0;
    }
    // Cloud providers must have API keys
    return p.hasAPIKey === true;
  });

  const response = transformToAPIResponse(filtered);

  return Response.json(response);
};
