import { type Page, expect, test } from "@playwright/test";
import { TEST_USERS } from "../constants/test-users";
import {
  TIMEOUTS,
  clickEditButtonIfExists,
  sendMessageAndWaitForResponse,
  setupChatTest,
  waitForCollaboraEditor,
  waitForLoadingIndicator,
} from "../helpers/chat-test-helpers";

/**
 * E2E tests for Collabora CODE Integration
 * Tests WOPI protocol and document editing
 * Note: Requires COLLABORA_URL and WOPI_SECRET to be configured
 */

const skipCollaboraTests =
  !process.env.NEXT_PUBLIC_COLLABORA_URL || !process.env.WOPI_SECRET;

test.describe("Collabora Integration - Document Editing", () => {
  test.use({ storageState: TEST_USERS.admin.authFile });
  test.skip(skipCollaboraTests, "Collabora not configured");

  test.beforeEach(async ({ page }) => {
    await setupChatTest(page);
  });

  async function testCollaboraEditor(
    page: Page,
    message: string,
  ): Promise<void> {
    await sendMessageAndWaitForResponse(page, message);
    await page.waitForTimeout(5000);
    if (await clickEditButtonIfExists(page)) {
      const editorFrame = await waitForCollaboraEditor(page);
      await expect(editorFrame).toBeVisible({ timeout: TIMEOUTS.short });
    }
  }

  test("should open Collabora editor for Word document", async ({ page }) => {
    await testCollaboraEditor(page, "Create a Word document");
  });

  test("should open Collabora editor for Excel spreadsheet", async ({
    page,
  }) => {
    await testCollaboraEditor(page, "Create an Excel spreadsheet");
  });

  test("should handle Collabora editor loading states", async ({ page }) => {
    await sendMessageAndWaitForResponse(
      page,
      "Create a PowerPoint presentation",
    );

    await page.waitForTimeout(5000);

    if (await clickEditButtonIfExists(page)) {
      // Should show loading state or editor
      const loadingIndicator = await waitForLoadingIndicator(page);
      if (loadingIndicator) {
        await expect(loadingIndicator).toBeVisible();
      } else {
        const editorFrame = await waitForCollaboraEditor(page);
        await expect(editorFrame).toBeVisible({ timeout: TIMEOUTS.short });
      }
    }
  });
});
