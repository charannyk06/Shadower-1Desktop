/**
 * Voice IPC Handlers
 *
 * Handles voice-related operations:
 * - OpenAI Realtime session creation
 * - Local STT (Whisper)
 * - Local TTS (macOS say, Windows SAPI)
 */

import { ipcMain, safeStorage } from "electron";
import { eq, and } from "drizzle-orm";
import log from "electron-log/main";
import { getDatabase, schema } from "../services/database";
import { ElectronAuthService } from "../services/auth";

// OpenAI Realtime API endpoint
const OPENAI_REALTIME_URL = "https://api.openai.com/v1/realtime/sessions";

// Cached auth service reference
let authService: ElectronAuthService | null = null;

/**
 * Decrypt an API key using Electron's safeStorage
 */
function decryptApiKey(encryptedKey: string): string {
  const buffer = Buffer.from(encryptedKey, "base64");
  return safeStorage.decryptString(buffer);
}

/**
 * Require authentication and return user
 */
async function requireAuth(auth: ElectronAuthService) {
  const session = await auth.validateSession();
  if (!session?.user) {
    throw new Error("Not authenticated");
  }
  return session.user;
}

/**
 * Get decrypted API key for a provider
 */
async function getDecryptedApiKey(
  providerId: string,
  userId: string
): Promise<string | null> {
  const db = getDatabase();

  const [keyRecord] = await db
    .select()
    .from(schema.ApiKeyTable)
    .where(
      and(
        eq(schema.ApiKeyTable.userId, userId),
        eq(schema.ApiKeyTable.providerId, providerId)
      )
    )
    .limit(1);

  if (!keyRecord) {
    return null;
  }

  return decryptApiKey(keyRecord.encryptedKey);
}

/**
 * Register all voice-related IPC handlers
 */
export function registerVoiceHandlers(auth?: ElectronAuthService) {
  if (auth) {
    authService = auth;
  }

  log.info("[Voice] Registering voice IPC handlers");

  // ============================================
  // OpenAI Realtime Session Creation
  // ============================================

  ipcMain.handle(
    "voice:createOpenAISession",
    async (
      _event,
      data: {
        model?: string;
        voice?: string;
        agentId?: string;
        mentions?: any[];
        instructions?: string;
        tools?: any[];
      }
    ) => {
      try {
        if (!authService) {
          throw new Error("Auth service not initialized");
        }

        const user = await requireAuth(authService);
        const apiKey = await getDecryptedApiKey("openai", user.id);

        if (!apiKey) {
          throw new Error(
            "OpenAI API key not configured. Please add your API key in Settings."
          );
        }

        log.info("[Voice] Creating OpenAI Realtime session", {
          model: data.model,
          voice: data.voice,
        });

        // Build session configuration
        const sessionConfig: Record<string, any> = {
          model: data.model || "gpt-4o-realtime-preview",
          voice: data.voice || "ash",
        };

        // Add instructions if provided
        if (data.instructions) {
          sessionConfig.instructions = data.instructions;
        }

        // Add tools if provided
        if (data.tools && data.tools.length > 0) {
          sessionConfig.tools = data.tools;
        }

        // Input/output audio format settings
        sessionConfig.input_audio_format = "pcm16";
        sessionConfig.output_audio_format = "pcm16";

        // Enable transcription
        sessionConfig.input_audio_transcription = {
          model: "whisper-1",
        };

        // Turn detection settings
        sessionConfig.turn_detection = {
          type: "server_vad",
          threshold: 0.5,
          prefix_padding_ms: 300,
          silence_duration_ms: 500,
        };

        const response = await fetch(OPENAI_REALTIME_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(sessionConfig),
        });

        if (!response.ok) {
          const errorText = await response.text();
          log.error("[Voice] OpenAI Realtime session creation failed:", {
            status: response.status,
            error: errorText,
          });
          throw new Error(
            `Failed to create OpenAI Realtime session: ${response.status} - ${errorText}`
          );
        }

        const session = await response.json();
        log.info("[Voice] OpenAI Realtime session created successfully");

        return session;
      } catch (error) {
        log.error("[Voice] Error creating OpenAI Realtime session:", error);
        throw error;
      }
    }
  );

  // ============================================
  // Local TTS (Text-to-Speech)
  // ============================================

  ipcMain.handle(
    "voice:synthesize",
    async (
      _event,
      data: {
        text: string;
        voice?: string;
        rate?: number;
      }
    ) => {
      try {
        const { exec } = await import("child_process");
        const { promisify } = await import("util");
        const fs = await import("fs");
        const path = await import("path");
        const os = await import("os");

        const execAsync = promisify(exec);
        const platform = os.platform();

        if (platform === "darwin") {
          // macOS: Use 'say' command
          const voice = data.voice || "Samantha";
          const tempFile = path.join(
            os.tmpdir(),
            `tts_${Date.now()}.aiff`
          );

          // Escape text for shell (remove quotes and escape special chars)
          const escapedText = data.text
            .replace(/\\/g, "\\\\")
            .replace(/"/g, '\\"')
            .replace(/`/g, "\\`")
            .replace(/\$/g, "\\$");

          const rateArg = data.rate ? `-r ${data.rate}` : "";

          await execAsync(
            `say -v "${voice}" ${rateArg} -o "${tempFile}" "${escapedText}"`
          );

          const buffer = fs.readFileSync(tempFile);
          fs.unlinkSync(tempFile); // Cleanup

          return {
            audio: buffer.toString("base64"),
            format: "aiff",
          };
        } else if (platform === "win32") {
          // Windows: Use PowerShell SAPI
          const tempFile = path.join(
            os.tmpdir(),
            `tts_${Date.now()}.wav`
          );

          // Escape text for PowerShell
          const escapedText = data.text.replace(/"/g, '`"').replace(/'/g, "''");

          const script = `
            Add-Type -AssemblyName System.Speech
            $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
            $synth.SetOutputToWaveFile("${tempFile}")
            ${data.rate ? `$synth.Rate = ${Math.round((data.rate - 175) / 20)}` : ""}
            $synth.Speak("${escapedText}")
            $synth.Dispose()
          `;

          await execAsync(`powershell -Command "${script.replace(/\n/g, " ")}"`);

          const buffer = fs.readFileSync(tempFile);
          fs.unlinkSync(tempFile); // Cleanup

          return {
            audio: buffer.toString("base64"),
            format: "wav",
          };
        } else {
          throw new Error(`TTS not supported on platform: ${platform}`);
        }
      } catch (error) {
        log.error("[Voice] TTS synthesis error:", error);
        throw error;
      }
    }
  );

  // ============================================
  // Get Available TTS Voices
  // ============================================

  ipcMain.handle("voice:getAvailableVoices", async () => {
    try {
      const { exec } = await import("child_process");
      const { promisify } = await import("util");
      const os = await import("os");

      const execAsync = promisify(exec);
      const platform = os.platform();

      if (platform === "darwin") {
        // macOS: Get voices from 'say -v ?'
        const { stdout } = await execAsync("say -v '?'");
        const voices = stdout
          .split("\n")
          .filter((line) => line.trim())
          .map((line) => {
            // Format: "Alex                en_US    # Most people recognize me by my voice."
            const match = line.match(/^(\S+)\s+(\S+)/);
            if (match) {
              return {
                name: match[1],
                language: match[2],
              };
            }
            return null;
          })
          .filter(Boolean);

        return voices;
      } else if (platform === "win32") {
        // Windows: Get voices from PowerShell
        const script = `
          Add-Type -AssemblyName System.Speech
          $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
          $synth.GetInstalledVoices() | ForEach-Object { $_.VoiceInfo.Name + "|" + $_.VoiceInfo.Culture.Name }
        `;
        const { stdout } = await execAsync(`powershell -Command "${script}"`);
        const voices = stdout
          .split("\n")
          .filter((line) => line.trim())
          .map((line) => {
            const parts = line.trim().split("|");
            return {
              name: parts[0],
              language: parts[1] || "en-US",
            };
          });

        return voices;
      }

      return [{ name: "default", language: "en" }];
    } catch (error) {
      log.error("[Voice] Error getting available voices:", error);
      return [{ name: "default", language: "en" }];
    }
  });

  // ============================================
  // Local STT (Speech-to-Text) - Placeholder
  // Will be implemented with Whisper.cpp
  // ============================================

  ipcMain.handle(
    "voice:transcribe",
    async (
      _event,
      data: {
        audio: string; // base64 encoded audio
        language?: string;
      }
    ) => {
      try {
        // TODO: Implement Whisper.cpp transcription
        // For now, return an error indicating it's not yet implemented
        log.warn("[Voice] Local transcription not yet implemented");
        throw new Error(
          "Local speech-to-text is not yet implemented. Please use OpenAI voice mode."
        );
      } catch (error) {
        log.error("[Voice] Transcription error:", error);
        throw error;
      }
    }
  );

  log.info("[Voice] Voice IPC handlers registered successfully");
}
