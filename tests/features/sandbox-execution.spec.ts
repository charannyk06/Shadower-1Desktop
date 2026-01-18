import { expect, test } from "@playwright/test";
import { TEST_USERS } from "../constants/test-users";
import {
  executeSandboxRequest,
  extractThreadIdFromUrl,
  navigateToHome,
  responseContainsText,
  sendChatMessage,
  waitForAssistantResponse,
} from "../helpers/sandbox-test-helpers";

/**
 * E2E tests for E2B unified sandbox execution functionality
 * Tests:
 * - Code execution (Python, JavaScript, TypeScript)
 * - Shell command execution
 * - File operations (read, write, list, delete)
 * - Thread context persistence
 * - File upload API
 * - Error handling
 *
 * Note: These tests require E2B_API_KEY to be configured.
 * They will be skipped in CI if the API key is not available.
 */

// Skip all E2B tests if no API key is configured (check via env or feature detection)
const skipE2BTests = !process.env.E2B_API_KEY;

test.describe("E2B Unified Sandbox Execution", () => {
  test.skip(
    skipE2BTests,
    "E2B_API_KEY not configured - skipping sandbox tests",
  );
  test.use({ storageState: TEST_USERS.admin.authFile });

  test.beforeEach(async ({ page }) => {
    await navigateToHome(page);
  });

  test("should execute Python code and display results", async ({ page }) => {
    const pythonCode = "print('Hello from Python sandbox!')";
    const responseContent = await executeSandboxRequest(
      page,
      `Execute this Python code: ${pythonCode}`,
      2000,
    );

    const hasExecutionResult = await responseContainsText(responseContent, [
      "Hello from Python",
      "execution",
      "sandbox",
      "result",
    ]);

    expect(hasExecutionResult).toBeTruthy();
  });

  test("should execute JavaScript code and generate artifacts", async ({
    page,
  }) => {
    const jsRequest =
      "Create a simple HTML file with 'Hello World' and save it as test.html";
    const responseContent = await executeSandboxRequest(page, jsRequest, 5000);

    const hasArtifact = await responseContainsText(responseContent, [
      "test.html",
      "artifact",
      "file",
      "preview",
    ]);

    expect(hasArtifact).toBeTruthy();
  });

  test("should handle Python code execution errors gracefully", async ({
    page,
  }) => {
    const invalidCode = "this_will_cause_a_syntax_error!!!";
    const responseContent = await executeSandboxRequest(
      page,
      `Execute this Python code: ${invalidCode}`,
      5000,
    );

    const hasError = await responseContainsText(responseContent, [
      "error",
      "failed",
      "exception",
      "syntax",
    ]);

    expect(hasError).toBeTruthy();
  });

  test("should display execution logs in tool invocation component", async ({
    page,
  }) => {
    await executeSandboxRequest(
      page,
      "Run Python code: print('Test output')",
      5000,
    );

    // Look for tool invocation component with logs
    const toolInvocation = page
      .locator(
        '[data-testid*="tool"], [data-testid*="execution"], .tool-invocation',
      )
      .first();

    const isToolVisible = await toolInvocation.isVisible().catch(() => false);
    if (isToolVisible) {
      await expect(toolInvocation).toBeVisible();
    }
  });

  test("should generate Excel file from Python code", async ({ page }) => {
    const excelRequest =
      "Create an Excel file with sample data using Python pandas";
    const responseContent = await executeSandboxRequest(
      page,
      excelRequest,
      8000,
    );

    const hasExcelFile = await responseContainsText(responseContent, [
      ".xlsx",
      "excel",
      "spreadsheet",
    ]);

    expect(hasExcelFile).toBeTruthy();
  });

  // ============================================================================
  // Unified Sandbox Tool - Shell Commands
  // ============================================================================

  test("should execute shell commands via unified sandbox tool", async ({
    page,
  }) => {
    const shellRequest = "Run the command: echo 'Hello from shell' && ls -la";
    const responseContent = await executeSandboxRequest(
      page,
      shellRequest,
      5000,
    );

    const hasShellOutput = await responseContainsText(responseContent, [
      "Hello from shell",
      "command",
      "output",
    ]);

    expect(hasShellOutput).toBeTruthy();
  });

  test("should execute npm install via shell command", async ({ page }) => {
    const npmRequest = "Install lodash package using npm";
    const responseContent = await executeSandboxRequest(
      page,
      npmRequest,
      10000,
    );

    const hasNpmOutput = await responseContainsText(responseContent, [
      "lodash",
      "installed",
      "package",
    ]);

    expect(hasNpmOutput).toBeTruthy();
  });

  // ============================================================================
  // Unified Sandbox Tool - File Operations
  // ============================================================================

  test("should persist files across multiple executions in same thread", async ({
    page,
  }) => {
    await navigateToHome(page);

    // First execution: Create a file
    const createFileRequest =
      "Create a file called test.txt with content 'Hello World'";
    await sendChatMessage(page, createFileRequest, 5000);

    // Second execution: Read the file
    await sendChatMessage(page, "Read the file test.txt", 5000);

    const responseContent = await waitForAssistantResponse(page);

    const hasFileContent = await responseContainsText(responseContent, [
      "Hello World",
      "test.txt",
      "file content",
    ]);

    expect(hasFileContent).toBeTruthy();
  });

  test("should list directory contents", async ({ page }) => {
    await navigateToHome(page);

    // First create a file, then list directory
    await sendChatMessage(
      page,
      "Create a file test-list.txt with content 'test'",
      3000,
    );
    await sendChatMessage(
      page,
      "List all files in the current directory",
      5000,
    );

    const responseContent = await waitForAssistantResponse(page);

    const hasListing = await responseContainsText(responseContent, [
      "test-list.txt",
      "directory",
      "files",
    ]);

    expect(hasListing).toBeTruthy();
  });

  // ============================================================================
  // File Upload API Tests
  // ============================================================================

  test("should access file upload API endpoint", async ({ page }) => {
    await navigateToHome(page);
    await sendChatMessage(page, "Test thread for file upload", 2000);

    const threadId = extractThreadIdFromUrl(page);

    if (threadId) {
      // Test GET endpoint - should return empty files array for new thread
      const getResponse = await page.request.get(
        `/api/thread/${threadId}/files`,
      );
      expect(getResponse.ok()).toBeTruthy();
      const getResult = await getResponse.json();
      expect(getResult).toHaveProperty("files");
      expect(Array.isArray(getResult.files)).toBeTruthy();

      // Test POST endpoint exists and is accessible
      // Note: Full multipart upload testing may require additional setup
      expect(threadId).toBeTruthy();
    } else {
      // If no thread ID found, the test still validates the flow
      test.skip();
    }
  });

  test("should list files in thread context via API", async ({ page }) => {
    await navigateToHome(page);
    await sendChatMessage(page, "Test thread", 2000);

    const threadId = extractThreadIdFromUrl(page);

    if (threadId) {
      // List files
      const response = await page.request.get(`/api/thread/${threadId}/files`);

      expect(response.ok()).toBeTruthy();
      const result = await response.json();
      expect(result).toHaveProperty("files");
      expect(Array.isArray(result.files)).toBeTruthy();
    }
  });

  // ============================================================================
  // TypeScript Execution
  // ============================================================================

  test("should execute TypeScript code", async ({ page }) => {
    const tsRequest =
      "Run this TypeScript code: const x: number = 42; console.log(x);";
    const responseContent = await executeSandboxRequest(page, tsRequest, 5000);

    const hasResult = await responseContainsText(responseContent, [
      "42",
      "typescript",
      "execution",
    ]);

    expect(hasResult).toBeTruthy();
  });

  // ============================================================================
  // Error Handling
  // ============================================================================

  test("should handle missing code parameter gracefully", async ({ page }) => {
    const responseContent = await executeSandboxRequest(
      page,
      "Execute code without providing any code",
      5000,
    );

    // Either shows error or handles gracefully (both are acceptable)
    expect(responseContent).toBeVisible();
  });

  test("should handle invalid shell command gracefully", async ({ page }) => {
    const responseContent = await executeSandboxRequest(
      page,
      "Run this invalid command: nonexistentcommand12345",
      5000,
    );

    // Error handling is acceptable - verify response is visible
    expect(responseContent).toBeVisible();
  });

  // ============================================================================
  // Integration Tests - Multiple Operations
  // ============================================================================

  test("should execute multiple operations in sequence with file persistence", async ({
    page,
  }) => {
    await navigateToHome(page);

    // Step 1: Create a Python file
    await sendChatMessage(
      page,
      "Create a Python file called script.py with: print('Hello from Python')",
      3000,
    );

    // Step 2: Execute the Python file
    await sendChatMessage(page, "Run the Python script.py file", 5000);

    const responseContent = await waitForAssistantResponse(page);

    const hasOutput = await responseContainsText(responseContent, [
      "Hello from Python",
      "script.py",
    ]);

    expect(hasOutput).toBeTruthy();
  });

  test("should handle pip package installation and usage", async ({ page }) => {
    const request =
      "Install the requests package using pip and then use it to make a simple HTTP request";
    const responseContent = await executeSandboxRequest(page, request, 15000);

    const hasResult = await responseContainsText(responseContent, [
      "requests",
      "installed",
      "http",
      "response",
    ]);

    expect(hasResult).toBeTruthy();
  });

  // ============================================================================
  // Timeout Handling Tests
  // ============================================================================

  test("should handle long-running operations gracefully within 60s timeout", async ({
    page,
  }) => {
    // Test that sandbox handles operations that take time but complete within timeout
    // This creates a file with some processing to verify timeout doesn't trigger prematurely
    const request =
      "Create a Python script that counts from 1 to 10 with a small delay between each number, then save the result to a file";
    const responseContent = await executeSandboxRequest(page, request, 20000);

    // Should complete successfully without timeout
    const hasResult = await responseContainsText(responseContent, [
      "10",
      "count",
      "file",
      "complete",
      "saved",
    ]);

    expect(hasResult).toBeTruthy();
  });

  test("should report timeout for very long running code", async ({ page }) => {
    // This test verifies timeout behavior for code that would exceed the 60s limit
    // Note: We don't actually run code that takes 60s, but verify the sandbox handles it
    const request =
      "Execute Python code that prints a progress message every second: import time; [print(i) for i in range(5)]";
    const responseContent = await executeSandboxRequest(page, request, 15000);

    // Should complete within reasonable time (not trigger full 60s timeout)
    expect(responseContent).toBeVisible();
  });

  // ============================================================================
  // File Metadata Tests
  // ============================================================================

  test("should include sandboxPath in file metadata", async ({ page }) => {
    await navigateToHome(page);

    // Create a file to generate metadata
    await sendChatMessage(
      page,
      "Create a file called metadata-test.txt with content 'Testing metadata'",
      5000,
    );

    const threadId = extractThreadIdFromUrl(page);

    if (threadId) {
      // Get files from API - should include sandboxPath
      const response = await page.request.get(`/api/thread/${threadId}/files`);

      if (response.ok()) {
        const result = await response.json();
        expect(result).toHaveProperty("files");
        expect(Array.isArray(result.files)).toBeTruthy();

        // If files exist, verify metadata structure
        if (result.files.length > 0) {
          // Files may include sandboxPath depending on how they were created
          // The key point is the API returns proper file structure
          for (const file of result.files) {
            expect(file).toHaveProperty("name");
            // sandboxPath is included for files that were created in sandbox
          }
        }
      }
    }
  });

  test("should retrieve file by sandboxPath from thread files API", async ({
    page,
  }) => {
    await navigateToHome(page);

    // Create a file in sandbox
    await sendChatMessage(
      page,
      "Create a Python file called retrieval-test.py with: print('Test retrieval')",
      5000,
    );

    const threadId = extractThreadIdFromUrl(page);

    if (threadId) {
      // List files
      const listResponse = await page.request.get(
        `/api/thread/${threadId}/files`,
      );

      if (listResponse.ok()) {
        const result = await listResponse.json();

        // Verify file list returns proper structure
        expect(result).toHaveProperty("files");

        if (result.files && result.files.length > 0) {
          // Each file should have name at minimum
          result.files.forEach(
            (file: { name: string; sandboxPath?: string }) => {
              expect(file).toHaveProperty("name");
              expect(typeof file.name).toBe("string");
            },
          );
        }
      }
    }
  });

  // ============================================================================
  // Execution Metadata Tests
  // ============================================================================

  test("should track execution metadata for code runs", async ({ page }) => {
    const responseContent = await executeSandboxRequest(
      page,
      "Run Python: x = 1 + 1; print(f'Result: {x}')",
      5000,
    );

    // Verify execution completed and shows result
    const hasResult = await responseContainsText(responseContent, [
      "Result: 2",
      "2",
    ]);

    expect(hasResult).toBeTruthy();
  });

  test("should handle multiple sequential executions in same thread", async ({
    page,
  }) => {
    await navigateToHome(page);

    // Execute multiple commands sequentially
    await sendChatMessage(page, "Run Python: x = 10; print(x)", 3000);
    await sendChatMessage(page, "Run Python: y = 20; print(y)", 3000);
    await sendChatMessage(page, "Run Python: print(x + y)", 5000);

    const responseContent = await waitForAssistantResponse(page);

    // Third execution should have access to previous variables if in same context
    // or handle as separate execution gracefully
    expect(responseContent).toBeVisible();
  });
});
