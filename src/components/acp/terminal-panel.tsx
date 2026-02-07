/**
 * Terminal Panel Component
 * 
 * Provides an interactive terminal using xterm.js for ACP agent output.
 * Implements P0 Gap #2 from ACP_GAP_ANALYSIS.md
 * 
 * Features:
 * - xterm.js integration for terminal rendering
 * - Auto-fit to container size
 * - Web links clickable
 * - Search functionality
 * - Terminal history scrollback
 * - Theme support (dark/light)
 */

"use client";

import React, { useEffect, useRef, useCallback, useState, memo } from "react";
import { Terminal } from "xterm";
import { FitAddon } from "xterm-addon-fit";
import { WebLinksAddon } from "xterm-addon-web-links";
import { SearchAddon } from "xterm-addon-search";
import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, X, ChevronUp, ChevronDown, Copy, Trash2, Maximize2, Minimize2 } from "lucide-react";

// Import xterm CSS
import "xterm/css/xterm.css";

export interface TerminalPanelProps {
  /** Terminal ID for tracking */
  terminalId: string;
  /** Session ID this terminal belongs to */
  sessionId?: string;
  /** Working directory label */
  cwd?: string;
  /** Terminal label/title */
  label?: string;
  /** Initial content to write */
  initialContent?: string;
  /** Whether terminal is collapsed */
  collapsed?: boolean;
  /** Callback when data is written to terminal */
  onData?: (data: string) => void;
  /** Callback when terminal is resized */
  onResize?: (cols: number, rows: number) => void;
  /** Callback when terminal is cleared */
  onClear?: () => void;
  /** Whether to show terminal controls */
  showControls?: boolean;
  /** Maximum height (CSS value) */
  maxHeight?: string;
  /** Minimum height (CSS value) */
  minHeight?: string;
  /** Custom class name */
  className?: string;
  /** Exit code if terminal has exited */
  exitCode?: number;
  /** Exit signal if terminal was signaled */
  exitSignal?: string;
}

// Theme configurations
const DARK_THEME = {
  background: "#1a1b26",
  foreground: "#c0caf5",
  cursor: "#c0caf5",
  cursorAccent: "#1a1b26",
  selectionBackground: "#33467c",
  selectionForeground: "#c0caf5",
  black: "#15161e",
  red: "#f7768e",
  green: "#9ece6a",
  yellow: "#e0af68",
  blue: "#7aa2f7",
  magenta: "#bb9af7",
  cyan: "#7dcfff",
  white: "#a9b1d6",
  brightBlack: "#414868",
  brightRed: "#f7768e",
  brightGreen: "#9ece6a",
  brightYellow: "#e0af68",
  brightBlue: "#7aa2f7",
  brightMagenta: "#bb9af7",
  brightCyan: "#7dcfff",
  brightWhite: "#c0caf5",
};

const LIGHT_THEME = {
  background: "#fafafa",
  foreground: "#383a42",
  cursor: "#526eff",
  cursorAccent: "#fafafa",
  selectionBackground: "#e5e5e6",
  selectionForeground: "#383a42",
  black: "#383a42",
  red: "#e45649",
  green: "#50a14f",
  yellow: "#c18401",
  blue: "#4078f2",
  magenta: "#a626a4",
  cyan: "#0184bc",
  white: "#fafafa",
  brightBlack: "#4f525e",
  brightRed: "#e06c75",
  brightGreen: "#98c379",
  brightYellow: "#e5c07b",
  brightBlue: "#61afef",
  brightMagenta: "#c678dd",
  brightCyan: "#56b6c2",
  brightWhite: "#ffffff",
};

/**
 * Terminal Panel with xterm.js
 */
export const TerminalPanel = memo(function TerminalPanel({
  terminalId: _terminalId,
  sessionId: _sessionId,
  cwd,
  label,
  initialContent,
  collapsed: initialCollapsed = false,
  onData,
  onResize,
  onClear,
  showControls = true,
  maxHeight = "400px",
  minHeight = "200px",
  className,
  exitCode,
  exitSignal,
}: TerminalPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const searchAddonRef = useRef<SearchAddon | null>(null);
  
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [isMaximized, setIsMaximized] = useState(false);
  
  const { resolvedTheme } = useTheme();
  
  // Initialize terminal
  useEffect(() => {
    if (!containerRef.current || collapsed) return;
    
    const term = new Terminal({
      theme: resolvedTheme === "dark" ? DARK_THEME : LIGHT_THEME,
      fontSize: 13,
      fontFamily: '"JetBrains Mono", "Fira Code", "SF Mono", Menlo, Monaco, "Courier New", monospace',
      cursorBlink: true,
      cursorStyle: "block",
      scrollback: 10000,
      tabStopWidth: 4,
      convertEol: true,
      allowProposedApi: true,
    });
    
    // Create addons
    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();
    const searchAddon = new SearchAddon();
    
    // Load addons
    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);
    term.loadAddon(searchAddon);
    
    // Open terminal in container
    term.open(containerRef.current);
    
    // Fit to container
    fitAddon.fit();
    
    // Store refs
    terminalRef.current = term;
    fitAddonRef.current = fitAddon;
    searchAddonRef.current = searchAddon;
    
    // Handle data events
    term.onData((data) => {
      onData?.(data);
    });
    
    // Handle resize
    term.onResize(({ cols, rows }) => {
      onResize?.(cols, rows);
    });
    
    // Write initial content
    if (initialContent) {
      term.write(initialContent);
    }
    
    // Resize observer
    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
    });
    resizeObserver.observe(containerRef.current);
    
    // Cleanup
    return () => {
      resizeObserver.disconnect();
      term.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
      searchAddonRef.current = null;
    };
  }, [collapsed, resolvedTheme, initialContent, onData, onResize]);
  
  // Update theme when it changes
  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.options.theme = resolvedTheme === "dark" ? DARK_THEME : LIGHT_THEME;
    }
  }, [resolvedTheme]);
  
  // Write data to terminal
  const write = useCallback((data: string) => {
    terminalRef.current?.write(data);
  }, []);
  
  // Writeln data to terminal
  const writeln = useCallback((data: string) => {
    terminalRef.current?.writeln(data);
  }, []);
  
  // Clear terminal
  const clear = useCallback(() => {
    terminalRef.current?.clear();
    onClear?.();
  }, [onClear]);
  
  // Copy terminal content
  const copyContent = useCallback(() => {
    if (!terminalRef.current) return;
    
    const selection = terminalRef.current.getSelection();
    if (selection) {
      navigator.clipboard.writeText(selection);
    } else {
      // Copy all content
      const buffer = terminalRef.current.buffer.active;
      let content = "";
      for (let i = 0; i < buffer.length; i++) {
        const line = buffer.getLine(i);
        if (line) {
          content += line.translateToString(true) + "\n";
        }
      }
      navigator.clipboard.writeText(content.trimEnd());
    }
  }, []);
  
  // Search functionality
  const handleSearch = useCallback((query: string, direction: "next" | "prev" = "next") => {
    if (!searchAddonRef.current || !query) return;
    
    if (direction === "next") {
      searchAddonRef.current.findNext(query);
    } else {
      searchAddonRef.current.findPrevious(query);
    }
  }, []);
  
  // Expose methods via ref
  React.useImperativeHandle(
    React.useRef({ write, writeln, clear }),
    () => ({ write, writeln, clear }),
    [write, writeln, clear]
  );
  
  // Status indicator
  const getStatusIndicator = () => {
    if (exitCode !== undefined) {
      return exitCode === 0 ? (
        <span className="text-green-500 text-xs">✓ Exit 0</span>
      ) : (
        <span className="text-red-500 text-xs">✗ Exit {exitCode}</span>
      );
    }
    if (exitSignal) {
      return <span className="text-yellow-500 text-xs">⚡ {exitSignal}</span>;
    }
    return <span className="text-blue-500 text-xs animate-pulse">● Running</span>;
  };
  
  return (
    <div
      className={cn(
        "rounded-lg border bg-card overflow-hidden",
        isMaximized && "fixed inset-4 z-50",
        className
      )}
      style={{
        minHeight: collapsed ? "auto" : minHeight,
        maxHeight: isMaximized ? "none" : maxHeight,
      }}
    >
      {/* Header */}
      {showControls && (
        <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/50">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setCollapsed(!collapsed)}
              className="hover:bg-accent p-1 rounded"
            >
              {collapsed ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronUp className="h-4 w-4" />
              )}
            </button>
            <span className="text-sm font-medium">
              {label || "Terminal"}
            </span>
            {cwd && (
              <span className="text-xs text-muted-foreground truncate max-w-[200px]">
                {cwd}
              </span>
            )}
            {getStatusIndicator()}
          </div>
          
          <div className="flex items-center gap-1">
            {/* Search toggle */}
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => setSearchOpen(!searchOpen)}
            >
              <Search className="h-4 w-4" />
            </Button>
            
            {/* Copy button */}
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={copyContent}
            >
              <Copy className="h-4 w-4" />
            </Button>
            
            {/* Clear button */}
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={clear}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
            
            {/* Maximize/minimize */}
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => setIsMaximized(!isMaximized)}
            >
              {isMaximized ? (
                <Minimize2 className="h-4 w-4" />
              ) : (
                <Maximize2 className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>
      )}
      
      {/* Search bar */}
      {searchOpen && (
        <div className="flex items-center gap-2 px-3 py-2 border-b bg-muted/30">
          <Input
            type="text"
            placeholder="Search terminal..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                handleSearch(searchQuery, e.shiftKey ? "prev" : "next");
              }
              if (e.key === "Escape") {
                setSearchOpen(false);
              }
            }}
            className="h-7 text-sm"
            autoFocus
          />
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => handleSearch(searchQuery, "prev")}
          >
            <ChevronUp className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => handleSearch(searchQuery, "next")}
          >
            <ChevronDown className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => setSearchOpen(false)}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}
      
      {/* Terminal container */}
      {!collapsed && (
        <div
          ref={containerRef}
          className="w-full h-full min-h-[150px]"
          style={{
            height: isMaximized ? "calc(100% - 50px)" : "auto",
          }}
        />
      )}
    </div>
  );
});

export default TerminalPanel;

// Get the ACP API from the window object
function getACPApi() {
  if (typeof window !== "undefined" && "electronAPI" in window) {
    const electronAPI = (
      window as unknown as { electronAPI?: { acp?: Record<string, unknown> } }
    ).electronAPI;
    return electronAPI?.acp || null;
  }
  return null;
}

/**
 * Hook for managing terminal data from ACP events
 */
export function useTerminalData(
  sessionId: string,
  terminalId: string
) {
  const [data, setData] = useState<string>("");
  const [exitCode, setExitCode] = useState<number | undefined>();
  const [exitSignal, setExitSignal] = useState<string | undefined>();
  
  // Subscribe to terminal events
  useEffect(() => {
    const api = getACPApi() as {
      onTerminalOutput?: (callback: (data: { terminalId: string; data: string; sessionId?: string }) => void) => () => void;
      onTerminalExit?: (callback: (data: { terminalId: string; exitCode?: number; signal?: string; sessionId?: string }) => void) => () => void;
    } | null;
    
    if (!api) return;
    
    const handleOutput = (event: { terminalId: string; data: string; sessionId?: string }) => {
      if (event.terminalId === terminalId && (!event.sessionId || event.sessionId === sessionId)) {
        setData((prev) => prev + event.data);
      }
    };
    
    const handleExit = (event: { terminalId: string; exitCode?: number; signal?: string; sessionId?: string }) => {
      if (event.terminalId === terminalId && (!event.sessionId || event.sessionId === sessionId)) {
        setExitCode(event.exitCode);
        setExitSignal(event.signal);
      }
    };
    
    const unsubOutput = api.onTerminalOutput?.(handleOutput);
    const unsubExit = api.onTerminalExit?.(handleExit);
    
    return () => {
      unsubOutput?.();
      unsubExit?.();
    };
  }, [sessionId, terminalId]);
  
  return { data, exitCode, exitSignal };
}
