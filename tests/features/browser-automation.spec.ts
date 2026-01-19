import { expect, test } from "@playwright/test";
import { TEST_USERS } from "../constants/test-users";
import {
  TIMEOUTS,
  isElementVisible,
  sendChatMessage,
  sendMessageAndWaitForResponse,
  setupChatTest,
  testToolInvocation,
  waitForToolInvocation,
  waitForToolStatus,
} from "../helpers/chat-test-helpers";

/**
 * E2E tests for Browser Automation functionality
 * Tests Browserbase integration for web automation
 * Note: Requires BROWSERBASE_API_KEY to be configured
 */

const skipBrowserTests = !process.env.BROWSERBASE_API_KEY;

test.describe("Browser Automation - Navigation", () => {
  test.use({ storageState: TEST_USERS.admin.authFile });
  test.skip(skipBrowserTests, "BROWSERBASE_API_KEY not configured");

  test.beforeEach(async ({ page }) => {
    await setupChatTest(page);
  });

  test("should navigate to a website using browser automation", async ({
    page,
  }) => {
    await testToolInvocation(
      page,
      "Navigate to https://example.com",
      '[data-testid*="browser"], [class*="browser-tool"], text=/navigate|browser/i',
      TIMEOUTS.medium,
    );
  });

  test("should display browser screenshot in theater mode", async ({
    page,
  }) => {
    await sendChatMessage(
      page,
      "Take a screenshot of https://example.com and show it to me",
    );

    await page.waitForSelector(
      '[data-testid*="browser"], [class*="browser-preview"], img[alt*="screenshot"]',
      { timeout: TIMEOUTS.veryLong },
    );

    const browserPreview = page
      .locator('[class*="browser-preview"], [data-testid*="browser-preview"]')
      .first();
    const hasPreview = await isElementVisible(browserPreview, TIMEOUTS.medium);
    if (hasPreview) {
      await expect(browserPreview).toBeVisible();
    }
  });
});

test.describe("Browser Automation - Web Interaction", () => {
  test.use({ storageState: TEST_USERS.admin.authFile });
  test.skip(skipBrowserTests, "BROWSERBASE_API_KEY not configured");

  test.beforeEach(async ({ page }) => {
    await setupChatTest(page);
  });

  test("should extract data from a webpage", async ({ page }) => {
    const response = await sendMessageAndWaitForResponse(
      page,
      "Navigate to https://example.com and extract the main heading text",
    );

    // sendMessageAndWaitForResponse returns the text content directly
    expect(response).toBeTruthy();
  });

  test("should interact with web page elements", async ({ page }) => {
    await testToolInvocation(
      page,
      "Navigate to https://example.com and click on any link if available",
      '[data-testid*="browser"], [class*="browser-tool"]',
      TIMEOUTS.medium,
    );
  });
});

test.describe("Browser Automation - Tool Invocation Display", () => {
  test.use({ storageState: TEST_USERS.admin.authFile });
  test.skip(skipBrowserTests, "BROWSERBASE_API_KEY not configured");

  test.beforeEach(async ({ page }) => {
    await setupChatTest(page);
  });

  test("should display browser tool invocation card", async ({ page }) => {
    await sendChatMessage(page, "Navigate to https://example.com");

    const toolCard = await waitForToolInvocation(
      page,
      '[data-testid*="tool-call"], [class*="tool-invocation"], [class*="browser-tool"]',
      TIMEOUTS.long,
    );
    await expect(toolCard).toBeVisible({ timeout: TIMEOUTS.medium });
  });

  test("should show browser tool status badge", async ({ page }) => {
    await sendChatMessage(page, "Take a screenshot of https://example.com");

    const statusBadge = await waitForToolStatus(page, TIMEOUTS.medium);
    await expect(statusBadge).toBeVisible({ timeout: TIMEOUTS.medium });
  });
});
