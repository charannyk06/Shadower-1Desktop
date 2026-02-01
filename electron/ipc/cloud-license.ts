/**
 * IPC Handlers for Cloud License Service
 *
 * Exposes cloud authentication and license management to the renderer process.
 */

import { ipcMain } from "electron";
import {
  getCloudLicenseService,
  CloudLicenseState,
} from "../services/cloud-license";

export function registerCloudLicenseHandlers(): void {
  const service = getCloudLicenseService();

  /**
   * Initialize the cloud license service and check current state
   */
  ipcMain.handle("cloud-license:initialize", async (): Promise<CloudLicenseState> => {
    return await service.initialize();
  });

  /**
   * Get current license state
   */
  ipcMain.handle("cloud-license:get-state", (): CloudLicenseState => {
    return service.getState();
  });

  /**
   * Sign in with cloud credentials
   */
  ipcMain.handle(
    "cloud-license:sign-in",
    async (
      _event,
      data: { email: string; password: string }
    ): Promise<{ success: boolean; error?: string; state?: CloudLicenseState }> => {
      return await service.signIn(data.email, data.password);
    }
  );

  /**
   * Sign out from cloud
   */
  ipcMain.handle("cloud-license:sign-out", async (): Promise<void> => {
    await service.signOut();
  });

  /**
   * Deactivate license (to activate on another machine)
   */
  ipcMain.handle(
    "cloud-license:deactivate",
    async (): Promise<{ success: boolean; error?: string }> => {
      return await service.deactivate();
    }
  );

  /**
   * Get machine ID
   */
  ipcMain.handle("cloud-license:get-machine-id", (): string => {
    return service.getMachineId();
  });

  /**
   * Get cloud URL
   */
  ipcMain.handle("cloud-license:get-cloud-url", (): string => {
    return service.getCloudUrl();
  });

  console.log("[IPC] Cloud License handlers registered");
}
