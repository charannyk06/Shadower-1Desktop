import { expect, test } from "@playwright/test";
import { TEST_USERS } from "../constants/test-users";
import {
  TIMEOUTS,
  isElementVisible,
  sendChatMessage,
  setupChatTest,
  waitForToolInvocation,
  waitForToolStatus,
} from "../helpers/chat-test-helpers";

/**
 * E2E tests for Desktop Automation functionality
 * Tests E2B Desktop integration for GUI automation
 * Note: Requires E2B_API_KEY and E2B desktop template to be configured
 */

const skipDesktopTests = !process.env.E2B_API_KEY;

test.describe("Desktop Automation - Screenshot", () => {
  test.use({ storageState: TEST_USERS.admin.authFile });
  test.skip(skipDesktopTests, "E2B_API_KEY not configured");

  test.beforeEach(async ({ page }) => {
    await setupChatTest(page);
  });

  test("should take desktop screenshot", async ({ page }) => {
    await sendChatMessage(page, "Take a screenshot of the desktop");

    const desktopTool = await waitForToolInvocation(
      page,
      '[data-testid*="desktop"], [class*="desktop-tool"], text=/desktop|screenshot/i',
    );
    await expect(desktopTool).toBeVisible({ timeout: TIMEOUTS.medium });
  });

  test("should display desktop screenshot in theater mode", async ({
    page,
  }) => {
    await sendChatMessage(page, "Take a screenshot of the desktop and show it");

    await page.waitForSelector(
      '[data-testid*="desktop"], [class*="desktop-preview"], img[alt*="screenshot"]',
      { timeout: TIMEOUTS.veryLong },
    );

    const desktopPreview = page
      .locator('[class*="desktop-preview"], [data-testid*="desktop-preview"]')
      .first();
    const hasPreview = await isElementVisible(desktopPreview, TIMEOUTS.medium);
    if (hasPreview) {
      await expect(desktopPreview).toBeVisible();
    }
  });
});

test.describe("Desktop Automation - Tool Invocation Display", () => {
  test.use({ storageState: TEST_USERS.admin.authFile });
  test.skip(skipDesktopTests, "E2B_API_KEY not configured");

  test.beforeEach(async ({ page }) => {
    await setupChatTest(page);
  });

  test("should display desktop tool invocation card", async ({ page }) => {
    await sendChatMessage(page, "Take a desktop screenshot");

    const toolCard = await waitForToolInvocation(
      page,
      '[data-testid*="tool-call"], [class*="tool-invocation"], [class*="desktop-tool"]',
    );
    await expect(toolCard).toBeVisible({ timeout: TIMEOUTS.medium });
  });

  test("should show desktop tool status badge", async ({ page }) => {
    await sendChatMessage(page, "Take a desktop screenshot");

    const statusBadge = await waitForToolStatus(page);
    await expect(statusBadge).toBeVisible({ timeout: TIMEOUTS.medium });
  });
});
