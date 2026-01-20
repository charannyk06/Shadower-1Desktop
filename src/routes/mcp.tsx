import MCPDashboard from "@/components/mcp-dashboard";
import { authClient } from "@/lib/auth/client";
import { BasicUser } from "@/types/user";

/**
 * MCP Dashboard Page
 * Auth is handled by AuthGuard in the layout.
 */
export default function McpPage() {
  const { data: session } = authClient.useSession();

  if (!session?.user) {
    return null; // AuthGuard will handle redirect
  }

  // Augment session user with required BasicUser fields
  const user: BasicUser = {
    ...session.user,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  return <MCPDashboard user={user} />;
}
