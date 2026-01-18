import { getComposioRouteContext } from "@/app/api/composio/utils";
import { z } from "zod";

const createIntegrationSchema = z.object({
  appName: z.string(),
  clientId: z.string(),
  clientSecret: z.string(),
  scopes: z.array(z.string()).optional(),
});

export async function POST(request: Request) {
  const ctx = await getComposioRouteContext({
    requireAdmin: true,
    errorOnDisabled: true,
  });
  if (!ctx.success) return ctx.response;

  try {
    const body = await request.json();
    const { appName, clientId, clientSecret, scopes } =
      createIntegrationSchema.parse(body);

    const result = await ctx.client.createCustomIntegration(
      appName,
      clientId,
      clientSecret,
      scopes,
    );

    return Response.json({ success: true, integrationId: result.id });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json(
        { error: "Invalid request body", details: error.issues },
        { status: 400 },
      );
    }

    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    return Response.json({ error: errorMessage }, { status: 500 });
  }
}

export async function GET() {
  const ctx = await getComposioRouteContext({
    requireAdmin: true,
    errorOnDisabled: true,
  });
  if (!ctx.success) return ctx.response;

  try {
    const integrations = await ctx.client.getIntegrations();
    return Response.json({ items: integrations });
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    return Response.json({ error: errorMessage }, { status: 500 });
  }
}
