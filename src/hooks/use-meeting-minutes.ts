/**
 * Meeting Minutes Hook
 *
 * Handles audio capture (mic + system), local transcription via Whisper,
 * AI summarization, and knowledge base integration.
 */

import { appStore } from "@/app/store";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useShallow } from "zustand/shallow";

export type AudioSource = "mic" | "system" | "both";

export interface TranscriptSegment {
  timestamp: [number, number];
  text: string;
  isFinal: boolean;
}

export interface UseMeetingMinutesReturn {
  isRecording: boolean;
  isPaused: boolean;
  duration: number;
  transcript: TranscriptSegment[];
  status: "idle" | "recording" | "processing" | "completed" | "error";
  error: string | null;
  summary: string | null;
  audioSource: AudioSource;
  sessionId: string | null;
  setAudioSource: (source: AudioSource) => void;
  startRecording: (userId: string) => Promise<void>;
  stopRecording: () => Promise<void>;
  pauseRecording: () => void;
  resumeRecording: () => void;
  generateSummary: () => Promise<void>;
  saveToKnowledge: (userId: string, knowledgeBaseId?: string) => Promise<void>;
  reset: () => void;
}

export function useMeetingMinutes(): UseMeetingMinutesReturn {
  const [meetingMinutes, appStoreMutate] = appStore(
    useShallow((state) => [state.meetingMinutes, state.mutate])
  );

  // Local state
  // Default to "mic" since system audio requires screen recording permission
  // which doesn't work in development mode on macOS
  const [audioSource, setAudioSourceState] = useState<AudioSource>(
    meetingMinutes.audioSource || "mic"
  );
  const [sessionId, setSessionId] = useState<string | null>(
    meetingMinutes.sessionId
  );
  const [transcript, setTranscript] = useState<TranscriptSegment[]>(
    meetingMinutes.transcript || []
  );
  const [summary, setSummary] = useState<string | null>(
    meetingMinutes.summary || null
  );

  // Refs for audio handling
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamsRef = useRef<MediaStream[]>([]);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const audioBufferRef = useRef<Float32Array[]>([]);
  const recordingStartTimeRef = useRef<number>(0);
  const durationIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const chunkStartTimeRef = useRef<number>(0);

  // Sync state with store
  const updateStore = useCallback(
    (updates: Partial<typeof meetingMinutes>) => {
      appStoreMutate((state) => ({
        meetingMinutes: {
          ...state.meetingMinutes,
          ...updates,
        },
      }));
    },
    [appStoreMutate]
  );

  // Set audio source
  const setAudioSource = useCallback(
    (source: AudioSource) => {
      setAudioSourceState(source);
      updateStore({ audioSource: source });
    },
    [updateStore]
  );

  // Start duration timer
  const startDurationTimer = useCallback(() => {
    recordingStartTimeRef.current = Date.now();
    durationIntervalRef.current = setInterval(() => {
      const elapsed = Date.now() - recordingStartTimeRef.current;
      updateStore({ duration: elapsed });
    }, 100);
  }, [updateStore]);

  // Stop duration timer
  const stopDurationTimer = useCallback(() => {
    if (durationIntervalRef.current) {
      clearInterval(durationIntervalRef.current);
      durationIntervalRef.current = null;
    }
  }, []);

  // Merge audio buffers
  const mergeAudioBuffers = useCallback(
    (buffers: Float32Array[]): Float32Array => {
      const totalLength = buffers.reduce((acc, buf) => acc + buf.length, 0);
      const result = new Float32Array(totalLength);
      let offset = 0;
      for (const buffer of buffers) {
        result.set(buffer, offset);
        offset += buffer.length;
      }
      return result;
    },
    []
  );

  // Send audio chunk for transcription
  const sendForTranscription = useCallback(
    async (audioData: Float32Array, chunkStartTime: number) => {
      if (!sessionId) return;

      try {
        const result = await window.electronAPI.meeting.transcribeChunk({
          sessionId,
          audioData: Array.from(audioData),
          sampleRate: 16000,
          chunkStartTime,
        });

        if (result.success && result.text) {
          const newSegments: TranscriptSegment[] = (result.chunks || []).map(
            (chunk: { timestamp: [number, number]; text: string }) => ({
              timestamp: chunk.timestamp,
              text: chunk.text,
              isFinal: true,
            })
          );

          if (newSegments.length === 0 && result.text) {
            newSegments.push({
              timestamp: [chunkStartTime, chunkStartTime + 5],
              text: result.text,
              isFinal: true,
            });
          }

          setTranscript((prev) => [...prev, ...newSegments]);
          updateStore({
            transcript: [...transcript, ...newSegments],
          });
        }
      } catch (error) {
        console.error("[MeetingMinutes] Transcription error:", error);
        // Don't stop recording on transcription errors
      }
    },
    [sessionId, transcript, updateStore]
  );

  // Start recording
  const startRecording = useCallback(
    async (userId: string) => {
      try {
        // Pre-flight permission check (macOS)
        const permissions = await window.electronAPI.meeting.checkPermissions();

        if (permissions.platform === "darwin") {
          const needsMic = audioSource === "mic" || audioSource === "both";
          const needsScreen = audioSource === "system" || audioSource === "both";

          // Check microphone permission
          if (needsMic && permissions.microphone !== "granted") {
            if (permissions.microphone === "denied") {
              // Permission was previously denied - try to request again (might have been reset)
              const permResult = await window.electronAPI.meeting.requestMicrophonePermission();

              if (!permResult.granted) {
                // Still denied - guide user to fix it
                const isDevMode = window.location.hostname === "localhost";

                if (isDevMode) {
                  toast.error(
                    "Microphone permission denied. Development builds on macOS have limited permission support. Try using the production app (Shadower.app) or run: sudo tccutil reset Microphone",
                    { duration: 10000 }
                  );
                } else {
                  toast.error(
                    "Microphone permission denied. Click to open System Settings.",
                    {
                      duration: 8000,
                      action: {
                        label: "Open Settings",
                        onClick: () => window.electronAPI.meeting.openSystemPreferences("microphone"),
                      },
                    }
                  );
                }

                throw new Error("Microphone permission denied. Please grant permission in System Settings > Privacy & Security > Microphone.");
              }
            }
          }

          // Check screen recording permission (only warn, don't block - user might want mic-only fallback)
          if (needsScreen && permissions.screen !== "granted") {
            const isDevMode = window.location.hostname === "localhost";

            if (audioSource === "system") {
              if (isDevMode) {
                throw new Error(
                  "System audio requires Screen Recording permission, which doesn't work in development builds. Please use 'Microphone Only' mode or the production app."
                );
              } else {
                toast.error(
                  "Screen Recording permission required for system audio. Click to open System Settings.",
                  {
                    duration: 8000,
                    action: {
                      label: "Open Settings",
                      onClick: () => window.electronAPI.meeting.openSystemPreferences("screen"),
                    },
                  }
                );
                throw new Error("Screen Recording permission denied.");
              }
            } else {
              // For "both" mode, just warn and continue with mic-only
              toast.warning(
                "System audio unavailable (Screen Recording permission required). Recording microphone only."
              );
            }
          }
        }

        updateStore({
          isRecording: true,
          isPaused: false,
          status: "recording",
          error: null,
          duration: 0,
          transcript: [],
          summary: null,
        });
        setTranscript([]);
        setSummary(null);

        // Create session
        const session = await window.electronAPI.meeting.start({
          userId,
          audioSource,
        });

        if (!session.success) {
          throw new Error("Failed to create meeting session");
        }

        setSessionId(session.sessionId);
        updateStore({ sessionId: session.sessionId });

        // Create audio context
        const audioContext = new AudioContext({ sampleRate: 16000 });
        audioContextRef.current = audioContext;

        const streams: MediaStream[] = [];

        // Capture microphone
        if (audioSource === "mic" || audioSource === "both") {
          try {
            const micStream = await navigator.mediaDevices.getUserMedia({
              audio: {
                echoCancellation: true,
                noiseSuppression: true,
                sampleRate: 16000,
              },
            });
            streams.push(micStream);
            toast.success("Microphone connected");
          } catch (err) {
            console.error("[MeetingMinutes] Microphone access denied:", err);
            const errorMsg = err instanceof Error ? err.message : String(err);

            // Provide helpful guidance for macOS permissions
            if (errorMsg.includes("Permission denied") || errorMsg.includes("NotAllowedError")) {
              toast.error(
                "Microphone permission required. Go to System Settings > Privacy & Security > Microphone and enable Shadower (or Electron for dev builds).",
                { duration: 8000 }
              );
            }

            if (audioSource === "mic") {
              throw new Error(
                "Microphone access denied. Please enable Microphone permission in System Settings > Privacy & Security > Microphone."
              );
            }
            toast.warning("Microphone unavailable, trying system audio only");
          }
        }

        // Capture system audio using Electron's desktopCapturer
        if (audioSource === "system" || audioSource === "both") {
          try {
            // Get available audio sources from main process
            let sources: { id: string; name: string }[] = [];
            try {
              sources = await window.electronAPI.meeting.getAudioSources();
            } catch (sourceErr) {
              // Screen recording permission denied - this is common in dev mode on macOS
              console.warn("[MeetingMinutes] getAudioSources failed (screen recording permission needed):", sourceErr);

              if (audioSource === "system") {
                throw new Error(
                  "System audio requires Screen Recording permission. In development mode on macOS, this may not work. Use the production build (Shadower.app from /dist) or switch to Microphone Only mode."
                );
              }
              // For "both" mode, fallback to mic-only
              toast.warning("System audio unavailable (screen recording permission required). Using microphone only.");
              sources = []; // Continue without system audio
            }

            if (sources && sources.length > 0) {
              // Find entire screen source (best for capturing all system audio)
              const screenSource = sources.find((s: { name: string }) =>
                s.name === "Entire Screen" || s.name.includes("Screen")
              ) || sources[0];

              // Use Electron's special getUserMedia constraint for desktop audio
              const systemStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                  // @ts-ignore - Electron-specific constraints
                  mandatory: {
                    chromeMediaSource: "desktop",
                    chromeMediaSourceId: screenSource.id,
                  },
                },
                video: {
                  // @ts-ignore - Electron-specific constraints
                  mandatory: {
                    chromeMediaSource: "desktop",
                    chromeMediaSourceId: screenSource.id,
                    maxWidth: 1,
                    maxHeight: 1,
                  },
                },
              });

              // Extract only audio track
              const audioTrack = systemStream.getAudioTracks()[0];
              if (audioTrack) {
                const audioOnlyStream = new MediaStream([audioTrack]);
                streams.push(audioOnlyStream);
                toast.success("System audio connected");

                // Stop video track (we only need audio)
                systemStream.getVideoTracks().forEach((t) => t.stop());
              } else {
                toast.warning("No system audio track available");
              }
            } else {
              toast.warning("No audio sources found for system audio");
            }
          } catch (err) {
            console.error("[MeetingMinutes] System audio access denied:", err);
            const errorMsg = err instanceof Error ? err.message : String(err);

            // Check if it's a permission issue on macOS
            if (errorMsg.includes("permission") || errorMsg.includes("denied")) {
              toast.error(
                "Screen Recording permission required. Go to System Settings > Privacy & Security > Screen Recording and enable Shadower.",
                { duration: 8000 }
              );
            }

            if (audioSource === "system") {
              throw new Error(
                "System audio access denied. Please allow Screen Recording permission in System Settings."
              );
            }
            toast.warning("System audio unavailable, using microphone only");
          }
        }

        if (streams.length === 0) {
          throw new Error("No audio sources available");
        }

        mediaStreamsRef.current = streams;

        // Merge streams using Web Audio API
        let combinedSource: AudioNode;

        if (streams.length === 1) {
          combinedSource = audioContext.createMediaStreamSource(streams[0]);
        } else {
          const merger = audioContext.createChannelMerger(streams.length);
          streams.forEach((stream, index) => {
            const source = audioContext.createMediaStreamSource(stream);
            source.connect(merger, 0, Math.min(index, 1));
          });
          combinedSource = merger;
        }

        // Create processor for audio chunks
        const processor = audioContext.createScriptProcessor(4096, 1, 1);
        processorRef.current = processor;
        audioBufferRef.current = [];
        chunkStartTimeRef.current = 0;

        let chunkSamples = 0;
        const CHUNK_DURATION_SAMPLES = 16000 * 5; // 5 seconds at 16kHz

        processor.onaudioprocess = (e) => {
          if (meetingMinutes.isPaused) return;

          const samples = e.inputBuffer.getChannelData(0);
          audioBufferRef.current.push(new Float32Array(samples));
          chunkSamples += samples.length;

          // Every 5 seconds, send chunk for transcription
          if (chunkSamples >= CHUNK_DURATION_SAMPLES) {
            const chunk = mergeAudioBuffers(audioBufferRef.current);
            const chunkStartTime = chunkStartTimeRef.current;
            chunkStartTimeRef.current += chunkSamples / 16000;

            sendForTranscription(chunk, chunkStartTime);

            audioBufferRef.current = [];
            chunkSamples = 0;
          }
        };

        combinedSource.connect(processor);
        processor.connect(audioContext.destination);

        // Start duration timer
        startDurationTimer();

        toast.success("Recording started");
      } catch (error) {
        console.error("[MeetingMinutes] Error starting recording:", error);
        const errorMessage =
          error instanceof Error ? error.message : "Failed to start recording";
        updateStore({
          isRecording: false,
          status: "error",
          error: errorMessage,
        });
        toast.error(errorMessage);
      }
    },
    [
      audioSource,
      mergeAudioBuffers,
      sendForTranscription,
      startDurationTimer,
      updateStore,
      meetingMinutes.isPaused,
    ]
  );

  // Stop recording
  const stopRecording = useCallback(async () => {
    try {
      console.log("[MeetingMinutes] Stopping recording...");

      // Stop timer first
      stopDurationTimer();

      // Stop audio processing safely
      if (processorRef.current) {
        try {
          processorRef.current.disconnect();
        } catch (e) {
          console.warn("[MeetingMinutes] Processor disconnect warning:", e);
        }
        processorRef.current = null;
      }

      // Stop media streams safely
      if (mediaStreamsRef.current.length > 0) {
        mediaStreamsRef.current.forEach((stream) => {
          try {
            stream.getTracks().forEach((track) => track.stop());
          } catch (e) {
            console.warn("[MeetingMinutes] Track stop warning:", e);
          }
        });
        mediaStreamsRef.current = [];
      }

      // Close audio context safely
      if (audioContextRef.current) {
        try {
          if (audioContextRef.current.state !== "closed") {
            await audioContextRef.current.close();
          }
        } catch (e) {
          console.warn("[MeetingMinutes] AudioContext close warning:", e);
        }
        audioContextRef.current = null;
      }

      // Process any remaining audio (only if we have data)
      if (audioBufferRef.current.length > 0 && sessionId) {
        try {
          const chunk = mergeAudioBuffers(audioBufferRef.current);
          await sendForTranscription(chunk, chunkStartTimeRef.current);
        } catch (e) {
          console.warn("[MeetingMinutes] Final transcription warning:", e);
        }
        audioBufferRef.current = [];
      }

      // Stop session on backend
      if (sessionId) {
        console.log("[MeetingMinutes] Stopping session:", sessionId);
        const result = await window.electronAPI.meeting.stop({ sessionId });

        if (result.success) {
          updateStore({
            isRecording: false,
            isPaused: false,
            status: result.rawTranscript ? "processing" : "completed",
          });

          // Generate summary if we have transcript
          if (result.rawTranscript) {
            // Inline summary generation to avoid stale closure
            const durationMs = result.durationMs || 0;
            const summaryText = `# Meeting Summary

## Overview
Meeting recorded on ${new Date().toLocaleDateString()} for ${Math.floor(durationMs / 60000)}m ${Math.floor((durationMs % 60000) / 1000)}s.

## Transcript
${result.rawTranscript}

---
*Generated automatically by Meeting Minutes*`;

            setSummary(summaryText);
            updateStore({ summary: summaryText, status: "completed" });

            // Save to backend
            try {
              await window.electronAPI.meeting.saveSummary({
                sessionId,
                summary: summaryText,
                title: `Meeting - ${new Date().toLocaleDateString()}`,
              });
              toast.success("Meeting saved!");
            } catch (saveErr) {
              console.error("[MeetingMinutes] Save summary error:", saveErr);
            }
          } else {
            updateStore({ status: "completed" });
          }
        } else {
          updateStore({
            isRecording: false,
            isPaused: false,
            status: "completed",
          });
        }
      } else {
        // No session - just clean up
        updateStore({
          isRecording: false,
          isPaused: false,
          status: "idle",
        });
      }

      toast.success("Recording stopped");
    } catch (error) {
      console.error("[MeetingMinutes] Error stopping recording:", error);
      // Always reset recording state even on error
      updateStore({
        isRecording: false,
        isPaused: false,
        status: "error",
        error: error instanceof Error ? error.message : "Failed to stop recording",
      });
      toast.error("Error stopping recording");
    }
  }, [
    sessionId,
    stopDurationTimer,
    mergeAudioBuffers,
    sendForTranscription,
    updateStore,
  ]);

  // Generate summary internally
  const generateSummaryInternal = useCallback(
    async (rawTranscript: string, durationMs: number) => {
      if (!sessionId || !rawTranscript) {
        updateStore({ status: "completed" });
        return;
      }

      try {
        updateStore({ status: "processing" });

        // Get summary prompt from backend
        const result = await window.electronAPI.meeting.generateSummary({
          sessionId,
          transcript: rawTranscript,
          duration: durationMs,
          date: new Date().toLocaleDateString(),
        });

        if (result.success) {
          // For now, we'll use the prompt as a placeholder for the summary
          // In a full implementation, this would be sent to the AI chat system
          const summaryText = `# Meeting Summary

## Overview
Meeting recorded on ${new Date().toLocaleDateString()} for ${formatDuration(durationMs)}.

## Transcript
${rawTranscript}

---
*Generated automatically by Meeting Minutes*`;

          setSummary(summaryText);
          updateStore({ summary: summaryText });

          // Save summary to backend
          await window.electronAPI.meeting.saveSummary({
            sessionId,
            summary: summaryText,
            title: `Meeting - ${new Date().toLocaleDateString()}`,
          });

          updateStore({ status: "completed" });
          toast.success("Summary generated!");
        }
      } catch (error) {
        console.error("[MeetingMinutes] Error generating summary:", error);
        updateStore({
          status: "error",
          error:
            error instanceof Error ? error.message : "Failed to generate summary",
        });
      }
    },
    [sessionId, updateStore]
  );

  // Public generate summary (for retry)
  const generateSummary = useCallback(async () => {
    if (!sessionId) return;
    const fullTranscript = transcript.map((s) => s.text).join(" ");
    await generateSummaryInternal(fullTranscript, meetingMinutes.duration);
  }, [sessionId, transcript, meetingMinutes.duration, generateSummaryInternal]);

  // Pause recording
  const pauseRecording = useCallback(() => {
    updateStore({ isPaused: true });
    stopDurationTimer();
    toast.info("Recording paused");
  }, [updateStore, stopDurationTimer]);

  // Resume recording
  const resumeRecording = useCallback(() => {
    updateStore({ isPaused: false });
    startDurationTimer();
    toast.info("Recording resumed");
  }, [updateStore, startDurationTimer]);

  // Save to knowledge base
  const saveToKnowledge = useCallback(
    async (userId: string, knowledgeBaseId?: string) => {
      if (!sessionId) {
        toast.error("No session to save");
        return;
      }

      try {
        const result = await window.electronAPI.meeting.saveToKnowledge({
          sessionId,
          userId,
          knowledgeBaseId,
        });

        if (result.success) {
          toast.success("Saved to knowledge base!");
        } else {
          throw new Error("Failed to save");
        }
      } catch (error) {
        console.error("[MeetingMinutes] Error saving to knowledge:", error);
        toast.error("Failed to save to knowledge base");
      }
    },
    [sessionId]
  );

  // Reset state
  const reset = useCallback(() => {
    setTranscript([]);
    setSummary(null);
    setSessionId(null);
    updateStore({
      isRecording: false,
      isPaused: false,
      sessionId: null,
      duration: 0,
      transcript: [],
      status: "idle",
      error: null,
      summary: null,
    });
  }, [updateStore]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopDurationTimer();
      if (processorRef.current) {
        processorRef.current.disconnect();
      }
      mediaStreamsRef.current.forEach((stream) => {
        stream.getTracks().forEach((track) => track.stop());
      });
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
    };
  }, [stopDurationTimer]);

  return {
    isRecording: meetingMinutes.isRecording,
    isPaused: meetingMinutes.isPaused,
    duration: meetingMinutes.duration,
    transcript,
    status: meetingMinutes.status,
    error: meetingMinutes.error,
    summary,
    audioSource,
    sessionId,
    setAudioSource,
    startRecording,
    stopRecording,
    pauseRecording,
    resumeRecording,
    generateSummary,
    saveToKnowledge,
    reset,
  };
}

// Helper function
function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
}

export default useMeetingMinutes;
