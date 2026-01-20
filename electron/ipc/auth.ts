import { ipcMain } from "electron";
import {
  ElectronAuthService,
  RegisterData,
  SignInData,
} from "../services/auth";

/**
 * Register IPC handlers for authentication operations
 * Full authentication support with registration, sign-in, sign-out, and session management
 */
export function registerAuthHandlers() {
  console.log("[IPC] Registering auth handlers...");

  let authService: ElectronAuthService;
  try {
    authService = ElectronAuthService.getInstance();
  } catch (error) {
    console.error("[IPC] Failed to get auth service instance:", error);
    throw error;
  }

  // Check if this is first launch (no users with passwords)
  ipcMain.handle("auth:isFirstLaunch", async () => {
    try {
      return await authService.isFirstLaunch();
    } catch (error) {
      console.error("[IPC] Error checking first launch:", error);
      return true; // Assume first launch on error
    }
  });

  // Register new user
  ipcMain.handle("auth:register", async (_event, data: RegisterData) => {
    try {
      return await authService.register(data);
    } catch (error) {
      console.error("[IPC] Error registering user:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Registration failed",
      };
    }
  });

  // Sign in with credentials
  ipcMain.handle("auth:signIn", async (_event, data: SignInData) => {
    try {
      return await authService.signIn(data);
    } catch (error) {
      console.error("[IPC] Error signing in:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Sign in failed",
      };
    }
  });

  // Sign out
  ipcMain.handle("auth:signOut", async () => {
    try {
      return await authService.signOut();
    } catch (error) {
      console.error("[IPC] Error signing out:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Sign out failed",
      };
    }
  });

  // Validate current session
  ipcMain.handle("auth:validateSession", async () => {
    try {
      return await authService.validateSession();
    } catch (error) {
      console.error("[IPC] Error validating session:", error);
      return null;
    }
  });

  // Get current session (backwards compatible)
  ipcMain.handle("auth:getSession", async () => {
    try {
      return await authService.getSession();
    } catch (error) {
      console.error("[IPC] Error getting session:", error);
      return null;
    }
  });

  // Get current user
  ipcMain.handle("auth:getCurrentUser", async () => {
    try {
      return await authService.getCurrentUser();
    } catch (error) {
      console.error("[IPC] Error getting current user:", error);
      return null;
    }
  });

  // Check if authenticated
  ipcMain.handle("auth:isAuthenticated", async () => {
    try {
      return await authService.isAuthenticated();
    } catch (error) {
      console.error("[IPC] Error checking authentication:", error);
      return false;
    }
  });

  // Update user profile
  ipcMain.handle(
    "auth:updateProfile",
    async (_event, data: { name?: string; image?: string | null }) => {
      try {
        return await authService.updateProfile(data);
      } catch (error) {
        console.error("[IPC] Error updating profile:", error);
        return null;
      }
    },
  );

  // Get user preferences (includes API keys)
  ipcMain.handle("auth:getPreferences", async () => {
    try {
      return await authService.getPreferences();
    } catch (error) {
      console.error("[IPC] Error getting preferences:", error);
      return {};
    }
  });

  // Update user preferences
  ipcMain.handle("auth:updatePreferences", async (_event, preferences: any) => {
    try {
      await authService.updatePreferences(preferences);
      return { success: true };
    } catch (error) {
      console.error("[IPC] Error updating preferences:", error);
      return { success: false, error: "Failed to update preferences" };
    }
  });

  console.log("[IPC] Auth handlers registered");
}
