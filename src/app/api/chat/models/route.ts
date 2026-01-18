import {
  getAllProviderModels,
  transformToAPIResponse,
} from "lib/ai/dynamic-models";

export const GET = async () => {
  const providerModels = await getAllProviderModels();
  const response = transformToAPIResponse(providerModels);

  return Response.json(response);
};
