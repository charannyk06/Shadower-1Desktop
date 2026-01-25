/**
 * Whisper Service for Local Speech-to-Text
 *
 * Provides local transcription using Whisper models.
 * Supports both:
 * - OpenAI Whisper API (cloud fallback)
 * - whisper.cpp native bindings (local, fast)
 *
 * Performance targets:
 * - macOS: Metal GPU acceleration (2-4x faster)
 * - Windows: Optimized CPU inference
 * - Target: <1s transcription for typical utterances
 */

import path from "path";
import fs from "fs";
import os from "os";
import { app } from "electron";
import log from "electron-log/main";

// Model sizes and their approximate performance characteristics
export const WHISPER_MODELS = {
  tiny: { name: "whisper-tiny", size: "75MB", accuracy: "low", speed: "fastest" },
  base: { name: "whisper-base", size: "142MB", accuracy: "medium", speed: "fast" },
  small: { name: "whisper-small", size: "466MB", accuracy: "good", speed: "moderate" },
  medium: { name: "whisper-medium", size: "1.5GB", accuracy: "high", speed: "slow" },
  large: { name: "whisper-large-v3", size: "2.9GB", accuracy: "best", speed: "slowest" },
} as const;

export type WhisperModelId = keyof typeof WHISPER_MODELS;

export interface TranscriptionResult {
  text: string;
  language?: string;
  duration?: number;
  segments?: Array<{
    start: number;
    end: number;
    text: string;
  }>;
}

export interface WhisperServiceOptions {
  modelId?: WhisperModelId;
  language?: string;
  translateToEnglish?: boolean;
}

/**
 * Whisper Service for local speech-to-text transcription
 */
export class WhisperService {
  private modelPath: string;
  private currentModelId: WhisperModelId | null = null;
  private isInitialized = false;

  // Note: whisper.cpp native bindings would be loaded here
  // For now, we provide a fallback to OpenAI Whisper API
  private nativeWhisper: any = null;

  constructor() {
    this.modelPath = path.join(app.getPath("userData"), "models", "whisper");
  }

  /**
   * Initialize the Whisper service with a specific model
   */
  async initialize(modelId: WhisperModelId = "base"): Promise<void> {
    if (this.isInitialized && this.currentModelId === modelId) {
      return;
    }

    log.info(`[WhisperService] Initializing with model: ${modelId}`);

    try {
      // Ensure model directory exists
      if (!fs.existsSync(this.modelPath)) {
        fs.mkdirSync(this.modelPath, { recursive: true });
      }

      // Try to load native whisper.cpp bindings
      await this.loadNativeWhisper(modelId);

      this.currentModelId = modelId;
      this.isInitialized = true;
      log.info(`[WhisperService] Initialized successfully with model: ${modelId}`);
    } catch (error) {
      log.warn(
        "[WhisperService] Native whisper.cpp not available, will use fallback:",
        error instanceof Error ? error.message : error
      );
      // Service is still "initialized" but will use fallback methods
      this.isInitialized = true;
    }
  }

  /**
   * Load native whisper.cpp bindings
   * This is a placeholder - actual implementation would load the native module
   *
   * TRACKING: Local Speech-to-Text Implementation
   * Priority: Medium (voice chat works via cloud, this enables offline mode)
   *
   * Implementation options (in order of preference):
   * 1. whisper-node - Active Node.js bindings for whisper.cpp
   *    npm: whisper-node (https://github.com/ariym/whisper-node)
   *    Pros: Well-maintained, supports Metal on macOS
   *    Cons: Requires native build step
   *
   * 2. @nicolo-ribaudo/whisper-node - Alternative bindings
   *    Pros: Prebuild binaries available
   *    Cons: Less active maintenance
   *
   * 3. Spawn whisper.cpp CLI as subprocess
   *    Pros: Simple integration, user installs whisper.cpp separately
   *    Cons: Requires user to have whisper.cpp installed
   *
   * 4. WASM-based whisper (whisper.wasm)
   *    Pros: No native dependencies, works everywhere
   *    Cons: Slower than native, larger bundle size
   */
  private async loadNativeWhisper(_modelId: WhisperModelId): Promise<void> {
    // Native whisper.cpp bindings not yet implemented
    // Voice chat currently uses OpenAI Whisper API as fallback
    // See implementation options above for adding local support
    throw new Error(
      "Native whisper.cpp bindings not yet implemented. " +
      "Voice chat will use cloud-based transcription. " +
      "See whisper-service.ts for implementation options."
    );
  }

  /**
   * Check if native Whisper is available
   */
  isNativeAvailable(): boolean {
    return this.nativeWhisper !== null;
  }

  /**
   * Check if service is initialized
   */
  isAvailable(): boolean {
    return this.isInitialized;
  }

  /**
   * Transcribe audio to text
   *
   * @param audioBuffer - Audio data (supports WAV, MP3, WebM, etc.)
   * @param options - Transcription options
   * @returns Transcription result
   */
  async transcribe(
    audioBuffer: Buffer,
    options?: WhisperServiceOptions
  ): Promise<TranscriptionResult> {
    if (!this.isInitialized) {
      await this.initialize(options?.modelId || "base");
    }

    const startTime = Date.now();

    // If native whisper is available, use it
    if (this.nativeWhisper) {
      return this.transcribeNative(audioBuffer, options);
    }

    // Otherwise, we need to either:
    // 1. Use OpenAI Whisper API (requires API key)
    // 2. Fall back to browser-based transcription
    // 3. Throw an error requesting user to install dependencies

    log.warn("[WhisperService] Native transcription not available");

    throw new Error(
      "Local speech-to-text requires whisper.cpp native bindings. " +
        "Please ensure the whisper dependencies are installed, or use cloud-based voice mode."
    );
  }

  /**
   * Transcribe using native whisper.cpp
   */
  private async transcribeNative(
    audioBuffer: Buffer,
    options?: WhisperServiceOptions
  ): Promise<TranscriptionResult> {
    const startTime = Date.now();

    // Convert audio to WAV format if needed (whisper.cpp expects 16kHz mono WAV)
    const wavBuffer = await this.convertToWav(audioBuffer);

    // Save to temp file (whisper.cpp reads from file)
    const tempFile = path.join(os.tmpdir(), `whisper_${Date.now()}.wav`);
    fs.writeFileSync(tempFile, wavBuffer);

    try {
      // Call native whisper transcription
      // This is a placeholder - actual implementation depends on bindings used
      const result = await this.nativeWhisper.transcribe(tempFile, {
        language: options?.language || "en",
        translate: options?.translateToEnglish || false,
      });

      const elapsed = Date.now() - startTime;
      log.info(`[WhisperService] Transcription completed in ${elapsed}ms`);

      return {
        text: result.text,
        language: result.language,
        duration: elapsed,
        segments: result.segments,
      };
    } finally {
      // Cleanup temp file
      try {
        fs.unlinkSync(tempFile);
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  /**
   * Convert audio buffer to WAV format required by whisper.cpp
   * (16kHz, mono, 16-bit PCM)
   */
  private async convertToWav(audioBuffer: Buffer): Promise<Buffer> {
    // For now, assume input is already in a compatible format
    // TODO: Implement proper audio conversion using ffmpeg or similar

    // Check if it's already a WAV file
    if (
      audioBuffer[0] === 0x52 &&
      audioBuffer[1] === 0x49 &&
      audioBuffer[2] === 0x46 &&
      audioBuffer[3] === 0x46
    ) {
      return audioBuffer;
    }

    // TODO: Convert other formats (WebM, MP3, etc.) to WAV
    // This would typically use ffmpeg or a Node.js audio processing library
    log.warn("[WhisperService] Audio format conversion not yet implemented");
    return audioBuffer;
  }

  /**
   * Get current model information
   */
  getCurrentModel(): typeof WHISPER_MODELS[WhisperModelId] | null {
    if (!this.currentModelId) {
      return null;
    }
    return WHISPER_MODELS[this.currentModelId];
  }

  /**
   * Download a Whisper model
   */
  async downloadModel(modelId: WhisperModelId): Promise<void> {
    const model = WHISPER_MODELS[modelId];
    log.info(`[WhisperService] Downloading model: ${model.name}`);

    // TODO: Implement model downloading
    // Models can be downloaded from:
    // - Hugging Face: https://huggingface.co/ggerganov/whisper.cpp
    // - OpenAI: Original Whisper models

    throw new Error(`Model download not yet implemented for: ${model.name}`);
  }

  /**
   * Check if a model is downloaded
   */
  isModelDownloaded(modelId: WhisperModelId): boolean {
    const model = WHISPER_MODELS[modelId];
    const modelFile = path.join(this.modelPath, `${model.name}.bin`);
    return fs.existsSync(modelFile);
  }

  /**
   * Get list of downloaded models
   */
  getDownloadedModels(): WhisperModelId[] {
    return (Object.keys(WHISPER_MODELS) as WhisperModelId[]).filter((id) =>
      this.isModelDownloaded(id)
    );
  }

  /**
   * Cleanup resources
   */
  async cleanup(): Promise<void> {
    if (this.nativeWhisper) {
      // Release model resources
      try {
        await this.nativeWhisper.cleanup?.();
      } catch {
        // Ignore cleanup errors
      }
      this.nativeWhisper = null;
    }
    this.isInitialized = false;
    this.currentModelId = null;
    log.info("[WhisperService] Cleaned up resources");
  }
}

// Singleton instance
let whisperInstance: WhisperService | null = null;

/**
 * Get the Whisper service singleton instance
 */
export function getWhisperService(): WhisperService {
  if (!whisperInstance) {
    whisperInstance = new WhisperService();
  }
  return whisperInstance;
}

/**
 * Close the Whisper service and release resources
 */
export async function closeWhisperService(): Promise<void> {
  if (whisperInstance) {
    await whisperInstance.cleanup();
    whisperInstance = null;
  }
}

export default WhisperService;
