/**
 * MCP OAuth Callback Handler
 *
 * This route handles OAuth callbacks from MCP servers.
 * It extracts the authorization code and state from the URL,
 * finishes the OAuth flow via IPC, and notifies the opener window.
 */

import { useEffect, useState } from "react";
import { useSearch } from "@tanstack/react-router";
import { Loader2, CheckCircle, XCircle } from "lucide-react";
import { mcpApi } from "@/lib/electron/mcp-api";

export default function McpOAuthCallback() {
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [message, setMessage] = useState("Processing authentication...");

  // Get query params from URL
  const search = useSearch({ strict: false }) as {
    code?: string;
    state?: string;
    error?: string;
    error_description?: string;
  };

  useEffect(() => {
    async function handleCallback() {
      const { code, state, error, error_description } = search;

      // Handle OAuth error
      if (error) {
        setStatus("error");
        setMessage(error_description || error || "Authentication failed");

        // Notify opener window of error
        if (window.opener) {
          window.opener.postMessage({
            type: "MCP_OAUTH_ERROR",
            error,
            error_description,
          }, window.location.origin);
        }
        return;
      }

      // Validate required params
      if (!code || !state) {
        setStatus("error");
        setMessage("Missing authorization code or state parameter");
        return;
      }

      try {
        // Find the MCP server by state and complete OAuth flow
        // The state parameter contains info about which server this is for
        const result = await mcpApi.finishOAuth(code, state);

        if (result.success) {
          setStatus("success");
          setMessage("Authentication successful! You can close this window.");

          // Notify opener window of success
          if (window.opener) {
            window.opener.postMessage({
              type: "MCP_OAUTH_SUCCESS",
              state,
            }, window.location.origin);
          }

          // Auto-close after short delay
          setTimeout(() => {
            window.close();
          }, 1500);
        } else {
          throw new Error(result.error || "Failed to complete authentication");
        }
      } catch (err: any) {
        setStatus("error");
        setMessage(err.message || "Failed to complete authentication");

        // Notify opener window of error
        if (window.opener) {
          window.opener.postMessage({
            type: "MCP_OAUTH_ERROR",
            error: err.message,
          }, window.location.origin);
        }
      }
    }

    handleCallback();
  }, [search]);

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-background p-4">
      <div className="max-w-md w-full bg-card rounded-lg shadow-lg p-8 text-center">
        {status === "loading" && (
          <>
            <Loader2 className="h-12 w-12 animate-spin text-primary mx-auto mb-4" />
            <h1 className="text-xl font-semibold mb-2">Authenticating...</h1>
            <p className="text-muted-foreground">{message}</p>
          </>
        )}

        {status === "success" && (
          <>
            <CheckCircle className="h-12 w-12 text-green-500 mx-auto mb-4" />
            <h1 className="text-xl font-semibold mb-2">Success!</h1>
            <p className="text-muted-foreground">{message}</p>
          </>
        )}

        {status === "error" && (
          <>
            <XCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
            <h1 className="text-xl font-semibold mb-2">Authentication Failed</h1>
            <p className="text-muted-foreground mb-4">{message}</p>
            <button
              onClick={() => window.close()}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90"
            >
              Close Window
            </button>
          </>
        )}
      </div>
    </div>
  );
}
