/**
 * Local Whisper Transcription Service using Transformers.js (@xenova/transformers)
 * Provides local speech-to-text WITHOUT any API calls - maximum speed & privacy
 *
 * Model: Xenova/whisper-small (466MB, good accuracy)
 * - Supports multiple languages
 * - Returns timestamped segments
 * - Fully offline after first download
 */

import { app } from "electron";
import path from "path";
import fs from "fs-extra";
import log from "electron-log/main";

// Transformers.js types
type AutomaticSpeechRecognitionPipeline = any;

export interface TranscriptionSegment {
  timestamp: [number, number]; // [start, end] in seconds
  text: string;
}

export interface TranscriptionResult {
  text: string;
  chunks?: TranscriptionSegment[];
  language?: string;
  duration?: number;
}

export interface WhisperModelInfo {
  id: string;
  name: string;
  size: string;
  accuracy: string;
}

// Available Whisper models
export const WHISPER_MODELS: Record<string, WhisperModelInfo> = {
  tiny: {
    id: "Xenova/whisper-tiny",
    name: "Whisper Tiny",
    size: "~75MB",
    accuracy: "Low (fastest)",
  },
  base: {
    id: "Xenova/whisper-base",
    name: "Whisper Base",
    size: "~142MB",
    accuracy: "Medium",
  },
  small: {
    id: "Xenova/whisper-small",
    name: "Whisper Small",
    size: "~466MB",
    accuracy: "Good (recommended)",
  },
  medium: {
    id: "Xenova/whisper-medium",
    name: "Whisper Medium",
    size: "~1.5GB",
    accuracy: "High",
  },
};

export type WhisperModelSize = keyof typeof WHISPER_MODELS;

/**
 * Local Whisper Service for speech-to-text transcription
 */
export class LocalWhisperService {
  private pipeline: AutomaticSpeechRecognitionPipeline | null = null;
  private initialized = false;
  private initializing = false;
  private available = false;
  private initPromise: Promise<void> | null = null;
  private currentModelId: string | null = null;

  // Default model - good balance of speed and accuracy
  private readonly defaultModelId = "Xenova/whisper-small";

  // Singleton
  private static _instance: LocalWhisperService | null = null;

  static getInstance(): LocalWhisperService {
    if (!LocalWhisperService._instance) {
      LocalWhisperService._instance = new LocalWhisperService();
    }
    return LocalWhisperService._instance;
  }

  /**
   * Get current model info
   */
  getCurrentModel(): WhisperModelInfo | null {
    if (!this.currentModelId) return null;
    const size = Object.keys(WHISPER_MODELS).find(
      (k) => WHISPER_MODELS[k as WhisperModelSize].id === this.currentModelId
    );
    return size ? WHISPER_MODELS[size as WhisperModelSize] : null;
  }

  /**
   * Initialize the Whisper service
   * Downloads model on first run, then uses local cache
   * Has timeout to prevent hanging
   */
  async initialize(modelSize: WhisperModelSize = "small"): Promise<void> {
    const modelId = WHISPER_MODELS[modelSize]?.id || this.defaultModelId;

    // If already initialized with same model, skip
    if (this.initialized && this.currentModelId === modelId) {
      return;
    }

    // If switching models, reset state
    if (this.currentModelId && this.currentModelId !== modelId) {
      await this.close();
    }

    // Prevent concurrent initialization
    if (this.initializing && this.initPromise) {
      return this.initPromise;
    }

    this.initializing = true;

    // Longer timeout for Whisper models (larger download)
    const timeoutPromise = new Promise<void>((_, reject) => {
      setTimeout(
        () =>
          reject(
            new Error(
              "Whisper initialization timeout (180s). " +
                "The model download may be slow. It will retry on next use."
            )
          ),
        180000
      );
    });

    this.initPromise = Promise.race([
      this._doInitialize(modelId),
      timeoutPromise,
    ]).catch((error) => {
      log.error("[Whisper] Initialization failed or timed out:", error);
      this.initialized = true;
      this.available = false;
    });

    try {
      await this.initPromise;
    } finally {
      this.initializing = false;
    }
  }

  private async _doInitialize(modelId: string): Promise<void> {
    log.info(
      `[Whisper] Initializing local transcription service with Transformers.js...`
    );
    log.info(`[Whisper] Model: ${modelId}`);
    const startTime = Date.now();

    try {
      // Dynamic import to avoid issues if package not available
      const transformers = await import("@xenova/transformers");
      const { pipeline, env } = transformers;

      // Configure model cache location (same as embedding service)
      const userDataDir = app.getPath("userData");
      const modelsDir = path.join(userDataDir, "models", "transformers");
      fs.ensureDirSync(modelsDir);

      // Configure transformers.js environment
      env.cacheDir = modelsDir;
      env.localModelPath = modelsDir;
      env.allowRemoteModels = true;
      env.allowLocalModels = true;

      log.info(`[Whisper] Model cache directory: ${modelsDir}`);
      log.info(`[Whisper] Loading model: ${modelId}...`);

      // Create the automatic speech recognition pipeline
      this.pipeline = await pipeline("automatic-speech-recognition", modelId, {
        quantized: true,
        progress_callback: (progress: any) => {
          if (progress.status === "downloading") {
            const percent = Math.round((progress.loaded / progress.total) * 100);
            log.info(`[Whisper] Downloading model: ${percent}%`);
          } else if (progress.status === "ready") {
            log.info(`[Whisper] Model ready!`);
          }
        },
      });

      this.currentModelId = modelId;
      this.available = true;
      this.initialized = true;
      const duration = Date.now() - startTime;
      log.info(
        `[Whisper] ✓ Local transcription service initialized in ${duration}ms!`
      );
    } catch (error) {
      log.error("[Whisper] Failed to initialize:", error);
      this.initialized = true; // Mark as initialized to prevent retry loops
      this.available = false;
    }
  }

  /**
   * Check if Whisper service is available
   */
  isAvailable(): boolean {
    return this.available && this.pipeline !== null;
  }

  /**
   * Transcribe audio to text
   *
   * @param audioData - Float32Array of audio samples (16kHz, mono)
   * @param options - Transcription options
   * @returns Transcription result with text and optional timestamps
   */
  async transcribe(
    audioData: Float32Array,
    options: {
      language?: string;
      returnTimestamps?: boolean;
      chunkLengthS?: number;
      strideLengthS?: number;
    } = {}
  ): Promise<TranscriptionResult> {
    if (!this.initialized) {
      await this.initialize();
    }

    if (!this.available || !this.pipeline) {
      const errorMsg =
        "[Whisper] Service not available. " +
        (this.initialized
          ? "Model failed to load."
          : "Service not initialized.") +
        " Check if transformers.js model downloaded correctly.";
      log.error(errorMsg);
      throw new Error(errorMsg);
    }

    try {
      const startTime = Date.now();

      // Default options
      const {
        language = "en",
        returnTimestamps = true,
        chunkLengthS = 30,
        strideLengthS = 5,
      } = options;

      log.info(
        `[Whisper] Transcribing ${audioData.length} samples (${(audioData.length / 16000).toFixed(1)}s of audio)...`
      );

      // Run transcription
      const result = await this.pipeline(audioData, {
        language,
        return_timestamps: returnTimestamps,
        chunk_length_s: chunkLengthS,
        stride_length_s: strideLengthS,
      });

      const duration = Date.now() - startTime;
      log.info(`[Whisper] Transcription completed in ${duration}ms`);
      log.info(`[Whisper] Result: "${result.text?.slice(0, 100)}..."`);

      return {
        text: result.text || "",
        chunks: result.chunks as TranscriptionSegment[] | undefined,
        language,
        duration,
      };
    } catch (error) {
      log.error("[Whisper] Error during transcription:", error);
      throw error;
    }
  }

  /**
   * Transcribe audio from a file path
   *
   * @param filePath - Path to audio file (WAV, MP3, etc.)
   * @param options - Transcription options
   * @returns Transcription result
   */
  async transcribeFile(
    filePath: string,
    options: {
      language?: string;
      returnTimestamps?: boolean;
    } = {}
  ): Promise<TranscriptionResult> {
    if (!this.initialized) {
      await this.initialize();
    }

    if (!this.available || !this.pipeline) {
      throw new Error("[Whisper] Service not available");
    }

    try {
      const startTime = Date.now();
      log.info(`[Whisper] Transcribing file: ${filePath}`);

      // Transformers.js can handle file paths directly
      const result = await this.pipeline(filePath, {
        language: options.language || "en",
        return_timestamps: options.returnTimestamps ?? true,
        chunk_length_s: 30,
        stride_length_s: 5,
      });

      const duration = Date.now() - startTime;
      log.info(`[Whisper] File transcription completed in ${duration}ms`);

      return {
        text: result.text || "",
        chunks: result.chunks as TranscriptionSegment[] | undefined,
        language: options.language || "en",
        duration,
      };
    } catch (error) {
      log.error("[Whisper] Error transcribing file:", error);
      throw error;
    }
  }

  /**
   * Check if a model is downloaded
   */
  isModelDownloaded(modelSize: WhisperModelSize): boolean {
    const modelId = WHISPER_MODELS[modelSize]?.id;
    if (!modelId) return false;

    const userDataDir = app.getPath("userData");
    const modelsDir = path.join(userDataDir, "models", "transformers");
    const modelDir = path.join(modelsDir, modelId.replace("/", "--"));

    return fs.existsSync(modelDir);
  }

  /**
   * Get list of downloaded models
   */
  getDownloadedModels(): WhisperModelSize[] {
    return (Object.keys(WHISPER_MODELS) as WhisperModelSize[]).filter((size) =>
      this.isModelDownloaded(size)
    );
  }

  /**
   * Close the Whisper service and release resources
   */
  async close(): Promise<void> {
    if (this.pipeline) {
      log.info("[Whisper] Closing transcription service");
      // Transformers.js doesn't have explicit cleanup, but we clear references
      this.pipeline = null;
      this.initialized = false;
      this.available = false;
      this.currentModelId = null;
    }
  }
}

// Singleton instance management
let whisperService: LocalWhisperService | null = null;

export const getWhisperService = (): LocalWhisperService => {
  if (!whisperService) {
    whisperService = LocalWhisperService.getInstance();
  }
  return whisperService;
};

export const closeWhisperService = async (): Promise<void> => {
  if (whisperService) {
    await whisperService.close();
    whisperService = null;
  }
};

// Pre-initialization is disabled by default for Whisper (large model)
// It will be initialized on first transcription request

export default LocalWhisperService;
