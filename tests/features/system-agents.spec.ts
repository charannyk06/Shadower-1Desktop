import { type Page, expect, test } from "@playwright/test";
import { TEST_USERS } from "../constants/test-users";
import {
  TIMEOUTS,
  sendMessageAndWaitForResponse,
  setupChatTest,
  waitForSubAgent,
} from "../helpers/chat-test-helpers";

/**
 * E2E tests for System Agents functionality
 * Tests availability and usage of system agents (coding, computer-use, data-analysis, etc.)
 */

test.describe("System Agents - Availability", () => {
  test.use({ storageState: TEST_USERS.admin.authFile });

  test.beforeEach(async ({ page }) => {
    await page.goto("/agents");
    await page.waitForLoadState("networkidle");
  });

  test("should display system agents in agents list", async ({ page }) => {
    // Look for system agents section
    const systemAgentsSection = page
      .locator('text=/system agents/i, [data-testid*="system-agent"]')
      .first();

    const hasSystemSection = await systemAgentsSection
      .isVisible({ timeout: 10000 })
      .catch(() => false);

    if (hasSystemSection) {
      await expect(systemAgentsSection).toBeVisible();
    }

    // Look for specific system agents
    const codingAgent = page
      .locator(
        "text=/coding agent|computer use|data analysis|deep research|web automation/i",
      )
      .first();
    await expect(codingAgent).toBeVisible({ timeout: 10000 });
  });

  test("should show system agent cards with proper branding", async ({
    page,
  }) => {
    // Look for agent cards
    const agentCards = page.locator(
      '[data-testid*="agent-card"], [data-testid*="card"]',
    );
    await expect(agentCards.first()).toBeVisible({ timeout: 10000 });

    // Check for system agent branding (logo instead of text)
    const systemAgentCard = agentCards
      .filter({ hasText: /system|Shadower/i })
      .first();

    const hasSystemCard = await systemAgentCard
      .isVisible({ timeout: 5000 })
      .catch(() => false);

    if (hasSystemCard) {
      // Should show logo in footer, not "S Shadower" text
      const cardFooter = systemAgentCard
        .locator('[class*="card-footer"], [data-testid*="footer"]')
        .first();

      const footerLogo = cardFooter.locator('img[src*="logo"]').first();
      const hasLogo = await footerLogo
        .isVisible({ timeout: 3000 })
        .catch(() => false);

      // Should have logo OR not have text fallback
      const textFallback = cardFooter.locator("text=/^S Shadower$/").first();
      const hasTextFallback = await textFallback
        .isVisible({ timeout: 2000 })
        .catch(() => false);

      expect(hasLogo || !hasTextFallback).toBeTruthy();
    }
  });
});

test.describe("System Agents - Usage", () => {
  test.use({ storageState: TEST_USERS.admin.authFile });

  test.beforeEach(async ({ page }) => {
    await setupChatTest(page);
  });

  async function testAgentUsage(
    page: Page,
    message: string,
    selectorPattern: string,
  ): Promise<void> {
    await sendMessageAndWaitForResponse(page, message);
    await page.waitForSelector(selectorPattern, { timeout: TIMEOUTS.veryLong });
    const subAgent = await waitForSubAgent(page);
    await expect(subAgent).toBeVisible({ timeout: TIMEOUTS.medium });
  }

  test("should be able to use deep research agent", async ({ page }) => {
    await testAgentUsage(
      page,
      "Use the deep research agent to research AI trends",
      '[data-testid*="sub-agent"], [class*="sub-agent"], text=/deep research|research agent/i',
    );
  });

  test("should be able to use coding agent", async ({ page }) => {
    await testAgentUsage(
      page,
      "Use the coding agent to write a Python function",
      '[data-testid*="sub-agent"], [class*="sub-agent"], text=/coding|coding agent/i',
    );
  });

  test("should be able to use web automation agent", async ({ page }) => {
    await testAgentUsage(
      page,
      "Use the web automation agent to scrape a website",
      '[data-testid*="sub-agent"], [class*="sub-agent"], text=/web automation|automation agent/i',
    );
  });
});
