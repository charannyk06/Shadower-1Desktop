import { getComposioRouteContext } from "../utils";

export async function GET(request: Request) {
  const ctx = await getComposioRouteContext();
  if (!ctx.success) return ctx.response;

  const { client } = ctx;
  const { searchParams } = new URL(request.url);
  const appName = searchParams.get("app");

  if (appName) {
    const tools = await client.getToolsForApp(appName);
    return Response.json({ items: tools, enabled: true });
  }

  const connections = await client.getConnections();
  const connectedApps = connections
    .filter((c) => c.status === "active")
    .map((c) => c.appName);

  const allTools = await Promise.all(
    connectedApps.map((app) => client.getToolsForApp(app)),
  );

  return Response.json({ items: allTools.flat(), enabled: true });
}
