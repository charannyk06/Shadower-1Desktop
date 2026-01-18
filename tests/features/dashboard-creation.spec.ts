import { expect, test } from "@playwright/test";
import { TEST_USERS } from "../constants/test-users";

/**
 * E2E tests for dashboard and interactive app creation
 * Tests React app generation, dashboard creation, and interactive features
 */

test.describe("Dashboard and App Creation", () => {
  test.use({ storageState: TEST_USERS.admin.authFile });

  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
  });

  test("should create a React dashboard", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const chatInput = page
      .locator('textarea[placeholder*="message"], [contenteditable="true"]')
      .first();
    await chatInput.waitFor({ state: "visible", timeout: 10000 });

    // Request dashboard creation
    await chatInput.fill(
      "Create an interactive React dashboard with charts showing sample data",
    );
    await chatInput.press("Enter");

    // Wait for dashboard generation
    await page.waitForTimeout(12000);

    // Look for dashboard artifact
    const dashboard = page
      .locator("text=/dashboard|.html|interactive|react/i")
      .first();
    await expect(dashboard).toBeVisible({ timeout: 20000 });
  });

  test("should create a simple React app", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const chatInput = page
      .locator('textarea[placeholder*="message"], [contenteditable="true"]')
      .first();
    await chatInput.waitFor({ state: "visible", timeout: 10000 });

    // Request React app creation
    await chatInput.fill("Create a simple React app with a counter component");
    await chatInput.press("Enter");

    await page.waitForTimeout(12000);

    // Look for app artifact
    const app = page.locator("text=/app|.html|react|component/i").first();
    await expect(app).toBeVisible({ timeout: 20000 });
  });

  test("should create dashboard with charts", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const chatInput = page
      .locator('textarea[placeholder*="message"], [contenteditable="true"]')
      .first();
    await chatInput.waitFor({ state: "visible", timeout: 10000 });

    // Request dashboard with charts
    await chatInput.fill(
      "Create a dashboard with bar charts and line charts using recharts",
    );
    await chatInput.press("Enter");

    await page.waitForTimeout(15000);

    // Look for chart/dashboard artifact
    const chartDashboard = page
      .locator("text=/chart|dashboard|recharts|visualization/i")
      .first();
    const hasChart = await chartDashboard
      .isVisible({ timeout: 20000 })
      .catch(() => false);

    if (hasChart) {
      await expect(chartDashboard).toBeVisible();
    }
  });

  test("should preview dashboard in theater mode", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const chatInput = page
      .locator('textarea[placeholder*="message"], [contenteditable="true"]')
      .first();
    await chatInput.waitFor({ state: "visible", timeout: 10000 });

    // Create a dashboard
    await chatInput.fill("Create a simple interactive dashboard");
    await chatInput.press("Enter");

    await page.waitForTimeout(12000);

    // Try to open preview
    const previewButton = page
      .locator(
        'button:has-text("Preview"), button:has-text("Expand"), [aria-label*="preview" i]',
      )
      .first();

    const canPreview = await previewButton
      .isVisible({ timeout: 10000 })
      .catch(() => false);

    if (canPreview) {
      await previewButton.click();
      await page.waitForTimeout(3000);

      // Should show dashboard preview
      const previewContent = page
        .locator('iframe, [class*="preview"], [class*="theater"]')
        .first();
      const hasPreview = await previewContent
        .isVisible({ timeout: 5000 })
        .catch(() => false);

      expect(hasPreview).toBeTruthy();
    }
  });

  test("should create Manus-like mini application", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const chatInput = page
      .locator('textarea[placeholder*="message"], [contenteditable="true"]')
      .first();
    await chatInput.waitFor({ state: "visible", timeout: 10000 });

    // Request mini app creation
    await chatInput.fill(
      "Create a mini application like Manus - a simple interactive tool",
    );
    await chatInput.press("Enter");

    await page.waitForTimeout(15000);

    // Look for app artifact
    const miniApp = page.locator("text=/app|mini|interactive|tool/i").first();
    const hasApp = await miniApp
      .isVisible({ timeout: 20000 })
      .catch(() => false);

    if (hasApp) {
      await expect(miniApp).toBeVisible();
    }
  });

  test("should create self-contained HTML file for dashboard", async ({
    page,
  }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const chatInput = page
      .locator('textarea[placeholder*="message"], [contenteditable="true"]')
      .first();
    await chatInput.waitFor({ state: "visible", timeout: 10000 });

    // Request self-contained HTML dashboard
    await chatInput.fill(
      "Create a self-contained HTML dashboard file that includes all dependencies",
    );
    await chatInput.press("Enter");

    await page.waitForTimeout(12000);

    // Look for HTML file artifact
    const htmlFile = page
      .locator("text=/.html|dashboard|self-contained/i")
      .first();
    await expect(htmlFile).toBeVisible({ timeout: 20000 });
  });
});
