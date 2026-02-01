/**
 * Meeting Minutes IPC Handlers
 *
 * Provides meeting recording and transcription capabilities:
 * - Start/stop/pause recording sessions
 * - Local transcription via Whisper (Transformers.js)
 * - AI-powered summary generation
 * - Save to knowledge base for semantic search
 *
 * Architecture:
 * Renderer -> IPC -> Main Process -> Whisper (local) -> SQLite + DuckDB
 */

import { ipcMain, desktopCapturer, app, systemPreferences, shell } from "electron";
import { randomUUID } from "crypto";
import path from "path";
import fs from "fs-extra";
import { getDatabase, schema } from "../services/database";
import { getWhisperService } from "../services/whisper-transcription";
import { getEmbeddingService } from "../services/embedding";
import { getVectorStore } from "../services/vector-store";
import { eq, and, desc } from "drizzle-orm";
import log from "electron-log/main";

// Types for meeting sessions
export interface TranscriptSegment {
  timestamp: [number, number];
  text: string;
  speaker?: string;
}

export interface MeetingSession {
  id: string;
  userId: string;
  threadId?: string | null;
  title?: string | null;
  status: "recording" | "processing" | "completed" | "failed";
  startedAt: Date;
  endedAt?: Date | null;
  durationMs?: number | null;
  audioSource?: "mic" | "system" | "both" | null;
  rawTranscript?: string | null;
  transcriptSegments?: TranscriptSegment[] | null;
  summary?: string | null;
  keyPoints?: string[] | null;
  actionItems?: Array<{
    id: string;
    description: string;
    assignee?: string;
    completed?: boolean;
  }> | null;
  attendees?: string[] | null;
  decisions?: string[] | null;
  documentId?: string | null;
  knowledgeBaseId?: string | null;
  errorMessage?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// Active sessions cache (for fast lookup during recording)
const activeSessions = new Map<
  string,
  {
    segments: TranscriptSegment[];
    accumulatedText: string;
    lastUpdateTime: number;
  }
>();

/**
 * Register all meeting-related IPC handlers
 */
export function registerMeetingHandlers() {
  log.info("[Meeting] Registering IPC handlers...");

  // ============================================
  // Check Permissions (macOS)
  // ============================================
  ipcMain.handle("meeting:checkPermissions", async () => {
    const result = {
      microphone: "unknown" as string,
      screen: "unknown" as string,
      platform: process.platform,
    };

    if (process.platform === "darwin") {
      result.microphone = systemPreferences.getMediaAccessStatus("microphone");
      result.screen = systemPreferences.getMediaAccessStatus("screen");

      log.info(`[Meeting] Permission check - Mic: ${result.microphone}, Screen: ${result.screen}`);
    } else {
      // On non-macOS, assume permissions are handled by the OS
      result.microphone = "granted";
      result.screen = "granted";
    }

    return result;
  });

  // ============================================
  // Request Microphone Permission (macOS)
  // ============================================
  ipcMain.handle("meeting:requestMicrophonePermission", async () => {
    if (process.platform === "darwin") {
      const currentStatus = systemPreferences.getMediaAccessStatus("microphone");
      log.info(`[Meeting] Current microphone status: ${currentStatus}`);

      if (currentStatus === "not-determined") {
        const granted = await systemPreferences.askForMediaAccess("microphone");
        log.info(`[Meeting] Microphone permission ${granted ? "granted" : "denied"}`);
        return { granted, status: granted ? "granted" : "denied" };
      } else if (currentStatus === "denied") {
        // Permission was denied - user needs to manually enable in System Preferences
        return { granted: false, status: "denied", needsManualEnable: true };
      } else {
        return { granted: true, status: currentStatus };
      }
    }
    return { granted: true, status: "granted" };
  });

  // ============================================
  // Open System Preferences (macOS)
  // ============================================
  ipcMain.handle("meeting:openSystemPreferences", async (_event, type: "microphone" | "screen") => {
    if (process.platform === "darwin") {
      if (type === "microphone") {
        // Open Microphone preferences
        await shell.openExternal("x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone");
      } else if (type === "screen") {
        // Open Screen Recording preferences
        await shell.openExternal("x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture");
      }
      return { success: true };
    }
    return { success: false, reason: "Not macOS" };
  });

  // ============================================
  // Get Audio Sources (for system audio capture)
  // ============================================
  ipcMain.handle("meeting:getAudioSources", async () => {
    try {
      const sources = await desktopCapturer.getSources({
        types: ["screen", "window"],
        fetchWindowIcons: true,
      });

      return sources.map((source) => ({
        id: source.id,
        name: source.name,
        thumbnail: source.thumbnail?.toDataURL() || null,
      }));
    } catch (error) {
      log.error("[Meeting] Error getting audio sources:", error);
      throw error;
    }
  });

  // ============================================
  // Start Meeting Session
  // ============================================
  ipcMain.handle(
    "meeting:start",
    async (
      _event,
      data: {
        userId: string;
        threadId?: string;
        title?: string;
        audioSource?: "mic" | "system" | "both";
      }
    ) => {
      try {
        const db = getDatabase();
        const sessionId = randomUUID();

        log.info(`[Meeting] Starting session: ${sessionId}`);
        log.info(`[Meeting] Audio source: ${data.audioSource || "both"}`);

        // Create session in database
        const [session] = await db
          .insert(schema.MeetingSessionTable)
          .values({
            id: sessionId,
            userId: data.userId,
            threadId: data.threadId,
            title: data.title || null,
            status: "recording",
            audioSource: data.audioSource || "both",
            startedAt: new Date(),
            createdAt: new Date(),
            updatedAt: new Date(),
          })
          .returning();

        // Initialize session cache
        activeSessions.set(sessionId, {
          segments: [],
          accumulatedText: "",
          lastUpdateTime: Date.now(),
        });

        // Initialize Whisper service in background
        getWhisperService()
          .initialize()
          .catch((err) => {
            log.warn("[Meeting] Whisper pre-initialization failed:", err);
          });

        return {
          success: true,
          sessionId,
          session,
        };
      } catch (error) {
        log.error("[Meeting] Error starting session:", error);
        throw error;
      }
    }
  );

  // ============================================
  // Transcribe Audio Chunk
  // ============================================
  ipcMain.handle(
    "meeting:transcribeChunk",
    async (
      _event,
      data: {
        sessionId: string;
        audioData: number[]; // Float32Array as regular array (IPC serialization)
        sampleRate?: number;
        chunkStartTime?: number; // Time offset in seconds
      }
    ) => {
      try {
        const whisperService = getWhisperService();

        // Convert array back to Float32Array
        const audioBuffer = new Float32Array(data.audioData);

        log.info(
          `[Meeting] Transcribing chunk: ${audioBuffer.length} samples (${(audioBuffer.length / (data.sampleRate || 16000)).toFixed(1)}s)`
        );

        // Transcribe the audio chunk
        const result = await whisperService.transcribe(audioBuffer, {
          language: "en",
          returnTimestamps: true,
          chunkLengthS: 30,
          strideLengthS: 5,
        });

        // Update session cache if we have an active session
        const sessionCache = activeSessions.get(data.sessionId);
        if (sessionCache && result.text) {
          // Add segments with adjusted timestamps
          const chunkStartTime = data.chunkStartTime || 0;
          const adjustedChunks = (result.chunks || []).map((chunk) => ({
            timestamp: [
              chunk.timestamp[0] + chunkStartTime,
              chunk.timestamp[1] + chunkStartTime,
            ] as [number, number],
            text: chunk.text,
          }));

          sessionCache.segments.push(...adjustedChunks);
          sessionCache.accumulatedText += " " + result.text;
          sessionCache.lastUpdateTime = Date.now();

          // Periodically update database (every 30 seconds)
          const timeSinceLastDbUpdate =
            Date.now() - (sessionCache.lastUpdateTime || 0);
          if (timeSinceLastDbUpdate > 30000) {
            const db = getDatabase();
            await db
              .update(schema.MeetingSessionTable)
              .set({
                rawTranscript: sessionCache.accumulatedText.trim(),
                transcriptSegments: sessionCache.segments,
                updatedAt: new Date(),
              })
              .where(eq(schema.MeetingSessionTable.id, data.sessionId));
          }
        }

        return {
          success: true,
          text: result.text,
          chunks: result.chunks,
          language: result.language,
        };
      } catch (error) {
        log.error("[Meeting] Error transcribing chunk:", error);
        // Don't throw - return error so recording can continue
        return {
          success: false,
          text: "",
          error: error instanceof Error ? error.message : "Transcription failed",
        };
      }
    }
  );

  // ============================================
  // Stop Meeting Session
  // ============================================
  ipcMain.handle(
    "meeting:stop",
    async (
      _event,
      data: {
        sessionId: string;
      }
    ) => {
      try {
        const db = getDatabase();
        const sessionCache = activeSessions.get(data.sessionId);

        log.info(`[Meeting] Stopping session: ${data.sessionId}`);

        // Calculate duration
        const [session] = await db
          .select()
          .from(schema.MeetingSessionTable)
          .where(eq(schema.MeetingSessionTable.id, data.sessionId))
          .limit(1);

        if (!session) {
          throw new Error("Session not found");
        }

        const endedAt = new Date();
        const durationMs = endedAt.getTime() - session.startedAt!.getTime();

        // Get final transcript from cache
        const rawTranscript = sessionCache?.accumulatedText.trim() || "";
        const transcriptSegments = sessionCache?.segments || [];

        // Update session with final data
        await db
          .update(schema.MeetingSessionTable)
          .set({
            status: "processing",
            endedAt,
            durationMs,
            rawTranscript,
            transcriptSegments,
            updatedAt: new Date(),
          })
          .where(eq(schema.MeetingSessionTable.id, data.sessionId));

        // Clean up cache
        activeSessions.delete(data.sessionId);

        // Fetch updated session
        const [updatedSession] = await db
          .select()
          .from(schema.MeetingSessionTable)
          .where(eq(schema.MeetingSessionTable.id, data.sessionId))
          .limit(1);

        return {
          success: true,
          session: updatedSession,
          durationMs,
          rawTranscript,
          transcriptSegments,
        };
      } catch (error) {
        log.error("[Meeting] Error stopping session:", error);
        throw error;
      }
    }
  );

  // ============================================
  // Generate Meeting Summary
  // ============================================
  ipcMain.handle(
    "meeting:generateSummary",
    async (
      _event,
      data: {
        sessionId: string;
        transcript: string;
        duration: number;
        date: string;
      }
    ) => {
      // Note: This is just the data preparation - actual AI summarization
      // will be triggered from the renderer using the existing AI chat system
      // The renderer will send the transcript to the AI and receive the summary

      try {
        // Database instance available for future use
        void getDatabase();

        // Generate the summary prompt
        const summaryPrompt = generateSummaryPrompt(
          data.transcript,
          data.duration,
          data.date
        );

        return {
          success: true,
          prompt: summaryPrompt,
          sessionId: data.sessionId,
        };
      } catch (error) {
        log.error("[Meeting] Error preparing summary:", error);
        throw error;
      }
    }
  );

  // ============================================
  // Save Summary to Session
  // ============================================
  ipcMain.handle(
    "meeting:saveSummary",
    async (
      _event,
      data: {
        sessionId: string;
        summary: string;
        title?: string;
        keyPoints?: string[];
        actionItems?: Array<{
          id: string;
          description: string;
          assignee?: string;
        }>;
        attendees?: string[];
        decisions?: string[];
      }
    ) => {
      try {
        const db = getDatabase();

        log.info(`[Meeting] Saving summary for session: ${data.sessionId}`);

        await db
          .update(schema.MeetingSessionTable)
          .set({
            status: "completed",
            summary: data.summary,
            title: data.title,
            keyPoints: data.keyPoints,
            actionItems: data.actionItems,
            attendees: data.attendees,
            decisions: data.decisions,
            updatedAt: new Date(),
          })
          .where(eq(schema.MeetingSessionTable.id, data.sessionId));

        const [session] = await db
          .select()
          .from(schema.MeetingSessionTable)
          .where(eq(schema.MeetingSessionTable.id, data.sessionId))
          .limit(1);

        return {
          success: true,
          session,
        };
      } catch (error) {
        log.error("[Meeting] Error saving summary:", error);
        throw error;
      }
    }
  );

  // ============================================
  // Save to Knowledge Base
  // ============================================
  ipcMain.handle(
    "meeting:saveToKnowledge",
    async (
      _event,
      data: {
        sessionId: string;
        userId: string;
        knowledgeBaseId?: string;
      }
    ) => {
      try {
        const db = getDatabase();

        log.info(`[Meeting] Saving to knowledge base: ${data.sessionId}`);

        // Get the session
        const [session] = await db
          .select()
          .from(schema.MeetingSessionTable)
          .where(eq(schema.MeetingSessionTable.id, data.sessionId))
          .limit(1);

        if (!session || !session.summary) {
          throw new Error("Session not found or no summary available");
        }

        // Get or create "Meeting Notes" knowledge base
        let knowledgeBaseId = data.knowledgeBaseId;
        if (!knowledgeBaseId) {
          // Check if default Meeting Notes KB exists
          const [existingKB] = await db
            .select()
            .from(schema.KnowledgeBaseTable)
            .where(
              and(
                eq(schema.KnowledgeBaseTable.userId, data.userId),
                eq(schema.KnowledgeBaseTable.name, "Meeting Notes")
              )
            )
            .limit(1);

          if (existingKB) {
            knowledgeBaseId = existingKB.id;
          } else {
            // Create new knowledge base
            const [newKB] = await db
              .insert(schema.KnowledgeBaseTable)
              .values({
                name: "Meeting Notes",
                description:
                  "Automatically generated meeting summaries and transcripts",
                userId: data.userId,
                createdAt: new Date(),
                updatedAt: new Date(),
              })
              .returning();
            knowledgeBaseId = newKB.id;
          }
        }

        // Create markdown content
        const markdownContent = session.summary;
        const fileName = `meeting-${session.title?.replace(/[^a-z0-9]/gi, "-") || data.sessionId.slice(0, 8)}-${new Date().toISOString().split("T")[0]}.md`;

        // Save as file
        const userDataDir = app.getPath("userData");
        const documentsDir = path.join(
          userDataDir,
          "documents",
          data.userId,
          "meetings"
        );
        fs.ensureDirSync(documentsDir);
        const filePath = path.join(documentsDir, fileName);
        await fs.writeFile(filePath, markdownContent, "utf-8");

        // Create document record
        const documentId = randomUUID();
        await db.insert(schema.DocumentTable).values({
          id: documentId,
          knowledgeBaseId,
          userId: data.userId,
          fileName,
          fileType: "md",
          filePath,
          fileSize: Buffer.byteLength(markdownContent, "utf-8"),
          mimeType: "text/markdown",
          extractedText: markdownContent,
          status: "pending",
          createdAt: new Date(),
          updatedAt: new Date(),
        });

        // Chunk and embed the content
        const chunks = chunkText(markdownContent);
        const embeddingService = getEmbeddingService();
        await embeddingService.initialize();

        if (embeddingService.isAvailable()) {
          const vectorStore = getVectorStore();
          const embeddings = await embeddingService.embed(
            chunks.map((c) => c.content)
          );

          for (let i = 0; i < chunks.length; i++) {
            const chunk = chunks[i];
            const vectorId = `meeting_${documentId}_chunk_${i}`;

            // Save chunk to database
            await db.insert(schema.DocumentChunkTable).values({
              documentId,
              knowledgeBaseId,
              userId: data.userId,
              chunkIndex: i,
              content: chunk.content,
              startOffset: chunk.startOffset,
              endOffset: chunk.endOffset,
              vectorId,
              isIndexed: true,
              createdAt: new Date(),
            });

            // Save to vector store
            await vectorStore.insert("documents", [
              {
                id: vectorId,
                content: chunk.content,
                embedding: embeddings[i],
                thread_id: knowledgeBaseId,
                user_id: data.userId,
                metadata: {
                  documentId,
                  knowledgeBaseId,
                  sessionId: data.sessionId,
                  fileName,
                  chunkIndex: i,
                  type: "meeting_minutes",
                },
              },
            ]);
          }

          // Update document status
          await db
            .update(schema.DocumentTable)
            .set({
              status: "indexed",
              chunkCount: chunks.length,
              indexedAt: new Date(),
              updatedAt: new Date(),
            })
            .where(eq(schema.DocumentTable.id, documentId));
        }

        // Update session with document reference
        await db
          .update(schema.MeetingSessionTable)
          .set({
            documentId,
            knowledgeBaseId,
            updatedAt: new Date(),
          })
          .where(eq(schema.MeetingSessionTable.id, data.sessionId));

        // Update knowledge base counts
        await db
          .update(schema.KnowledgeBaseTable)
          .set({
            documentCount: await db
              .select()
              .from(schema.DocumentTable)
              .where(eq(schema.DocumentTable.knowledgeBaseId, knowledgeBaseId))
              .then((docs) => docs.length),
            totalChunks: await db
              .select()
              .from(schema.DocumentChunkTable)
              .where(
                eq(schema.DocumentChunkTable.knowledgeBaseId, knowledgeBaseId)
              )
              .then((chunks) => chunks.length),
            updatedAt: new Date(),
          })
          .where(eq(schema.KnowledgeBaseTable.id, knowledgeBaseId));

        return {
          success: true,
          documentId,
          knowledgeBaseId,
          filePath,
        };
      } catch (error) {
        log.error("[Meeting] Error saving to knowledge base:", error);
        throw error;
      }
    }
  );

  // ============================================
  // Get Sessions
  // ============================================
  ipcMain.handle(
    "meeting:getSessions",
    async (_event, data: { userId: string; limit?: number }) => {
      try {
        const db = getDatabase();

        const sessions = await db
          .select()
          .from(schema.MeetingSessionTable)
          .where(eq(schema.MeetingSessionTable.userId, data.userId))
          .orderBy(desc(schema.MeetingSessionTable.createdAt))
          .limit(data.limit || 50);

        return {
          success: true,
          sessions,
        };
      } catch (error) {
        log.error("[Meeting] Error getting sessions:", error);
        throw error;
      }
    }
  );

  // ============================================
  // Get Single Session
  // ============================================
  ipcMain.handle(
    "meeting:getSession",
    async (_event, data: { sessionId: string }) => {
      try {
        const db = getDatabase();

        const [session] = await db
          .select()
          .from(schema.MeetingSessionTable)
          .where(eq(schema.MeetingSessionTable.id, data.sessionId))
          .limit(1);

        return {
          success: true,
          session,
        };
      } catch (error) {
        log.error("[Meeting] Error getting session:", error);
        throw error;
      }
    }
  );

  // ============================================
  // Delete Session
  // ============================================
  ipcMain.handle(
    "meeting:deleteSession",
    async (_event, data: { sessionId: string }) => {
      try {
        const db = getDatabase();

        log.info(`[Meeting] Deleting session: ${data.sessionId}`);

        // Get session to find associated document
        const [session] = await db
          .select()
          .from(schema.MeetingSessionTable)
          .where(eq(schema.MeetingSessionTable.id, data.sessionId))
          .limit(1);

        if (session?.documentId) {
          // Delete document chunks
          await db
            .delete(schema.DocumentChunkTable)
            .where(eq(schema.DocumentChunkTable.documentId, session.documentId));

          // Delete document
          await db
            .delete(schema.DocumentTable)
            .where(eq(schema.DocumentTable.id, session.documentId));

          // Delete vectors
          // TODO: Implement vector store deletion by metadata
          void getVectorStore();
        }

        // Delete session
        await db
          .delete(schema.MeetingSessionTable)
          .where(eq(schema.MeetingSessionTable.id, data.sessionId));

        // Clean up cache if active
        activeSessions.delete(data.sessionId);

        return { success: true };
      } catch (error) {
        log.error("[Meeting] Error deleting session:", error);
        throw error;
      }
    }
  );

  // ============================================
  // Update Session Status (for error handling)
  // ============================================
  ipcMain.handle(
    "meeting:updateStatus",
    async (
      _event,
      data: {
        sessionId: string;
        status: "recording" | "processing" | "completed" | "failed";
        errorMessage?: string;
      }
    ) => {
      try {
        const db = getDatabase();

        await db
          .update(schema.MeetingSessionTable)
          .set({
            status: data.status,
            errorMessage: data.errorMessage,
            updatedAt: new Date(),
          })
          .where(eq(schema.MeetingSessionTable.id, data.sessionId));

        return { success: true };
      } catch (error) {
        log.error("[Meeting] Error updating status:", error);
        throw error;
      }
    }
  );

  log.info("[Meeting] IPC handlers registered successfully");
}

// ============================================
// Helper Functions
// ============================================

/**
 * Generate summary prompt for AI
 */
function generateSummaryPrompt(
  transcript: string,
  durationMs: number,
  date: string
): string {
  const durationFormatted = formatDuration(durationMs);

  return `You are an expert meeting note taker. Analyze this transcript and generate comprehensive meeting minutes.

**Transcript:**
${transcript}

**Meeting Date:** ${date}
**Duration:** ${durationFormatted}

**Instructions:**
1. Generate a concise, descriptive title for this meeting
2. Identify the main topics discussed
3. Extract key decisions and action items (with assignees if mentioned)
4. Note any attendees mentioned by name
5. Summarize in a clear, professional format

**Output Format (Markdown):**

# Meeting Summary: [Generated Title]

## Overview
[2-3 sentence summary of the meeting's purpose and outcome]

## Key Discussion Points
- [Point 1 with relevant details]
- [Point 2 with relevant details]
- [Additional points as needed]

## Action Items
- [ ] [Action item] - [Assignee if mentioned]
- [ ] [Action item] - [Assignee if mentioned]

## Decisions Made
- [Decision 1]
- [Decision 2]

## Attendees
- [Name/Speaker 1]
- [Name/Speaker 2]

## Transcript

${formatTranscript(transcript)}

---
*Meeting recorded on ${date}*
*Duration: ${durationFormatted}*`;
}

/**
 * Format duration in human-readable format
 */
function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
}

/**
 * Format transcript for display
 */
function formatTranscript(transcript: string): string {
  // Basic formatting - split by periods and add line breaks
  return transcript
    .split(". ")
    .filter((s) => s.trim())
    .map((s) => s.trim() + ".")
    .join("\n\n");
}

/**
 * Chunk text for vector storage
 */
function chunkText(
  text: string,
  chunkSize: number = 1000,
  overlap: number = 200
): Array<{ content: string; startOffset: number; endOffset: number }> {
  const chunks: Array<{
    content: string;
    startOffset: number;
    endOffset: number;
  }> = [];

  if (text.length <= chunkSize) {
    return [{ content: text, startOffset: 0, endOffset: text.length }];
  }

  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + chunkSize, text.length);

    // Try to break at sentence boundary
    if (end < text.length) {
      const lastPeriod = text.lastIndexOf(". ", end);
      if (lastPeriod > start + chunkSize * 0.5) {
        end = lastPeriod + 2;
      }
    }

    chunks.push({
      content: text.slice(start, end),
      startOffset: start,
      endOffset: end,
    });

    start = end - overlap;
    if (start >= text.length) break;
  }

  return chunks;
}

export default registerMeetingHandlers;
