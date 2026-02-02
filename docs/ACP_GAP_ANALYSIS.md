# ACP Implementation Gap Analysis

## Executive Summary

The Shadower-1 Desktop app has a **solid foundational ACP implementation** using `@agentclientprotocol/sdk@0.13.1`. After reviewing the codebase against the ACP SDK capabilities and Zed's patterns, I've identified several gaps organized by priority.

**Overall Status: 7/10** - Core functionality works, but missing polish and some advanced features.

---

## Platform-Specific Analysis

### macOS Status: ✅ Good
- Path resolution includes Homebrew paths (`/opt/homebrew/bin`)
- Node version manager paths (nvm, fnm, Volta) properly configured
- `.cmd` file handling not needed
- Working directory detection functional

### Windows Status: ⚠️ Needs Work
- `.cmd` file spawning implemented but has edge cases
- Path resolution includes Windows-specific paths
- **Gap: No PowerShell fallback** when cmd.exe fails
- **Gap: No Windows-specific credential storage** (Windows Credential Manager)
- **Gap: No proper handling of Windows defender/firewall blocking agents**

### Linux Status: ⚠️ Untested
- Unix path resolution present
- No Linux-specific testing documented
- **Gap: No Snap/Flatpak path detection**
- **Gap: No systemd service integration**

---

## Critical Gaps (P0 - Must Fix)

### 1. Session Persistence Across App Restarts
**Current:** Sessions are lost when the app restarts  
**Expected:** Like Zed, sessions should persist and be resumable  
**Impact:** Users lose work context on restart  
**Fix:** 
- Store session metadata in SQLite
- Implement `resumeSession` flow properly
- Auto-reconnect to last session on launch

### 2. Terminal UI Integration
**Current:** Terminal output in tool call display only  
**Expected:** Proper embedded terminal with input support  
**Impact:** Can't interact with terminal commands  
**Files to modify:**
- Create `src/components/acp/terminal-panel.tsx`
- Add xterm.js integration
- Connect to `terminal-output` events

### 3. Error Recovery
**Current:** Agent crash = lost session  
**Expected:** Graceful recovery with retry  
**Impact:** Poor UX on agent failures  
**Fix:**
- Implement agent health checks
- Auto-restart agents on crash
- Queue messages during reconnection

---

## High Priority Gaps (P1)

### 4. Session Fork (Branching)
**SDK Support:** `unstable_forkSession`  
**Current:** Not implemented  
**Expected:** Fork conversation to explore alternatives  
**Reference:** Zed uses this for "Try this approach" branches  
**Files:**
```typescript
// Add to electron/ipc/acp.ts
ipcMain.handle("acp:fork-session", async (_, agentId, sessionId) => {
  const manager = getACPAgentManager();
  return manager.forkSession(agentId, sessionId);
});
```

### 5. File Watcher Integration
**Current:** Only tracks files changed by agent  
**Expected:** Watch project files for external changes  
**Impact:** Agent doesn't know when user edits files externally  
**Fix:**
- Add chokidar file watcher
- Notify agent of external file changes
- Update context automatically

### 6. Context Window Management
**Current:** No token counting/management  
**Expected:** Show context usage, warn when near limit  
**Impact:** Users hit context limits unexpectedly  
**Reference:** Zed shows context bar in UI  
**Files:**
- Add `src/components/acp/context-indicator.tsx`
- Track token usage from `sessionUpdate` events

### 7. MCP Server Management UI
**Current:** MCP servers hardcoded or manual config  
**Expected:** UI to add/remove/configure MCP servers per session  
**SDK Support:** `NewSessionRequest.mcpServers`  
**Files:**
- Create `src/components/acp/mcp-config-dialog.tsx`
- Store MCP configs per project in SQLite

---

## Medium Priority Gaps (P2)

### 8. Image/Audio in Prompts
**SDK Support:** `PromptCapabilities.image`, `PromptCapabilities.audio`  
**Current:** Not exposed in UI  
**Expected:** Drag-drop images, voice input  
**Fix:**
```typescript
// Check capabilities before showing UI
if (session.capabilities?.prompt?.image) {
  // Show image upload button
}
```

### 9. Available Commands UI
**Current:** Commands parsed but not displayed  
**Expected:** Slash commands autocomplete (like `/plan`, `/research`)  
**SDK Events:** `AvailableCommandsUpdate`  
**Files:**
- Add `src/components/acp/command-palette.tsx`
- Connect to `commands-update` events

### 10. Plan Visualization
**Current:** Plans shown as text  
**Expected:** Visual checklist with progress  
**SDK Support:** `PlanUpdate` with steps and status  
**Reference:** Zed shows plans as expandable task list  
**Files:**
- Enhance `src/components/acp/plan-view.tsx`
- Add step completion animations

### 11. Subagent Session Display
**Current:** Subagent events logged but not visualized  
**Expected:** Nested session UI showing subagent work  
**SDK Support:** `isSubagent`, `subagentSessionId` in tool calls  
**Files:**
- Add `src/components/acp/subagent-panel.tsx`
- Show subagent sessions in sidebar

### 12. Model Selection Within Session
**Current:** Model fixed at session creation  
**Expected:** Allow changing model mid-session (if agent supports)  
**SDK Support:** `unstable_setSessionModel`  
**Status:** IPC handler exists but UI doesn't expose it well

---

## Low Priority Gaps (P3)

### 13. Session Export/Import
**Expected:** Export conversation as markdown/JSON  
**Impact:** Can't share sessions  

### 14. Keyboard Shortcuts
**Expected:** `Cmd+Enter` to send, `Cmd+.` to cancel  
**Impact:** Power users need shortcuts  

### 15. Theme Sync
**Expected:** Match system/app theme in terminal output  
**Impact:** Visual inconsistency  

### 16. Agent Auto-Update Check
**Expected:** Notify when agent CLI has updates  
**Impact:** Users run outdated agents  

### 17. Metrics/Analytics
**Expected:** Track token usage, session duration  
**Impact:** No visibility into costs  

---

## Windows-Specific Issues

### Path Resolution Failures
```typescript
// Current: Only checks common paths
// Missing: PATH from Windows Registry, Scoop packages

// Add to getNodePaths() in acp-agent-service.ts:
if (process.platform === "win32") {
  // Scoop
  paths.push(join(home, "scoop", "apps", "nodejs", "current"));
  // Chocolatey
  paths.push("C:\\ProgramData\\chocolatey\\bin");
}
```

### UAC Elevation
Some agents may need elevated permissions. Currently no mechanism to request UAC elevation.

### Long Path Support
Windows has 260-char path limit by default. Large projects may fail.
```typescript
// Enable long paths in spawn options
spawn(cmd, args, { 
  windowsHide: true,
  env: { ...env, NODE_OPTIONS: '--enable-source-maps' }
});
```

---

## Recommended Implementation Order

### Week 1: Critical
1. Session persistence in SQLite
2. Auto-reconnect on agent crash
3. Windows PowerShell fallback

### Week 2: High Priority
4. Terminal UI with xterm.js
5. File watcher integration
6. Context window indicator

### Week 3: Medium Priority
7. Available commands autocomplete
8. Plan visualization upgrade
9. MCP server config UI

### Week 4: Polish
10. Image/audio prompt support
11. Subagent visualization
12. Session fork UI

---

## Files to Create

```
src/components/acp/
├── terminal-panel.tsx      # Embedded terminal
├── context-indicator.tsx   # Token usage display
├── command-palette.tsx     # Slash commands
├── plan-view.tsx          # Visual plan display (exists, needs upgrade)
├── subagent-panel.tsx     # Nested session view
├── mcp-config-dialog.tsx  # MCP server management
└── session-history.tsx    # Past sessions browser

electron/services/
├── session-persistence.ts  # SQLite session storage
└── file-watcher.ts        # Project file monitoring
```

---

## Reference: Zed's ACP Features

From reviewing `@zed-industries/claude-code-acp`:

1. **Session Resume** - Zed reconnects to previous session on restart
2. **Context Tracking** - Shows tokens used / available
3. **Visual Plans** - Collapsible task lists with checkmarks
4. **Terminal Embed** - Full xterm.js terminal in tool output
5. **File Diff View** - Side-by-side before/after for edits
6. **Mode Switching** - Quick toggle between ask/code/architect
7. **Project Indexing** - Indexes codebase for better context

---

## Conclusion

The implementation covers ~70% of ACP capabilities. The main gaps are around **session persistence**, **terminal interactivity**, and **Windows reliability**. Implementing the P0 items would bring this to production-ready for both platforms.
