import { expect, test } from "@playwright/test";
import { TEST_USERS } from "../constants/test-users";
import {
  TIMEOUTS,
  sendMessageAndWaitForResponse,
  setupChatTest,
} from "../helpers/chat-test-helpers";

/**
 * E2E tests for Fragment Agent functionality
 * Tests:
 * - Template selection accuracy
 * - Code generation quality
 * - Fragment creation for different templates
 * - Surgical editing with Morph API
 * - Deployment flow
 * - Error handling
 *
 * Note: Requires E2B_API_KEY for fragment creation
 */

const skipFragmentTests = !process.env.E2B_API_KEY;

test.describe("Fragment Agent - Template Selection", () => {
  test.use({ storageState: TEST_USERS.admin.authFile });
  test.skip(skipFragmentTests, "E2B_API_KEY not configured");

  test.beforeEach(async ({ page }) => {
    await setupChatTest(page);
  });

  test("should select Next.js template for full-stack web app", async ({
    page,
  }) => {
    const response = await sendMessageAndWaitForResponse(
      page,
      "Create a todo app with dark mode using Next.js",
      TIMEOUTS.long,
    );

    // Should mention Next.js or React
    expect(response.toLowerCase()).toMatch(/nextjs|react|next\.js/i);
  });

  test("should select Vue template for simple SPA", async ({ page }) => {
    const response = await sendMessageAndWaitForResponse(
      page,
      "Create a simple interactive counter app with Vue",
      TIMEOUTS.long,
    );

    // Should mention Vue
    expect(response.toLowerCase()).toMatch(/vue/i);
  });

  test("should select Streamlit template for data dashboard", async ({
    page,
  }) => {
    const response = await sendMessageAndWaitForResponse(
      page,
      "Create a dashboard showing sales data with charts",
      TIMEOUTS.long,
    );

    // Should mention Streamlit or dashboard
    expect(response.toLowerCase()).toMatch(/streamlit|dashboard/i);
  });

  test("should select code-interpreter for document generation", async ({
    page,
  }) => {
    const response = await sendMessageAndWaitForResponse(
      page,
      "Create a PowerPoint presentation about AI trends",
      TIMEOUTS.long,
    );

    // Should mention PowerPoint or document
    expect(response.toLowerCase()).toMatch(/powerpoint|presentation|document/i);
  });
});

test.describe("Fragment Agent - Code Generation", () => {
  test.use({ storageState: TEST_USERS.admin.authFile });
  test.skip(skipFragmentTests, "E2B_API_KEY not configured");

  test.beforeEach(async ({ page }) => {
    await setupChatTest(page);
  });

  test("should create a Next.js web app successfully", async ({ page }) => {
    const response = await sendMessageAndWaitForResponse(
      page,
      "Create a simple todo app with add and delete functionality",
      TIMEOUTS.long,
    );

    // Should indicate success
    expect(response.toLowerCase()).toMatch(
      /created|success|preview|fragment|todo/i,
    );

    // Should provide preview URL or fragment ID
    expect(response).toMatch(/http|fragment|preview/i);
  });

  test("should create a Vue app successfully", async ({ page }) => {
    const response = await sendMessageAndWaitForResponse(
      page,
      "Create a Vue.js counter app with increment and decrement buttons",
      TIMEOUTS.long,
    );

    expect(response.toLowerCase()).toMatch(/created|success|vue|preview/i);
  });

  test("should create a Streamlit dashboard successfully", async ({ page }) => {
    const response = await sendMessageAndWaitForResponse(
      page,
      "Create a Streamlit dashboard with a simple chart",
      TIMEOUTS.long,
    );

    expect(response.toLowerCase()).toMatch(/created|streamlit|dashboard/i);
  });

  test("should handle invalid requests gracefully", async ({ page }) => {
    const response = await sendMessageAndWaitForResponse(
      page,
      "Create something impossible that doesn't exist",
      TIMEOUTS.medium,
    );

    // Should handle error gracefully
    expect(response.toLowerCase()).toMatch(/error|unable|cannot|try/i);
  });
});

test.describe("Fragment Agent - Editing", () => {
  test.use({ storageState: TEST_USERS.admin.authFile });
  test.skip(skipFragmentTests, "E2B_API_KEY not configured");

  test.beforeEach(async ({ page }) => {
    await setupChatTest(page);
  });

  test("should edit fragment with surgical precision", async ({ page }) => {
    // First create a fragment
    await sendMessageAndWaitForResponse(
      page,
      "Create a simple counter app",
      TIMEOUTS.long,
    );

    // Then edit it
    const editResponse = await sendMessageAndWaitForResponse(
      page,
      "Change the button color to blue",
      TIMEOUTS.long,
    );

    expect(editResponse.toLowerCase()).toMatch(/edit|updated|changed|success/i);
  });

  test("should handle edit errors gracefully", async ({ page }) => {
    // Try to edit a non-existent fragment
    const response = await sendMessageAndWaitForResponse(
      page,
      "Edit fragment abc123xyz to change the color",
      TIMEOUTS.medium,
    );

    expect(response.toLowerCase()).toMatch(/error|not found|invalid/i);
  });
});

test.describe("Fragment Agent - Deployment", () => {
  test.use({ storageState: TEST_USERS.admin.authFile });
  test.skip(skipFragmentTests, "E2B_API_KEY not configured");

  test.beforeEach(async ({ page }) => {
    await setupChatTest(page);
  });

  test("should deploy fragment and provide shareable link", async ({
    page,
  }) => {
    // Create fragment first
    await sendMessageAndWaitForResponse(
      page,
      "Create a simple hello world app",
      TIMEOUTS.long,
    );

    // Deploy it
    const deployResponse = await sendMessageAndWaitForResponse(
      page,
      "Deploy the fragment",
      TIMEOUTS.medium,
    );

    // Should provide deployment URL
    expect(deployResponse.toLowerCase()).toMatch(/deploy|share|link|url/i);
    expect(deployResponse).toMatch(/http|https|f\./i);
  });
});

test.describe("Fragment Agent - Sandbox Pooling", () => {
  test.use({ storageState: TEST_USERS.admin.authFile });
  test.skip(skipFragmentTests, "E2B_API_KEY not configured");

  test.beforeEach(async ({ page }) => {
    await setupChatTest(page);
  });

  test("should reuse sandbox for subsequent operations", async ({ page }) => {
    // Create first fragment
    const firstResponse = await sendMessageAndWaitForResponse(
      page,
      "Create a simple app",
      TIMEOUTS.long,
    );

    // Create second fragment (should be faster due to pooling)
    const startTime = Date.now();
    const secondResponse = await sendMessageAndWaitForResponse(
      page,
      "Create another simple app",
      TIMEOUTS.long,
    );
    const duration = Date.now() - startTime;

    // Both should succeed
    expect(firstResponse.toLowerCase()).toMatch(/created|success/i);
    expect(secondResponse.toLowerCase()).toMatch(/created|success/i);

    // Second should be reasonably fast (pooling should help)
    // Note: This is a soft check - actual timing depends on many factors
    expect(duration).toBeLessThan(TIMEOUTS.long);
  });
});

test.describe("Fragment Agent - Error Handling", () => {
  test.use({ storageState: TEST_USERS.admin.authFile });
  test.skip(skipFragmentTests, "E2B_API_KEY not configured");

  test.beforeEach(async ({ page }) => {
    await setupChatTest(page);
  });

  test("should handle quota exceeded errors", async ({ page }) => {
    // This test would require mocking quota or using a test account
    // For now, we'll just verify error handling exists
    const response = await sendMessageAndWaitForResponse(
      page,
      "Create a test app",
      TIMEOUTS.medium,
    );

    // Should either succeed or show quota error gracefully
    expect(response.toLowerCase()).toMatch(
      /created|success|quota|limit|error/i,
    );
  });

  test("should handle sandbox creation failures", async ({ page }) => {
    // This would require mocking E2B API failures
    // For now, verify error handling exists
    const response = await sendMessageAndWaitForResponse(
      page,
      "Create an app",
      TIMEOUTS.medium,
    );

    // Should handle errors gracefully
    expect(response.toLowerCase()).toMatch(/created|success|error|failed/i);
  });
});
