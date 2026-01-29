import { machineIdSync } from "node-machine-id";
import { app } from "electron";
import log from "electron-log";

// Simple telemetry - just pings a server to count active users
// No personal data, just anonymous machine ID + version + platform

const TELEMETRY_URL =
  process.env.TELEMETRY_URL || "https://api.shadower.app/telemetry";

interface TelemetryPayload {
  machineId: string;
  version: string;
  platform: string;
  arch: string;
  event: "app_opened" | "app_closed" | "update_installed";
  timestamp: string;
}

export class TelemetryService {
  private machineId: string;
  private enabled: boolean = true;

  constructor() {
    // Anonymous machine ID (hashed, not reversible to actual machine info)
    try {
      // machineIdSync(false) returns hashed ID, true returns original
      this.machineId = machineIdSync(false);
    } catch (error) {
      // Fallback to random ID if machine ID fails
      this.machineId = `fallback-${Math.random().toString(36).substring(2, 15)}`;
      log.warn("[Telemetry] Failed to get machine ID, using fallback");
    }
  }

  async trackAppOpen(): Promise<void> {
    if (!this.enabled) return;

    await this.send({
      machineId: this.machineId,
      version: app.getVersion(),
      platform: process.platform,
      arch: process.arch,
      event: "app_opened",
      timestamp: new Date().toISOString(),
    });
  }

  async trackAppClose(): Promise<void> {
    if (!this.enabled) return;

    await this.send({
      machineId: this.machineId,
      version: app.getVersion(),
      platform: process.platform,
      arch: process.arch,
      event: "app_closed",
      timestamp: new Date().toISOString(),
    });
  }

  async trackUpdateInstalled(newVersion: string): Promise<void> {
    if (!this.enabled) return;

    await this.send({
      machineId: this.machineId,
      version: newVersion,
      platform: process.platform,
      arch: process.arch,
      event: "update_installed",
      timestamp: new Date().toISOString(),
    });
  }

  private async send(payload: TelemetryPayload): Promise<void> {
    try {
      const response = await fetch(TELEMETRY_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        log.info("[Telemetry] Sent:", payload.event);
      } else {
        log.debug("[Telemetry] Server returned:", response.status);
      }
    } catch (error) {
      // Silently fail - telemetry should never break the app
      log.debug("[Telemetry] Failed to send:", error);
    }
  }

  getMachineId(): string {
    return this.machineId;
  }

  disable(): void {
    this.enabled = false;
    log.info("[Telemetry] Disabled");
  }

  enable(): void {
    this.enabled = true;
    log.info("[Telemetry] Enabled");
  }

  isEnabled(): boolean {
    return this.enabled;
  }
}

// Singleton instance
let telemetryInstance: TelemetryService | null = null;

export function getTelemetryService(): TelemetryService {
  if (!telemetryInstance) {
    telemetryInstance = new TelemetryService();
  }
  return telemetryInstance;
}
