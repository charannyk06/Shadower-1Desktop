import { expect, test } from "@playwright/test";
import { TEST_USERS } from "../constants/test-users";
import {
  TIMEOUTS,
  sendMessageAndWaitForResponse,
  setupChatTest,
} from "../helpers/chat-test-helpers";

/**
 * End-to-end integration tests for fragment system
 * Tests complete workflows:
 * - Fragment creation → editing → deployment
 * - Public viewing
 * - VNC streaming (if available)
 * - Multi-turn conversations
 *
 * Note: Requires E2B_API_KEY for fragment operations
 */

const skipFragmentTests = !process.env.E2B_API_KEY;

test.describe("Fragment Integration - Complete Workflow", () => {
  test.use({ storageState: TEST_USERS.admin.authFile });
  test.skip(skipFragmentTests, "E2B_API_KEY not configured");

  test.beforeEach(async ({ page }) => {
    await setupChatTest(page);
  });

  test("should complete full fragment lifecycle: create → edit → deploy", async ({
    page,
  }) => {
    // Step 1: Create fragment
    const createResponse = await sendMessageAndWaitForResponse(
      page,
      "Create a simple counter app with increment and decrement buttons",
      TIMEOUTS.long,
    );

    expect(createResponse.toLowerCase()).toMatch(/created|success|counter/i);

    // Extract fragment ID or preview URL from response
    const _fragmentIdMatch = createResponse.match(
      /fragment[:\s]+([a-z0-9-]+)/i,
    );
    const _previewUrlMatch = createResponse.match(/https?:\/\/[^\s]+/i);

    // Step 2: Edit fragment
    const editResponse = await sendMessageAndWaitForResponse(
      page,
      "Change the increment button color to green",
      TIMEOUTS.long,
    );

    expect(editResponse.toLowerCase()).toMatch(/edit|updated|changed/i);

    // Step 3: Deploy fragment
    const deployResponse = await sendMessageAndWaitForResponse(
      page,
      "Deploy this fragment for 24 hours",
      TIMEOUTS.medium,
    );

    expect(deployResponse.toLowerCase()).toMatch(/deploy|share|link/i);
    expect(deployResponse).toMatch(/http|https/i);
  });

  test("should handle multiple edits in sequence", async ({ page }) => {
    // Create fragment
    await sendMessageAndWaitForResponse(
      page,
      "Create a simple todo app",
      TIMEOUTS.long,
    );

    // First edit
    const edit1 = await sendMessageAndWaitForResponse(
      page,
      "Add a dark mode toggle",
      TIMEOUTS.long,
    );
    expect(edit1.toLowerCase()).toMatch(/edit|updated|added/i);

    // Second edit
    const edit2 = await sendMessageAndWaitForResponse(
      page,
      "Change the background color to light blue",
      TIMEOUTS.long,
    );
    expect(edit2.toLowerCase()).toMatch(/edit|updated|changed/i);

    // Third edit
    const edit3 = await sendMessageAndWaitForResponse(
      page,
      "Add input validation",
      TIMEOUTS.long,
    );
    expect(edit3.toLowerCase()).toMatch(/edit|updated|added/i);
  });

  test("should create and deploy multiple fragments", async ({ page }) => {
    // Create first fragment
    const fragment1 = await sendMessageAndWaitForResponse(
      page,
      "Create a hello world app",
      TIMEOUTS.long,
    );
    expect(fragment1.toLowerCase()).toMatch(/created|success/i);

    // Create second fragment
    const fragment2 = await sendMessageAndWaitForResponse(
      page,
      "Create a calculator app",
      TIMEOUTS.long,
    );
    expect(fragment2.toLowerCase()).toMatch(/created|success/i);

    // Deploy first fragment
    const deploy1 = await sendMessageAndWaitForResponse(
      page,
      "Deploy the hello world app",
      TIMEOUTS.medium,
    );
    expect(deploy1.toLowerCase()).toMatch(/deploy|share/i);
  });
});

test.describe("Fragment Integration - Public Viewing", () => {
  test.use({ storageState: TEST_USERS.admin.authFile });
  test.skip(skipFragmentTests, "E2B_API_KEY not configured");

  test.beforeEach(async ({ page }) => {
    await setupChatTest(page);
  });

  test("should create deployable fragment and verify public URL format", async ({
    page,
  }) => {
    // Create and deploy fragment
    await sendMessageAndWaitForResponse(
      page,
      "Create a simple app",
      TIMEOUTS.long,
    );

    const deployResponse = await sendMessageAndWaitForResponse(
      page,
      "Deploy this fragment",
      TIMEOUTS.medium,
    );

    // Extract URL
    const urlMatch = deployResponse.match(/https?:\/\/[^\s]+/i);
    expect(urlMatch).toBeTruthy();

    if (urlMatch) {
      const url = urlMatch[0];
      // Should be a public fragment URL (format: /f/[shareId])
      expect(url).toMatch(/\/f\//);
    }
  });
});

test.describe("Fragment Integration - Template Switching", () => {
  test.use({ storageState: TEST_USERS.admin.authFile });
  test.skip(skipFragmentTests, "E2B_API_KEY not configured");

  test.beforeEach(async ({ page }) => {
    await setupChatTest(page);
  });

  test("should create fragments with different templates", async ({ page }) => {
    // Next.js app
    const nextjs = await sendMessageAndWaitForResponse(
      page,
      "Create a Next.js dashboard",
      TIMEOUTS.long,
    );
    expect(nextjs.toLowerCase()).toMatch(/created|nextjs|dashboard/i);

    // Vue app
    const vue = await sendMessageAndWaitForResponse(
      page,
      "Create a Vue.js component",
      TIMEOUTS.long,
    );
    expect(vue.toLowerCase()).toMatch(/created|vue/i);

    // Streamlit dashboard
    const streamlit = await sendMessageAndWaitForResponse(
      page,
      "Create a Streamlit data visualization",
      TIMEOUTS.long,
    );
    expect(streamlit.toLowerCase()).toMatch(/created|streamlit/i);
  });
});

test.describe("Fragment Integration - Error Recovery", () => {
  test.use({ storageState: TEST_USERS.admin.authFile });
  test.skip(skipFragmentTests, "E2B_API_KEY not configured");

  test.beforeEach(async ({ page }) => {
    await setupChatTest(page);
  });

  test("should recover from edit errors and allow retry", async ({ page }) => {
    // Create fragment
    await sendMessageAndWaitForResponse(
      page,
      "Create a simple app",
      TIMEOUTS.long,
    );

    // Try invalid edit (should fail gracefully)
    const invalidEdit = await sendMessageAndWaitForResponse(
      page,
      "Change the color to an invalid color name that doesn't exist",
      TIMEOUTS.medium,
    );

    // Should handle error
    expect(invalidEdit.toLowerCase()).toMatch(/error|unable|cannot|try/i);

    // Valid edit should still work
    const validEdit = await sendMessageAndWaitForResponse(
      page,
      "Change the background color to blue",
      TIMEOUTS.long,
    );
    expect(validEdit.toLowerCase()).toMatch(/edit|updated|changed/i);
  });
});

test.describe("Fragment Integration - Performance", () => {
  test.use({ storageState: TEST_USERS.admin.authFile });
  test.skip(skipFragmentTests, "E2B_API_KEY not configured");

  test.beforeEach(async ({ page }) => {
    await setupChatTest(page);
  });

  test("should complete fragment creation within reasonable time", async ({
    page,
  }) => {
    const startTime = Date.now();
    const response = await sendMessageAndWaitForResponse(
      page,
      "Create a simple hello world app",
      TIMEOUTS.long,
    );
    const duration = Date.now() - startTime;

    expect(response.toLowerCase()).toMatch(/created|success/i);
    // Should complete within timeout (this is a sanity check)
    expect(duration).toBeLessThan(TIMEOUTS.long);
  });

  test("should complete edits faster than initial creation", async ({
    page,
  }) => {
    // Create fragment
    const createStart = Date.now();
    await sendMessageAndWaitForResponse(
      page,
      "Create a simple app",
      TIMEOUTS.long,
    );
    const createDuration = Date.now() - createStart;

    // Edit fragment (should be faster due to persistence)
    const editStart = Date.now();
    await sendMessageAndWaitForResponse(
      page,
      "Change the title",
      TIMEOUTS.long,
    );
    const editDuration = Date.now() - editStart;

    // Edit should be faster (or at least not significantly slower)
    // Note: This is a soft check - actual timing varies
    expect(editDuration).toBeLessThan(createDuration * 2);
  });
});
