"use client";

import { appStore } from "@/app/store";
import { authClient } from "@/lib/auth/client";
import { cn } from "@/lib/utils";
import {
  AlertTriangleIcon,
  CheckIcon,
  ChevronDownIcon,
  FileTextIcon,
  Loader2,
  MicIcon,
  MicOffIcon,
  MonitorIcon,
  PauseIcon,
  PlayIcon,
  SaveIcon,
  SettingsIcon,
  SquareIcon,
  XIcon,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "ui/button";
import { Drawer, DrawerContent, DrawerPortal, DrawerTitle } from "ui/drawer";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "ui/dropdown-menu";
import { ScrollArea } from "ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "ui/tooltip";
import { useShallow } from "zustand/shallow";
import { useMeetingMinutes } from "@/hooks/use-meeting-minutes";

interface PermissionStatus {
  microphone: string;
  screen: string;
  platform: string;
}

export function MeetingMinutesDrawer() {
  const [meetingMinutes, appStoreMutate] = appStore(
    useShallow((state) => [state.meetingMinutes, state.mutate])
  );

  const { data: session } = authClient.useSession();
  const transcriptEndRef = useRef<HTMLDivElement>(null);

  const {
    isRecording,
    isPaused,
    duration,
    transcript,
    status,
    error,
    summary,
    audioSource,
    setAudioSource,
    startRecording,
    stopRecording,
    pauseRecording,
    resumeRecording,
    saveToKnowledge,
  } = useMeetingMinutes();

  // Permission status
  const [permissions, setPermissions] = useState<PermissionStatus | null>(null);
  const [checkingPermissions, setCheckingPermissions] = useState(false);
  const [requestingPermissions, setRequestingPermissions] = useState(false);
  const hasRequestedRef = useRef(false);

  // Check and request permissions on mount and when drawer opens
  useEffect(() => {
    if (meetingMinutes.isOpen && !hasRequestedRef.current) {
      hasRequestedRef.current = true;
      requestPermissionsAutomatically();
    }
  }, [meetingMinutes.isOpen]);

  // Automatically request permissions via browser API (triggers macOS prompt)
  const requestPermissionsAutomatically = useCallback(async () => {
    setRequestingPermissions(true);
    console.log("[MeetingMinutes] Auto-requesting permissions...");

    try {
      // First check current status
      const currentPerms = await window.electronAPI?.meeting?.checkPermissions?.();
      console.log("[MeetingMinutes] Current permissions:", currentPerms);

      // Try to trigger microphone permission via getUserMedia
      // This is the ONLY way to trigger the macOS permission prompt
      if (currentPerms?.microphone !== "granted") {
        try {
          console.log("[MeetingMinutes] Requesting microphone via getUserMedia...");
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          // Got permission! Stop the stream immediately
          stream.getTracks().forEach(track => track.stop());
          console.log("[MeetingMinutes] Microphone permission granted!");
          toast.success("Microphone access granted");
        } catch (micErr) {
          console.log("[MeetingMinutes] Microphone request failed:", micErr);
          // This is expected if denied - will show the warning UI
        }
      }

      // Try to trigger screen recording permission via desktopCapturer
      if (currentPerms?.screen !== "granted") {
        try {
          console.log("[MeetingMinutes] Requesting screen recording...");
          const sources = await window.electronAPI?.meeting?.getAudioSources?.();
          if (sources && sources.length > 0) {
            // Try to access a screen source to trigger the permission prompt
            const screenSource = sources[0];
            const stream = await navigator.mediaDevices.getUserMedia({
              audio: false,
              video: {
                // @ts-ignore - Electron-specific
                mandatory: {
                  chromeMediaSource: "desktop",
                  chromeMediaSourceId: screenSource.id,
                  maxWidth: 1,
                  maxHeight: 1,
                },
              },
            });
            stream.getTracks().forEach(track => track.stop());
            console.log("[MeetingMinutes] Screen recording permission granted!");
            toast.success("Screen recording access granted");
          }
        } catch (screenErr) {
          console.log("[MeetingMinutes] Screen recording request failed:", screenErr);
          // Expected if denied
        }
      }

      // Re-check permissions after requests
      await checkPermissions();
    } catch (err) {
      console.error("[MeetingMinutes] Auto-request error:", err);
    } finally {
      setRequestingPermissions(false);
    }
  }, []);

  const checkPermissions = useCallback(async () => {
    if (!window.electronAPI?.meeting?.checkPermissions) return;

    setCheckingPermissions(true);
    try {
      const result = await window.electronAPI.meeting.checkPermissions();
      setPermissions(result);
      console.log("[MeetingMinutes] Permissions checked:", result);
    } catch (err) {
      console.error("[MeetingMinutes] Failed to check permissions:", err);
    } finally {
      setCheckingPermissions(false);
    }
  }, []);

  // Open system preferences helper
  const openSystemPreferences = useCallback(async (type: "microphone" | "screen") => {
    if (!window.electronAPI?.meeting?.openSystemPreferences) return;

    try {
      await window.electronAPI.meeting.openSystemPreferences(type);
      toast.info(`Opening ${type === "microphone" ? "Microphone" : "Screen Recording"} settings...`);
      // Re-check permissions after a delay
      setTimeout(() => checkPermissions(), 2000);
    } catch (err) {
      console.error("[MeetingMinutes] Failed to open system preferences:", err);
    }
  }, [checkPermissions]);

  // Check if we have required permissions
  const hasMicPermission = permissions?.microphone === "granted";
  const hasScreenPermission = permissions?.screen === "granted";
  const needsMicPermission = (audioSource === "mic" || audioSource === "both") && !hasMicPermission;
  const needsScreenPermission = (audioSource === "system" || audioSource === "both") && !hasScreenPermission;
  // hasRequiredPermissions computed but reserved for future use
  void (!needsMicPermission && !needsScreenPermission);

  // Auto-scroll transcript
  useEffect(() => {
    if (transcriptEndRef.current) {
      transcriptEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [transcript]);

  // Format duration as MM:SS
  const formatDuration = useCallback((ms: number) => {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  }, []);

  // Handle close
  const handleClose = useCallback(() => {
    if (isRecording) {
      toast.warning("Please stop recording before closing");
      return;
    }
    appStoreMutate((state) => ({
      meetingMinutes: {
        ...state.meetingMinutes,
        isOpen: false,
      },
    }));
  }, [isRecording, appStoreMutate]);

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && meetingMinutes.isOpen && !isRecording) {
        handleClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [meetingMinutes.isOpen, isRecording, handleClose]);

  // Handle start recording
  const handleStartRecording = useCallback(async () => {
    if (!session?.user?.id) {
      toast.error("Please sign in to use meeting minutes");
      return;
    }
    await startRecording(session?.user?.id);
  }, [session?.user?.id, startRecording]);

  // Handle stop recording
  const handleStopRecording = useCallback(async () => {
    await stopRecording();
  }, [stopRecording]);

  // Audio source options
  const audioSourceOptions = [
    { value: "mic" as const, label: "Microphone Only", icon: MicIcon },
    { value: "system" as const, label: "System Audio Only", icon: MonitorIcon },
    { value: "both" as const, label: "Both (Recommended)", icon: MicIcon },
  ];

  const selectedAudioSource = audioSourceOptions.find(
    (opt) => opt.value === audioSource
  );

  return (
    <Drawer dismissible={false} open={meetingMinutes.isOpen} direction="top">
      <DrawerPortal>
        <DrawerContent className="max-h-[100vh]! h-full border-none! rounded-none! flex flex-col bg-card">
          <div className="w-full h-full flex flex-col">
            {/* Header */}
            <div className="w-full flex items-center p-6 gap-4 border-b border-border">
              <div className="flex items-center gap-2">
                <FileTextIcon className="size-6 text-primary" />
                <DrawerTitle className="text-xl font-semibold">
                  Meeting Minutes
                </DrawerTitle>
              </div>

              <div className="ml-auto flex items-center gap-2">
                {/* Audio Source Selector */}
                {!isRecording && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="sm" className="gap-2">
                        {selectedAudioSource && (
                          <selectedAudioSource.icon className="size-4" />
                        )}
                        {selectedAudioSource?.label || "Select Audio Source"}
                        <ChevronDownIcon className="size-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {audioSourceOptions.map((option) => (
                        <DropdownMenuItem
                          key={option.value}
                          onClick={() => setAudioSource(option.value)}
                          className="gap-2"
                        >
                          <option.icon className="size-4" />
                          {option.label}
                          {audioSource === option.value && (
                            <CheckIcon className="size-4 ml-auto" />
                          )}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}

                {/* Close Button */}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={handleClose}
                      disabled={isRecording}
                    >
                      <XIcon className="size-5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Close</TooltipContent>
                </Tooltip>
              </div>
            </div>

            {/* Main Content Area */}
            <div className="flex-1 min-h-0 flex flex-col md:flex-row p-6 gap-6">
              {/* Left: Recording Controls & Status */}
              <div className="w-full md:w-1/3 flex flex-col items-center justify-center gap-6">
                {/* Recording Status Indicator */}
                <div className="flex flex-col items-center gap-4">
                  {/* Timer Display */}
                  <div
                    className={cn(
                      "text-6xl font-mono font-bold",
                      isRecording && !isPaused
                        ? "text-red-500 animate-pulse"
                        : "text-muted-foreground"
                    )}
                  >
                    {formatDuration(duration)}
                  </div>

                  {/* Status Badge */}
                  <div
                    className={cn(
                      "flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium",
                      status === "recording" && !isPaused
                        ? "bg-red-500/10 text-red-500"
                        : status === "processing"
                          ? "bg-yellow-500/10 text-yellow-500"
                          : status === "completed"
                            ? "bg-green-500/10 text-green-500"
                            : status === "error"
                              ? "bg-red-500/10 text-red-500"
                              : "bg-muted text-muted-foreground"
                    )}
                  >
                    {status === "recording" && !isPaused && (
                      <span className="size-2 rounded-full bg-red-500 animate-pulse" />
                    )}
                    {status === "processing" && (
                      <Loader2 className="size-4 animate-spin" />
                    )}
                    {status === "completed" && (
                      <CheckIcon className="size-4" />
                    )}
                    {status === "idle" && "Ready to Record"}
                    {status === "recording" &&
                      (isPaused ? "Paused" : "Recording...")}
                    {status === "processing" && "Generating Summary..."}
                    {status === "completed" && "Completed"}
                    {status === "error" && "Error"}
                  </div>

                  {error && (
                    <p className="text-sm text-red-500 text-center max-w-xs">
                      {error}
                    </p>
                  )}
                </div>

                {/* Permission Request in Progress */}
                {requestingPermissions && (
                  <div className="w-full max-w-sm bg-blue-500/10 border border-blue-500/30 rounded-lg p-4 flex items-center gap-3">
                    <Loader2 className="size-5 animate-spin text-blue-500" />
                    <span className="text-sm text-blue-400">Requesting permissions...</span>
                  </div>
                )}

                {/* Permission Warnings (macOS) */}
                {!requestingPermissions && permissions?.platform === "darwin" && !isRecording && (needsMicPermission || needsScreenPermission) && (
                  <div className="w-full max-w-sm bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4 space-y-3">
                    <div className="flex items-center gap-2 text-yellow-600 dark:text-yellow-400">
                      <AlertTriangleIcon className="size-5" />
                      <span className="font-medium text-sm">Permissions Required</span>
                    </div>
                    <div className="space-y-2">
                      {needsMicPermission && (
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 text-sm">
                            <MicOffIcon className="size-4 text-red-500" />
                            <span>Microphone: {permissions?.microphone || "unknown"}</span>
                          </div>
                          <Button
                            size="sm"
                            variant="outline"
                            className="gap-1 h-7 text-xs"
                            onClick={() => openSystemPreferences("microphone")}
                          >
                            <SettingsIcon className="size-3" />
                            Fix
                          </Button>
                        </div>
                      )}
                      {needsScreenPermission && (
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 text-sm">
                            <MonitorIcon className="size-4 text-red-500" />
                            <span>Screen Recording: {permissions?.screen || "unknown"}</span>
                          </div>
                          <Button
                            size="sm"
                            variant="outline"
                            className="gap-1 h-7 text-xs"
                            onClick={() => openSystemPreferences("screen")}
                          >
                            <SettingsIcon className="size-3" />
                            Fix
                          </Button>
                        </div>
                      )}
                    </div>
                    {typeof window !== "undefined" && window.location.hostname === "localhost" ? (
                      <div className="text-xs text-orange-400 bg-orange-500/10 rounded p-2 space-y-1">
                        <p className="font-semibold">⚠️ Development Mode Limitation</p>
                        <p>macOS doesn't grant permissions to unsigned dev builds. Options:</p>
                        <ul className="list-disc list-inside space-y-0.5 ml-1">
                          <li>Use the <strong>production app</strong> (run: pnpm build:mac)</li>
                          <li>Or run: <code className="bg-black/20 px-1 rounded">sudo tccutil reset Microphone</code></li>
                        </ul>
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        Click "Fix" to open System Settings. Enable Shadower for Microphone and Screen Recording.
                      </p>
                    )}
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1 text-xs"
                        onClick={() => requestPermissionsAutomatically()}
                        disabled={requestingPermissions}
                      >
                        {requestingPermissions ? <Loader2 className="size-3 animate-spin mr-1" /> : null}
                        Request Again
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="flex-1 text-xs"
                        onClick={checkPermissions}
                        disabled={checkingPermissions}
                      >
                        {checkingPermissions ? <Loader2 className="size-3 animate-spin mr-1" /> : null}
                        Re-check
                      </Button>
                    </div>
                  </div>
                )}

                {/* Recording Controls */}
                <div className="flex items-center gap-4">
                  {!isRecording ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          size="lg"
                          className="rounded-full size-16"
                          onClick={handleStartRecording}
                          disabled={status === "processing"}
                        >
                          <MicIcon className="size-8" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Start Recording</TooltipContent>
                    </Tooltip>
                  ) : (
                    <>
                      {/* Pause/Resume */}
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            size="lg"
                            variant="outline"
                            className="rounded-full size-14"
                            onClick={isPaused ? resumeRecording : pauseRecording}
                          >
                            {isPaused ? (
                              <PlayIcon className="size-6" />
                            ) : (
                              <PauseIcon className="size-6" />
                            )}
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          {isPaused ? "Resume" : "Pause"}
                        </TooltipContent>
                      </Tooltip>

                      {/* Stop */}
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            size="lg"
                            variant="destructive"
                            className="rounded-full size-16"
                            onClick={handleStopRecording}
                          >
                            <SquareIcon className="size-8 fill-current" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Stop Recording</TooltipContent>
                      </Tooltip>
                    </>
                  )}
                </div>

                {/* Action Buttons (after recording) */}
                {status === "completed" && (
                  <div className="flex flex-col gap-2 w-full max-w-xs">
                    <Button
                      onClick={() =>
                        session?.user?.id && saveToKnowledge(session?.user?.id)
                      }
                      className="w-full gap-2"
                    >
                      <SaveIcon className="size-4" />
                      Save to Knowledge Base
                    </Button>
                  </div>
                )}
              </div>

              {/* Right: Transcript & Summary */}
              <div className="flex-1 min-h-0 flex flex-col gap-4">
                {/* Live Transcript */}
                <div className="flex-1 min-h-0 flex flex-col border rounded-lg bg-muted/30">
                  <div className="flex items-center justify-between p-3 border-b">
                    <h3 className="font-semibold text-sm">Live Transcript</h3>
                    <span className="text-xs text-muted-foreground">
                      {transcript.length} segments
                    </span>
                  </div>
                  <ScrollArea className="flex-1 min-h-0 p-4">
                    <div className="space-y-3">
                      {transcript.length === 0 ? (
                        <p className="text-muted-foreground text-sm text-center py-8">
                          {isRecording
                            ? "Listening for speech..."
                            : "Start recording to see transcript"}
                        </p>
                      ) : (
                        transcript.map((segment, index) => (
                          <div
                            key={index}
                            className={cn(
                              "text-sm",
                              !segment.isFinal && "text-muted-foreground italic"
                            )}
                          >
                            <span className="text-xs text-muted-foreground font-mono mr-2">
                              [{formatTimestamp(segment.timestamp[0])}]
                            </span>
                            {segment.text}
                          </div>
                        ))
                      )}
                      <div ref={transcriptEndRef} />
                    </div>
                  </ScrollArea>
                </div>

                {/* Summary (when completed) */}
                {summary && (
                  <div className="flex flex-col border rounded-lg bg-muted/30 max-h-[40%]">
                    <div className="flex items-center justify-between p-3 border-b">
                      <h3 className="font-semibold text-sm">Meeting Summary</h3>
                    </div>
                    <ScrollArea className="flex-1 min-h-0 p-4">
                      <div className="prose prose-sm dark:prose-invert max-w-none">
                        <pre className="whitespace-pre-wrap font-sans text-sm">
                          {summary}
                        </pre>
                      </div>
                    </ScrollArea>
                  </div>
                )}
              </div>
            </div>
          </div>
        </DrawerContent>
      </DrawerPortal>
    </Drawer>
  );
}

// Helper function to format timestamp in seconds to MM:SS
function formatTimestamp(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
}

export default MeetingMinutesDrawer;
