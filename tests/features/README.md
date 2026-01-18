# Feature E2E Tests

This directory contains end-to-end tests for major feature areas.

## Test Files

### Document Agent (`document-agent.spec.ts`)
Tests for document generation and editing capabilities:
- PowerPoint presentation generation
- Word document generation
- Excel spreadsheet generation
- Custom color palettes
- Document editing
- Theater mode preview

**Requirements**: `E2B_API_KEY` must be configured

### Browser Automation (`browser-automation.spec.ts`)
Tests for browser automation using Browserbase:
- Website navigation
- Screenshot capture
- Data extraction
- Web page interaction
- Tool invocation display
- Browser preview in theater mode

**Requirements**: `BROWSERBASE_API_KEY` must be configured

### Desktop Automation (`desktop-automation.spec.ts`)
Tests for desktop automation using E2B Desktop:
- Desktop screenshot capture
- Tool invocation display
- Desktop preview in theater mode
- Tool status badges

**Requirements**: `E2B_API_KEY` must be configured

### Collabora Integration (`collabora-integration.spec.ts`)
Tests for Collabora CODE integration and WOPI protocol:
- Word document editing
- Excel spreadsheet editing
- PowerPoint presentation editing
- Editor loading states
- WOPI protocol integration

**Requirements**: `NEXT_PUBLIC_COLLABORA_URL` and `WOPI_SECRET` must be configured

### Sub-Agent Views (`sub-agent-views.spec.ts`)
Tests for sub-agent visualization and display:
- Sub-agent tile display
- Status and progress indicators
- Event timeline
- Tool call cards
- Tool call timeline
- Tool status badges

**Requirements**: None (always runs)

### System Agents (`system-agents.spec.ts`)
Tests for system agents functionality:
- System agent availability
- System agent branding (logo display)
- Deep research agent usage
- Coding agent usage
- Web automation agent usage

**Requirements**: None (always runs)

### Branding Logo (`branding-logo.spec.ts`)
Tests for branding and logo display:
- Logo in sidebar header
- Logo in animated logo component
- Logo in shareable card footer (instead of text)
- Logo in tool select dropdown
- Logo in MCP cards
- Verification of correct logo file

**Requirements**: None (always runs)

## Running Tests

```bash
# Run all feature tests
pnpm test:e2e tests/features/

# Run specific test file
pnpm test:e2e tests/features/document-agent.spec.ts

# Run with UI
pnpm test:e2e:ui tests/features/
```

## Test Skipping

Tests that require external services will automatically skip if the required environment variables are not configured. This allows the test suite to run in CI even when some services are not available.

## Notes

- All tests use the admin test user by default
- Tests include proper timeouts for async operations
- Tests are designed to be resilient to UI changes
- Some tests check for optional features and gracefully handle their absence
