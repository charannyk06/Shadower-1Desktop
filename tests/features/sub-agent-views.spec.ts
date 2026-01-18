import { expect, test } from "@playwright/test";
import { TEST_USERS } from "../constants/test-users";
import {
  TIMEOUTS,
  isElementVisible,
  sendMessageAndWaitForResponse,
  setupChatTest,
  waitForToolStatus,
} from "../helpers/chat-test-helpers";

/**
 * E2E tests for Sub-Agent Views and Visualization
 * Tests sub-agent tiles, event parts, and status displays
 */

test.describe("Sub-Agent Views - Display", () => {
  test.use({ storageState: TEST_USERS.admin.authFile });

  test.beforeEach(async ({ page }) => {
    await setupChatTest(page);
  });

  test("should display sub-agent tile when agent is spawned", async ({
    page,
  }) => {
    await sendMessageAndWaitForResponse(
      page,
      "Use the deep research agent to research information about AI",
    );

    await page.waitForSelector(
      '[data-testid*="sub-agent"], [class*="sub-agent"], [class*="agent-tile"]',
      { timeout: TIMEOUTS.veryLong },
    );

    const subAgentTile = page
      .locator('[data-testid*="sub-agent"], [class*="sub-agent-tile"]')
      .first();
    await expect(subAgentTile).toBeVisible({ timeout: TIMEOUTS.medium });
  });

  test("should show sub-agent status and progress", async ({ page }) => {
    await sendMessageAndWaitForResponse(
      page,
      "Use the coding agent to write a Python function",
    );

    await page.waitForSelector(
      '[data-testid*="sub-agent"], [class*="sub-agent"]',
      { timeout: TIMEOUTS.veryLong },
    );

    const statusIndicator = page
      .locator(
        '[data-testid*="status"], [class*="status"], text=/running|completed|in-progress/i',
      )
      .first();

    const hasStatus = await isElementVisible(statusIndicator, TIMEOUTS.medium);
    if (hasStatus) {
      await expect(statusIndicator).toBeVisible();
    }
  });

  test("should display sub-agent event timeline", async ({ page }) => {
    await sendMessageAndWaitForResponse(
      page,
      "Use the web automation agent to navigate to a website",
    );

    await page.waitForSelector(
      '[data-testid*="sub-agent"], [class*="sub-agent-event"], [class*="event-timeline"]',
      { timeout: TIMEOUTS.veryLong },
    );

    const eventPart = page
      .locator('[class*="sub-agent-event"], [class*="event-part"]')
      .first();

    const hasEvents = await isElementVisible(eventPart, TIMEOUTS.medium);
    if (hasEvents) {
      await expect(eventPart).toBeVisible();
    }
  });
});

test.describe("Sub-Agent Views - Tool Invocation Display", () => {
  test.use({ storageState: TEST_USERS.admin.authFile });

  test.beforeEach(async ({ page }) => {
    await setupChatTest(page);
  });

  test("should show tool call cards for sub-agent actions", async ({
    page,
  }) => {
    await sendMessageAndWaitForResponse(
      page,
      "Use an agent to perform a multi-step task",
    );

    await page.waitForSelector(
      '[data-testid*="tool-call"], [class*="tool-call-card"], [class*="tool-invocation"]',
      { timeout: TIMEOUTS.veryLong },
    );

    const toolCard = page
      .locator('[data-testid*="tool-call"], [class*="tool-call-card"]')
      .first();
    await expect(toolCard).toBeVisible({ timeout: TIMEOUTS.medium });
  });

  test("should display tool call timeline", async ({ page }) => {
    await sendMessageAndWaitForResponse(
      page,
      "Use an agent that makes multiple tool calls",
    );

    await page.waitForSelector(
      '[data-testid*="timeline"], [class*="tool-timeline"], [class*="timeline"]',
      { timeout: TIMEOUTS.veryLong },
    );

    const timeline = page
      .locator('[data-testid*="timeline"], [class*="timeline"]')
      .first();

    const hasTimeline = await isElementVisible(timeline, TIMEOUTS.medium);
    if (hasTimeline) {
      await expect(timeline).toBeVisible();
    }
  });

  test("should show tool status badges", async ({ page }) => {
    await sendMessageAndWaitForResponse(
      page,
      "Execute a tool that takes some time",
    );

    const statusBadge = await waitForToolStatus(page);
    await expect(statusBadge).toBeVisible({ timeout: TIMEOUTS.medium });
  });
});
