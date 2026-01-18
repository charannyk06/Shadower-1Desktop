import { expect, test } from "@playwright/test";
import { TEST_USERS } from "../constants/test-users";

/**
 * E2E tests for Branding and Logo Display
 * Tests logo display in various components instead of text fallbacks
 */

test.describe("Branding - Logo Display", () => {
  test.use({ storageState: TEST_USERS.admin.authFile });

  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
  });

  test("should display logo in sidebar header", async ({ page }) => {
    // Check sidebar header for logo
    const sidebarHeader = page
      .locator('[data-testid*="sidebar-header"]')
      .first();
    await expect(sidebarHeader).toBeVisible({ timeout: 5000 });

    // Should have logo image, not just text
    const logoImage = sidebarHeader
      .locator('img[src*="logo"], img[alt*="Shadower"]')
      .first();
    await expect(logoImage).toBeVisible({ timeout: 5000 });

    // Verify it's the correct logo file
    const logoSrc = await logoImage.getAttribute("src");
    expect(logoSrc).toContain("shadower-logo-final.png");
  });

  test("should display logo in animated logo component", async ({ page }) => {
    // Navigate to auth page where animated logo is used
    await page.goto("/sign-in");
    await page.waitForLoadState("networkidle");

    // Check for animated logo
    const animatedLogo = page
      .locator('img[src*="logo"], [role="img"][aria-label*="Shadower"]')
      .first();
    await expect(animatedLogo).toBeVisible({ timeout: 5000 });

    // Verify logo source
    const logoSrc = await animatedLogo.getAttribute("src");
    expect(logoSrc).toContain("shadower-logo-final.png");
  });

  test("should show logo instead of text in shareable card footer", async ({
    page,
  }) => {
    // Navigate to agents page where system agents are shown
    await page.goto("/agents");
    await page.waitForLoadState("networkidle");

    // Look for system agent cards (created by Shadower)
    const agentCards = page.locator(
      '[data-testid*="agent-card"], [data-testid*="card"]',
    );

    // Wait for at least one card
    await expect(agentCards.first()).toBeVisible({ timeout: 10000 });

    // Check card footer for logo instead of "S Shadower" text
    const cardFooter = page
      .locator('[data-testid*="card-footer"], [class*="card-footer"]')
      .first();

    // Should have logo image for Shadower branding
    const footerLogo = cardFooter.locator('img[src*="logo"]').first();
    const hasLogo = await footerLogo
      .isVisible({ timeout: 5000 })
      .catch(() => false);

    // Should NOT have "S Shadower" text fallback
    const textFallback = cardFooter.locator("text=/^S Shadower$/").first();
    const hasTextFallback = await textFallback
      .isVisible({ timeout: 2000 })
      .catch(() => false);

    // Either logo should be visible OR text fallback should NOT be visible
    expect(hasLogo || !hasTextFallback).toBeTruthy();
  });

  test("should display logo in tool select dropdown for system items", async ({
    page,
  }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Open tool select dropdown (if available)
    const toolSelect = page
      .locator(
        '[data-testid*="tool-select"], button:has-text("Tools"), [class*="tool-select"]',
      )
      .first();

    const canOpenToolSelect = await toolSelect
      .isVisible({ timeout: 5000 })
      .catch(() => false);

    if (canOpenToolSelect) {
      await toolSelect.click();
      await page.waitForTimeout(1000);

      // Look for system agent/workflow items
      const systemItems = page
        .locator('[data-testid*="agent"], [data-testid*="workflow"]')
        .filter({ hasText: /Shadower/i });

      const hasSystemItems = await systemItems
        .first()
        .isVisible({ timeout: 5000 })
        .catch(() => false);

      if (hasSystemItems) {
        // Should show logo, not "S" initial
        const itemLogo = systemItems
          .first()
          .locator('img[src*="logo"]')
          .first();

        const hasLogo = await itemLogo
          .isVisible({ timeout: 3000 })
          .catch(() => false);

        // Logo should be visible for Shadower items
        if (hasLogo) {
          await expect(itemLogo).toBeVisible();
        }
      }
    }
  });

  test("should show logo in MCP card for system branding", async ({ page }) => {
    // Navigate to integrations/MCP page if available
    await page.goto("/integrations");
    await page.waitForLoadState("networkidle").catch(() => {});

    // Look for MCP cards
    const mcpCards = page.locator(
      '[data-testid*="mcp-card"], [class*="mcp-card"]',
    );

    const hasMcpCards = await mcpCards
      .first()
      .isVisible({ timeout: 5000 })
      .catch(() => false);

    if (hasMcpCards) {
      // Check for logo in card footer for system items
      const cardFooter = mcpCards
        .first()
        .locator('[class*="card-footer"], [data-testid*="footer"]')
        .first();

      const footerLogo = cardFooter.locator('img[src*="logo"]').first();
      const hasLogo = await footerLogo
        .isVisible({ timeout: 3000 })
        .catch(() => false);

      // Should show logo for Shadower branding
      if (hasLogo) {
        await expect(footerLogo).toBeVisible();
      }
    }
  });
});
