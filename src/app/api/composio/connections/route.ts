import { getComposioRouteContext } from "../utils";

export async function GET() {
  const ctx = await getComposioRouteContext();
  if (!ctx.success) return ctx.response;

  const connections = await ctx.client.getConnections();

  return Response.json({ items: connections, enabled: true });
}
