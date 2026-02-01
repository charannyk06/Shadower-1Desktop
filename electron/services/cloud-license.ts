/**
 * Cloud License Service for Shadower Desktop
 *
 * Handles authentication and license validation against the Shadower web backend.
 * Provides:
 * - Cloud authentication (sign in with web account)
 * - License validation
 * - Machine ID generation and tracking
 * - Secure token storage
 */

import { app } from "electron";
import * as fs from "fs-extra";
import * as path from "path";
import * as os from "os";
import * as crypto from "crypto";

// License state
export interface CloudLicenseState {
  isAuthenticated: boolean;
  isLicensed: boolean;
  user?: {
    id: string;
    name: string;
    email: string;
  };
  activatedAt?: string;
  lastValidated?: string;
  error?: string;
}

// Cloud auth credentials storage
interface StoredCredentials {
  accessToken: string;
  refreshToken?: string;
  userId: string;
  email: string;
  expiresAt?: string;
}

// Configuration
const CLOUD_API_BASE_URL =
  process.env.SHADOWER_CLOUD_URL || "https://shadower.ai";
const LICENSE_CHECK_INTERVAL = 1000 * 60 * 60; // 1 hour
const CREDENTIALS_FILE = "cloud-credentials.json";

/**
 * Generate a unique machine ID based on hardware characteristics
 */
function generateMachineId(): string {
  const components = [
    os.hostname(),
    os.platform(),
    os.arch(),
    os.cpus()[0]?.model || "unknown-cpu",
    os.totalmem().toString(),
    // Add MAC address if available (first non-internal interface)
    ...Object.values(os.networkInterfaces())
      .flat()
      .filter((iface) => iface && !iface.internal && iface.mac !== "00:00:00:00:00:00")
      .map((iface) => iface?.mac || "")
      .slice(0, 1),
  ];

  const machineString = components.join("|");
  return crypto.createHash("sha256").update(machineString).digest("hex");
}

export class CloudLicenseService {
  private static instance: CloudLicenseService;
  private state: CloudLicenseState = {
    isAuthenticated: false,
    isLicensed: false,
  };
  private machineId: string;
  private credentialsPath: string;
  private validationTimer?: NodeJS.Timeout;

  private constructor() {
    this.machineId = generateMachineId();
    this.credentialsPath = path.join(
      app.getPath("userData"),
      "data",
      CREDENTIALS_FILE
    );

    console.log(
      `[CloudLicense] Initialized with machine ID: ${this.machineId.substring(0, 12)}...`
    );
  }

  static getInstance(): CloudLicenseService {
    if (!CloudLicenseService.instance) {
      CloudLicenseService.instance = new CloudLicenseService();
    }
    return CloudLicenseService.instance;
  }

  /**
   * Get the current license state
   */
  getState(): CloudLicenseState {
    return { ...this.state };
  }

  /**
   * Get the machine ID
   */
  getMachineId(): string {
    return this.machineId;
  }

  /**
   * Initialize the service - load stored credentials and validate license
   */
  async initialize(): Promise<CloudLicenseState> {
    console.log("[CloudLicense] Initializing...");

    try {
      // Try to load stored credentials
      const credentials = await this.loadCredentials();

      if (credentials) {
        console.log(
          `[CloudLicense] Found stored credentials for ${credentials.email}`
        );

        // Validate the license with the cloud
        const result = await this.validateLicense(credentials.accessToken);

        if (result.valid) {
          this.state = {
            isAuthenticated: true,
            isLicensed: true,
            user: result.user,
            activatedAt: result.activatedAt,
            lastValidated: new Date().toISOString(),
          };

          // Start periodic validation
          this.startPeriodicValidation(credentials.accessToken);
        } else {
          // License not valid but credentials might still be good
          this.state = {
            isAuthenticated: true,
            isLicensed: false,
            user: { id: credentials.userId, name: "", email: credentials.email },
            error: result.message || "License not valid",
          };
        }
      } else {
        console.log("[CloudLicense] No stored credentials found");
        this.state = {
          isAuthenticated: false,
          isLicensed: false,
        };
      }
    } catch (error: any) {
      console.error("[CloudLicense] Initialization error:", error);
      this.state = {
        isAuthenticated: false,
        isLicensed: false,
        error: error.message,
      };
    }

    return this.getState();
  }

  /**
   * Sign in with cloud credentials
   */
  async signIn(
    email: string,
    password: string
  ): Promise<{ success: boolean; error?: string; state?: CloudLicenseState }> {
    console.log(`[CloudLicense] Signing in as ${email}...`);

    try {
      // Authenticate with the cloud backend
      const authResponse = await fetch(`${CLOUD_API_BASE_URL}/api/auth/sign-in/email`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email, password }),
      });

      if (!authResponse.ok) {
        const errorData = await authResponse.json().catch(() => ({}));
        throw new Error(
          errorData.message || errorData.error || "Authentication failed"
        );
      }

      const authData = await authResponse.json();

      // Extract session token from response or cookies
      const sessionToken =
        authData.token ||
        authData.session?.token ||
        authResponse.headers.get("set-cookie")?.match(/session=([^;]+)/)?.[1];

      if (!sessionToken) {
        throw new Error("No session token received from server");
      }

      // Save credentials
      const credentials: StoredCredentials = {
        accessToken: sessionToken,
        userId: authData.user?.id || authData.session?.userId,
        email: email,
        expiresAt: authData.session?.expiresAt,
      };

      await this.saveCredentials(credentials);

      // Now try to activate the desktop license
      const activationResult = await this.activateLicense(sessionToken);

      if (activationResult.success) {
        this.state = {
          isAuthenticated: true,
          isLicensed: true,
          user: authData.user || { id: credentials.userId, name: "", email },
          activatedAt: activationResult.activatedAt,
          lastValidated: new Date().toISOString(),
        };

        // Start periodic validation
        this.startPeriodicValidation(sessionToken);

        return { success: true, state: this.getState() };
      } else {
        // Authenticated but license activation failed
        this.state = {
          isAuthenticated: true,
          isLicensed: false,
          user: authData.user || { id: credentials.userId, name: "", email },
          error: activationResult.error,
        };

        return {
          success: false,
          error:
            activationResult.error ||
            "Desktop license not enabled for your account",
          state: this.getState(),
        };
      }
    } catch (error: any) {
      console.error("[CloudLicense] Sign in error:", error);
      return {
        success: false,
        error: error.message || "Sign in failed",
      };
    }
  }

  /**
   * Sign out and clear stored credentials
   */
  async signOut(): Promise<void> {
    console.log("[CloudLicense] Signing out...");

    // Stop periodic validation
    if (this.validationTimer) {
      clearInterval(this.validationTimer);
      this.validationTimer = undefined;
    }

    // Clear stored credentials
    try {
      if (await fs.pathExists(this.credentialsPath)) {
        await fs.remove(this.credentialsPath);
      }
    } catch (error) {
      console.warn("[CloudLicense] Error clearing credentials:", error);
    }

    // Reset state
    this.state = {
      isAuthenticated: false,
      isLicensed: false,
    };
  }

  /**
   * Activate the desktop license on this machine
   */
  private async activateLicense(
    token: string
  ): Promise<{ success: boolean; error?: string; activatedAt?: string }> {
    try {
      const response = await fetch(
        `${CLOUD_API_BASE_URL}/api/desktop/license/activate`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            Cookie: `session=${token}`,
          },
          body: JSON.stringify({
            machineId: this.machineId,
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        return {
          success: false,
          error: data.error || "Activation failed",
        };
      }

      return {
        success: true,
        activatedAt: data.activatedAt,
      };
    } catch (error: any) {
      console.error("[CloudLicense] Activation error:", error);
      return {
        success: false,
        error: error.message || "Activation failed",
      };
    }
  }

  /**
   * Validate the license with the cloud backend
   */
  private async validateLicense(
    token: string
  ): Promise<{
    valid: boolean;
    user?: { id: string; name: string; email: string };
    activatedAt?: string;
    message?: string;
  }> {
    try {
      const response = await fetch(
        `${CLOUD_API_BASE_URL}/api/desktop/license/validate`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            Cookie: `session=${token}`,
          },
          body: JSON.stringify({
            machineId: this.machineId,
          }),
        }
      );

      const data = await response.json();

      if (!response.ok || !data.success) {
        return {
          valid: false,
          message: data.error || data.message || "Validation failed",
        };
      }

      return {
        valid: data.valid,
        user: data.user,
        activatedAt: data.activatedAt,
        message: data.message,
      };
    } catch (error: any) {
      console.error("[CloudLicense] Validation error:", error);
      return {
        valid: false,
        message: error.message || "Validation failed",
      };
    }
  }

  /**
   * Start periodic license validation
   */
  private startPeriodicValidation(token: string): void {
    if (this.validationTimer) {
      clearInterval(this.validationTimer);
    }

    this.validationTimer = setInterval(async () => {
      console.log("[CloudLicense] Running periodic validation...");
      const result = await this.validateLicense(token);

      if (!result.valid) {
        console.warn("[CloudLicense] License no longer valid:", result.message);
        this.state = {
          ...this.state,
          isLicensed: false,
          error: result.message,
        };
      } else {
        this.state = {
          ...this.state,
          lastValidated: new Date().toISOString(),
        };
      }
    }, LICENSE_CHECK_INTERVAL);
  }

  /**
   * Load stored credentials from disk
   */
  private async loadCredentials(): Promise<StoredCredentials | null> {
    try {
      if (await fs.pathExists(this.credentialsPath)) {
        const data = await fs.readJson(this.credentialsPath);
        return data as StoredCredentials;
      }
    } catch (error) {
      console.warn("[CloudLicense] Error loading credentials:", error);
    }
    return null;
  }

  /**
   * Save credentials to disk (encrypted in production)
   */
  private async saveCredentials(credentials: StoredCredentials): Promise<void> {
    try {
      // Ensure directory exists
      await fs.ensureDir(path.dirname(this.credentialsPath));

      // In production, this should use electron's safeStorage API
      // For now, we store the credentials as JSON
      await fs.writeJson(this.credentialsPath, credentials, { spaces: 2 });
      console.log("[CloudLicense] Credentials saved");
    } catch (error) {
      console.error("[CloudLicense] Error saving credentials:", error);
      throw error;
    }
  }

  /**
   * Deactivate the license (for switching machines)
   */
  async deactivate(): Promise<{ success: boolean; error?: string }> {
    const credentials = await this.loadCredentials();
    if (!credentials) {
      return { success: false, error: "Not authenticated" };
    }

    try {
      const response = await fetch(
        `${CLOUD_API_BASE_URL}/api/desktop/license/deactivate`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${credentials.accessToken}`,
            Cookie: `session=${credentials.accessToken}`,
          },
        }
      );

      const data = await response.json();

      if (!response.ok) {
        return {
          success: false,
          error: data.error || "Deactivation failed",
        };
      }

      // Clear local credentials
      await this.signOut();

      return { success: true };
    } catch (error: any) {
      console.error("[CloudLicense] Deactivation error:", error);
      return {
        success: false,
        error: error.message || "Deactivation failed",
      };
    }
  }

  /**
   * Get the cloud API base URL (for settings UI)
   */
  getCloudUrl(): string {
    return CLOUD_API_BASE_URL;
  }
}

// Export singleton getter
export function getCloudLicenseService(): CloudLicenseService {
  return CloudLicenseService.getInstance();
}
