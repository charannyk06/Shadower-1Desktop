/**
 * Session Browser Component
 * 
 * Lists and allows resuming past ACP sessions.
 * Implements P1 Gap #5 from ACP_GAP_ANALYSIS.md
 * 
 * Features:
 * - List past sessions with metadata
 * - Filter by agent, state, working directory
 * - Resume sessions with history replay
 * - Delete old sessions
 * - Session statistics
 */

"use client";

import  { useState, useEffect, useCallback } from "react";
import { formatDistanceToNow, format } from "date-fns";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  History,
  Search,
  FolderOpen,
  Clock,
  MessageSquare,
  Trash2,
  MoreVertical,
  RefreshCw,
  PlayCircle,
  CheckCircle2,
  XCircle,
  AlertCircle,
} from "lucide-react";

// Helper to get the Electron API safely
function getElectronAPI() {
  if (typeof window !== "undefined" && "electronAPI" in window) {
    return (window as unknown as { electronAPI?: { acp?: Record<string, (...args: unknown[]) => Promise<unknown>> } }).electronAPI;
  }
  return null;
}

// Types from the persistence service
export interface PersistedSession {
  id: number;
  sessionId: string;
  agentId: string;
  workingDirectory: string;
  threadId: string | null;
  title: string | null;
  state: "active" | "completed" | "error" | "abandoned";
  currentMode: string | null;
  createdAt: number;
  updatedAt: number;
  lastMessageAt: number | null;
  messageCount: number;
  tokenCount: number | null;
  metadata: string | null;
}

export interface SessionBrowserProps {
  /** Currently selected agent ID */
  agentId?: string;
  /** Current thread ID */
  threadId?: string;
  /** Current working directory */
  workingDirectory?: string;
  /** Callback when a session is selected to resume */
  onResume?: (session: PersistedSession) => void;
  /** Callback when a session is deleted */
  onDelete?: (sessionId: string) => void;
  /** Whether to show as dialog or inline */
  mode?: "dialog" | "inline";
  /** Custom class name */
  className?: string;
}

// Agent icons mapping
const AGENT_ICONS: Record<string, string> = {
  "claude-code": "🟣",
  "codex-cli": "🟢",
  "gemini-cli": "🔵",
};

// State icons mapping
const STATE_ICONS = {
  active: <RefreshCw className="h-4 w-4 text-blue-500 animate-spin" />,
  completed: <CheckCircle2 className="h-4 w-4 text-green-500" />,
  error: <XCircle className="h-4 w-4 text-red-500" />,
  abandoned: <AlertCircle className="h-4 w-4 text-yellow-500" />,
};

/**
 * Session card component
 */
function SessionCard({
  session,
  onResume,
  onDelete,
}: {
  session: PersistedSession;
  onResume?: () => void;
  onDelete?: () => void;
}) {
  const updatedAt = new Date(session.updatedAt);
  const createdAt = new Date(session.createdAt);
  
  return (
    <div className="p-4 border rounded-lg hover:bg-accent/50 transition-colors">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          {/* Title and status */}
          <div className="flex items-center gap-2 mb-1">
            <span className="text-lg">{AGENT_ICONS[session.agentId] || "🤖"}</span>
            <h4 className="font-medium truncate">
              {session.title || `Session ${session.sessionId.slice(0, 8)}...`}
            </h4>
            {STATE_ICONS[session.state]}
          </div>
          
          {/* Working directory */}
          <div className="flex items-center gap-1 text-sm text-muted-foreground mb-2">
            <FolderOpen className="h-3 w-3" />
            <span className="truncate">{session.workingDirectory}</span>
          </div>
          
          {/* Metadata */}
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {formatDistanceToNow(updatedAt, { addSuffix: true })}
            </span>
            <span className="flex items-center gap-1">
              <MessageSquare className="h-3 w-3" />
              {session.messageCount} messages
            </span>
            {session.tokenCount && (
              <span className="flex items-center gap-1">
                ~{Math.round(session.tokenCount / 1000)}k tokens
              </span>
            )}
          </div>
        </div>
        
        {/* Actions */}
        <div className="flex items-center gap-2">
          {session.state !== "active" && onResume && (
            <Button
              variant="outline"
              size="sm"
              onClick={onResume}
              className="gap-1"
            >
              <PlayCircle className="h-4 w-4" />
              Resume
            </Button>
          )}
          
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onResume} disabled={session.state === "active"}>
                <PlayCircle className="h-4 w-4 mr-2" />
                Resume Session
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={onDelete}
                className="text-destructive focus:text-destructive"
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Delete Session
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  );
}

/**
 * Session Browser Component
 */
export function SessionBrowser({
  agentId,
  threadId,
  workingDirectory,
  onResume,
  onDelete,
  mode = "inline",
  className,
}: SessionBrowserProps) {
  const [sessions, setSessions] = useState<PersistedSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [stateFilter, setStateFilter] = useState<string>("all");
  const [agentFilter, setAgentFilter] = useState<string>(agentId || "all");
  const [isOpen, setIsOpen] = useState(false);
  
  // Fetch sessions from persistence
  const fetchSessions = useCallback(async () => {
    setLoading(true);
    try {
      // Call IPC to get sessions from SQLite
      const api = getElectronAPI()?.acp as { getPersistedSessions?: (opts: Record<string, unknown>) => Promise<PersistedSession[]> } | undefined;
      if (api?.getPersistedSessions) {
        const result = await api.getPersistedSessions({
          agentId: agentFilter !== "all" ? agentFilter : undefined,
          threadId,
          state: stateFilter !== "all" ? stateFilter : undefined,
          workingDirectory,
          limit: 50,
        });
        setSessions(result || []);
      }
    } catch (error) {
      console.error("[SessionBrowser] Failed to fetch sessions:", error);
    } finally {
      setLoading(false);
    }
  }, [agentFilter, stateFilter, threadId, workingDirectory]);
  
  // Fetch on mount and filter changes
  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);
  
  // Filter sessions by search query
  const filteredSessions = sessions.filter((session) => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      session.title?.toLowerCase().includes(query) ||
      session.sessionId.toLowerCase().includes(query) ||
      session.workingDirectory.toLowerCase().includes(query) ||
      session.agentId.toLowerCase().includes(query)
    );
  });
  
  // Handle resume
  const handleResume = useCallback((session: PersistedSession) => {
    onResume?.(session);
    setIsOpen(false);
  }, [onResume]);
  
  // Handle delete
  const handleDelete = useCallback(async (sessionId: string) => {
    try {
      const api = getElectronAPI()?.acp as { deletePersistedSession?: (id: string) => Promise<void> } | undefined;
      if (api?.deletePersistedSession) {
        await api.deletePersistedSession(sessionId);
        setSessions((prev) => prev.filter((s) => s.sessionId !== sessionId));
        onDelete?.(sessionId);
      }
    } catch (error) {
      console.error("[SessionBrowser] Failed to delete session:", error);
    }
  }, [onDelete]);
  
  // Content component
  const content = (
    <div className={cn("flex flex-col h-full", className)}>
      {/* Search and filters */}
      <div className="flex flex-col gap-3 p-4 border-b">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search sessions..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          <Button variant="outline" size="icon" onClick={fetchSessions}>
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          </Button>
        </div>
        
        <div className="flex items-center gap-2">
          <Select value={stateFilter} onValueChange={setStateFilter}>
            <SelectTrigger className="w-[140px]">
              <SelectValue placeholder="State" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All States</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="error">Error</SelectItem>
              <SelectItem value="abandoned">Abandoned</SelectItem>
            </SelectContent>
          </Select>
          
          <Select value={agentFilter} onValueChange={setAgentFilter}>
            <SelectTrigger className="w-[140px]">
              <SelectValue placeholder="Agent" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Agents</SelectItem>
              <SelectItem value="claude-code">Claude Code</SelectItem>
              <SelectItem value="codex-cli">Codex CLI</SelectItem>
              <SelectItem value="gemini-cli">Gemini CLI</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      
      {/* Sessions list */}
      <ScrollArea className="flex-1">
        <div className="p-4 space-y-3">
          {loading ? (
            <div className="text-center py-8 text-muted-foreground">
              <RefreshCw className="h-6 w-6 animate-spin mx-auto mb-2" />
              Loading sessions...
            </div>
          ) : filteredSessions.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <History className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p>No sessions found</p>
              <p className="text-sm">
                Start a conversation to create a session
              </p>
            </div>
          ) : (
            filteredSessions.map((session) => (
              <SessionCard
                key={session.sessionId}
                session={session}
                onResume={() => handleResume(session)}
                onDelete={() => handleDelete(session.sessionId)}
              />
            ))
          )}
        </div>
      </ScrollArea>
      
      {/* Footer with stats */}
      <div className="p-3 border-t text-xs text-muted-foreground">
        {filteredSessions.length} session{filteredSessions.length !== 1 ? "s" : ""} •{" "}
        {sessions.filter((s) => s.state === "active").length} active •{" "}
        {sessions.reduce((acc, s) => acc + s.messageCount, 0)} total messages
      </div>
    </div>
  );
  
  // Dialog mode
  if (mode === "dialog") {
    return (
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogTrigger asChild>
          <Button variant="outline" size="sm" className="gap-2">
            <History className="h-4 w-4" />
            Session History
          </Button>
        </DialogTrigger>
        <DialogContent className="max-w-2xl h-[600px] p-0 flex flex-col">
          <DialogHeader className="p-4 pb-0">
            <DialogTitle className="flex items-center gap-2">
              <History className="h-5 w-5" />
              Session History
            </DialogTitle>
            <DialogDescription>
              Browse and resume past coding sessions
            </DialogDescription>
          </DialogHeader>
          {content}
        </DialogContent>
      </Dialog>
    );
  }
  
  // Inline mode
  return content;
}

export default SessionBrowser;

/**
 * Hook for session persistence operations
 */
export function useSessionPersistence() {
  const [stats, setStats] = useState<{
    total: number;
    active: number;
    completed: number;
    error: number;
  } | null>(null);
  
  const fetchStats = useCallback(async () => {
    // TODO: Implement get-session-stats IPC handler
    // For now, stats are not fetched
    setStats(null);
  }, []);
  
  const saveSession = useCallback(async (
    _session: {
      sessionId: string;
      agentId: string;
      workingDirectory: string;
    },
    _threadId?: string,
    _title?: string
  ) => {
    // Session saving is handled automatically by the ACP service
    // This is a no-op placeholder for manual saves
  }, []);
  
  const updateSessionState = useCallback(async (sessionId: string, state: string) => {
    try {
      const api = getElectronAPI()?.acp as { updateSessionState?: (id: string, st: string) => Promise<void> } | undefined;
      if (api?.updateSessionState) {
        await api.updateSessionState(sessionId, state);
      }
    } catch (error) {
      console.error("[useSessionPersistence] Failed to update session state:", error);
    }
  }, []);
  
  const setAutoResume = useCallback(async (
    _threadId: string,
    _sessionId: string,
    _agentId: string,
    _shouldResume: boolean
  ) => {
    // TODO: Implement auto-resume IPC handler
    // For now, auto-resume is not set
  }, []);
  
  const getAutoResumeSession = useCallback(async (_threadId: string) => {
    // TODO: Implement auto-resume session lookup
    return null;
  }, []);
  
  const cleanupOldSessions = useCallback(async (_olderThanDays: number = 30) => {
    // TODO: Implement cleanup-old-sessions IPC handler
    return 0;
  }, []);
  
  useEffect(() => {
    fetchStats();
  }, [fetchStats]);
  
  return {
    stats,
    fetchStats,
    saveSession,
    updateSessionState,
    setAutoResume,
    getAutoResumeSession,
    cleanupOldSessions,
  };
}
