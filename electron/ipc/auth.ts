import { ipcMain } from "electron";
import { ElectronAuthService } from "../services/auth";

/**
 * Register IPC handlers for authentication operations
 * Simplified for desktop app - always returns local user
 */
export function registerAuthHandlers() {
  const authService = ElectronAuthService.getInstance();

  // Get current session
  ipcMain.handle("auth:getSession", async () => {
    try {
      return await authService.getSession();
    } catch (error) {
      console.error("[IPC] Error getting session:", error);
      throw error;
    }
  });

  // Get current user
  ipcMain.handle("auth:getCurrentUser", async () => {
    try {
      return await authService.getCurrentUser();
    } catch (error) {
      console.error("[IPC] Error getting current user:", error);
      throw error;
    }
  });

  // Check if authenticated (always true for desktop)
  ipcMain.handle("auth:isAuthenticated", () => {
    return authService.isAuthenticated();
  });

  // Update user profile
  ipcMain.handle(
    "auth:updateProfile",
    async (_event, data: { name?: string; image?: string | null }) => {
      try {
        return await authService.updateProfile(data);
      } catch (error) {
        console.error("[IPC] Error updating profile:", error);
        throw error;
      }
    },
  );

  // Get user preferences (includes API keys)
  ipcMain.handle("auth:getPreferences", async () => {
    try {
      return await authService.getPreferences();
    } catch (error) {
      console.error("[IPC] Error getting preferences:", error);
      throw error;
    }
  });

  // Update user preferences
  ipcMain.handle("auth:updatePreferences", async (_event, preferences: any) => {
    try {
      await authService.updatePreferences(preferences);
      return { success: true };
    } catch (error) {
      console.error("[IPC] Error updating preferences:", error);
      throw error;
    }
  });

  console.log("[IPC] Auth handlers registered");
}
