import { getComposioRouteContext } from "../utils";

export async function GET() {
  const ctx = await getComposioRouteContext();
  if (!ctx.success) return ctx.response;

  const { client } = ctx;

  // Get all apps - we'll handle missing integrations in the connect flow
  const apps = await client.getApps();

  // Also get which apps have integrations ready
  const appsWithIntegrations = await client.getAppsWithIntegrationsSet();

  // Mark apps that have integrations ready
  const appsWithReadyStatus = apps.map((app) => ({
    ...app,
    hasIntegration: appsWithIntegrations.has(app.name),
  }));

  return Response.json({ items: appsWithReadyStatus, enabled: true });
}
