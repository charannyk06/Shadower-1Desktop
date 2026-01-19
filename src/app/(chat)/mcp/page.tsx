"use client";

import MCPDashboard from "@/components/mcp-dashboard";
import { authClient } from "@/lib/auth/client";

/**
 * MCP Dashboard Page
 * Auth is handled by AuthGuard in the layout.
 */
export default function Page() {
  const { data: session } = authClient.useSession();

  if (!session?.user) {
    return null; // AuthGuard will handle redirect
  }

  // Note: message prop removed - can be added back if needed via env check on client
  return <MCPDashboard user={session.user} />;
}
