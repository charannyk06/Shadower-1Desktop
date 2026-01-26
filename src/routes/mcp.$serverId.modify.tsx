import { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "@tanstack/react-router";
import MCPEditor from "@/components/mcp-editor";
import { mcpApi } from "@/lib/electron/mcp-api";
import { authClient } from "@/lib/auth/client";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Alert } from "ui/alert";

/**
 * MCP Server Edit Page
 * Auth is handled by AuthGuard in the layout.
 * Server data is fetched via IPC in Electron mode.
 */
export default function McpModifyPage() {
  const params = useParams({ strict: false });
  const navigate = useNavigate();
  const id = params.serverId;
  const { data: session } = authClient.useSession();

  const [mcpClient, setMcpClient] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!session?.user?.id || !id) return;

    const loadMcpServer = async () => {
      setIsLoading(true);
      try {
        const server = await mcpApi.getById(id);

        if (!server) {
          setNotFound(true);
        } else {
          setMcpClient(server);
        }
      } catch (error) {
        console.error("[MCPModifyPage] Error loading MCP server:", error);
        setNotFound(true);
      }
      setIsLoading(false);
    };

    loadMcpServer();
  }, [id, session?.user?.id]);

  if (!session?.user?.id) {
    return null; // AuthGuard will handle redirect
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (notFound) {
    navigate({ to: "/mcp" });
    return null;
  }

  return (
    <div className="container max-w-3xl mx-4 md:mx-auto py-8">
      <div className="flex flex-col gap-2">
        <Link
          to="/mcp"
          className="flex items-center gap-2 text-muted-foreground text-sm hover:text-foreground transition-colors mb-8"
        >
          <ArrowLeft className="size-3" />
          Back
        </Link>
        <header>
          <h2 className="text-3xl font-semibold my-2">MCP Configuration</h2>
          <p className="text text-muted-foreground">
            Configure your MCP server connection settings
          </p>
        </header>

        <main className="my-8">
          {mcpClient ? (
            <MCPEditor
              initialConfig={mcpClient.config}
              name={mcpClient.name}
              id={mcpClient.id}
            />
          ) : (
            <Alert variant="destructive">MCP client not found</Alert>
          )}
        </main>
      </div>
    </div>
  );
}
