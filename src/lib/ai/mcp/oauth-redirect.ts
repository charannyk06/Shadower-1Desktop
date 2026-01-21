"use client";

import { mcpApi } from "@/lib/electron/mcp-api";
import { wait } from "lib/utils";

export function redriectMcpOauth(id: string) {
  return mcpApi.authorize(id).then((authUrl) => {
    if (!authUrl) {
      throw new Error("Authorization URL not available. This server may require manual OAuth setup.");
    }
    return new Promise((resolve, reject) => {
      // Safely append prompt parameter to authUrl

      const authWindow = window.open(
        authUrl,
        "oauth",
        "width=600,height=800,scrollbars=yes,resizable=yes",
      );
      if (!authWindow) {
        return reject(
          new Error("Please allow popups for OAuth authentication"),
        );
      }

      const check = async () => {
        await wait(1000); // 1 second
        const isAuthorized = await mcpApi.checkToken(id);
        if (isAuthorized) return resolve(true);
        return reject(new Error("Authentication failed"));
      };

      let messageHandlerRegistered = false;
      let intervalId: NodeJS.Timeout | null = null;

      // Clean up function
      const cleanup = () => {
        if (messageHandlerRegistered) {
          window.removeEventListener("message", messageHandler);
          messageHandlerRegistered = false;
        }
        if (intervalId) {
          clearInterval(intervalId);
          intervalId = null;
        }
      };

      // Message handler for postMessage communication
      const messageHandler = (event: MessageEvent) => {
        // Security: only accept messages from same origin
        if (event.origin !== window.location.origin) {
          return;
        }

        if (event.data.type === "MCP_OAUTH_SUCCESS") {
          cleanup();
          if (authWindow && !authWindow.closed) {
            authWindow.close();
          }
          check();
        } else if (event.data.type === "MCP_OAUTH_ERROR") {
          cleanup();
          if (authWindow && !authWindow.closed) {
            authWindow.close();
          }
          const errorMessage =
            event.data.error_description ||
            event.data.error ||
            "Authentication failed";
          reject(new Error(errorMessage));
        }
      };

      // Register message event listener
      window.addEventListener("message", messageHandler);
      messageHandlerRegistered = true;

      // Backup: Poll for manual window close (in case postMessage fails)
      intervalId = setInterval(() => {
        if (authWindow.closed) {
          cleanup();
          check();
        }
      }, 1000);
    });
  });
}
