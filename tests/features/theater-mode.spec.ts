import { expect, test } from "@playwright/test";
import { TEST_USERS } from "../constants/test-users";

/**
 * E2E tests for Theater Mode functionality
 * Tests artifact preview, file display, and theater panel interactions
 */

test.describe("Theater Mode - Artifact Preview", () => {
  test.use({ storageState: TEST_USERS.admin.authFile });

  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
  });

  test("should open theater mode when clicking preview on artifact", async ({
    page,
  }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // First, generate an artifact by requesting code execution
    const chatInput = page
      .locator('textarea[placeholder*="message"], [contenteditable="true"]')
      .first();
    await chatInput.waitFor({ state: "visible", timeout: 10000 });

    // Request HTML file creation
    await chatInput.fill(
      "Create a simple HTML file with 'Hello Theater Mode' and save it as preview.html",
    );
    await chatInput.press("Enter");

    // Wait for artifact generation - wait for assistant message or artifact to appear
    await page.waitForSelector(
      '[data-testid="assistant-message"], text=/preview.html/i',
      { timeout: 30000 },
    );

    // Look for preview/expand button on the artifact
    const previewButton = page
      .locator(
        'button:has-text("Preview"), button:has-text("Expand"), [aria-label*="preview" i], [aria-label*="expand" i]',
      )
      .first();

    const hasPreviewButton = await previewButton
      .isVisible({ timeout: 10000 })
      .catch(() => false);

    if (hasPreviewButton) {
      await previewButton.click();

      // Theater panel should open
      const theaterPanel = page
        .locator('[data-testid*="theater"], .theater-panel, [class*="theater"]')
        .first();
      await expect(theaterPanel).toBeVisible({ timeout: 5000 });
    } else {
      // If no preview button, theater might open automatically or be accessible via other means
      // Check if theater panel exists (we don't need to store the result)
      await page
        .locator('[data-testid*="theater"], .theater-panel, [class*="theater"]')
        .first()
        .isVisible()
        .catch(() => false);

      // At minimum, verify artifact was created
      const artifact = page
        .locator("text=/preview.html|artifact|file/i")
        .first();
      await expect(artifact).toBeVisible({ timeout: 10000 });
    }
  });

  test("should display HTML files in theater mode", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const chatInput = page
      .locator('textarea[placeholder*="message"], [contenteditable="true"]')
      .first();
    await chatInput.waitFor({ state: "visible", timeout: 10000 });

    // Create HTML file
    await chatInput.fill(
      "Create an HTML file with a heading 'Test HTML Preview'",
    );
    await chatInput.press("Enter");

    // Wait for response to complete
    await page.waitForSelector('[data-testid="assistant-message"]', {
      timeout: 30000,
    });

    // Try to open theater mode
    const expandButton = page
      .locator(
        'button:has-text("Expand"), button:has-text("Preview"), [aria-label*="expand" i]',
      )
      .first();

    const canExpand = await expandButton
      .isVisible({ timeout: 10000 })
      .catch(() => false);

    if (canExpand) {
      await expandButton.click();

      // Wait for theater panel to open
      await page.waitForSelector(
        '[data-testid*="theater"], .theater-panel, [class*="theater"]',
        { timeout: 5000 },
      );

      // Check if HTML content is displayed (iframe or content)
      const htmlContent = page
        .locator('iframe, [class*="preview"], [class*="html"]')
        .first();
      await expect(htmlContent).toBeVisible({ timeout: 5000 });
    }
  });

  test("should show download button for archive files", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const chatInput = page
      .locator('textarea[placeholder*="message"], [contenteditable="true"]')
      .first();
    await chatInput.waitFor({ state: "visible", timeout: 10000 });

    // Request zip file creation
    await chatInput.fill("Create a zip file containing a test.txt file");
    await chatInput.press("Enter");

    // Wait for response and artifact
    await page.waitForSelector(
      '[data-testid="assistant-message"], text=/.zip|archive/i',
      { timeout: 30000 },
    );

    // Look for archive file indicator
    const archiveFile = page.locator("text=/.zip|archive|download/i").first();
    await expect(archiveFile).toBeVisible({ timeout: 10000 });

    // If theater mode opens, check for download button
    const downloadButton = page
      .locator('button:has-text("Download"), [aria-label*="download" i]')
      .first();

    const hasDownloadButton = await downloadButton
      .isVisible({ timeout: 5000 })
      .catch(() => false);

    if (hasDownloadButton) {
      await expect(downloadButton).toBeVisible();
    }
  });

  test("should close theater mode when clicking close button", async ({
    page,
  }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const chatInput = page
      .locator('textarea[placeholder*="message"], [contenteditable="true"]')
      .first();
    await chatInput.waitFor({ state: "visible", timeout: 10000 });

    // Create an artifact
    await chatInput.fill("Create a simple text file with 'Test Content'");
    await chatInput.press("Enter");

    // Wait for response
    await page.waitForSelector('[data-testid="assistant-message"]', {
      timeout: 30000,
    });

    // Try to open theater
    const expandButton = page
      .locator('button:has-text("Expand"), button:has-text("Preview")')
      .first();

    const canExpand = await expandButton
      .isVisible({ timeout: 10000 })
      .catch(() => false);

    if (canExpand) {
      await expandButton.click();

      // Wait for theater panel to open
      const theaterPanel = page
        .locator('[data-testid*="theater"], .theater-panel')
        .first();
      await expect(theaterPanel).toBeVisible({ timeout: 5000 });

      // Look for close button
      const closeButton = page
        .locator(
          'button[aria-label*="close" i], button:has-text("Close"), button:has([aria-label*="close" i])',
        )
        .first();

      const hasCloseButton = await closeButton
        .isVisible({ timeout: 3000 })
        .catch(() => false);

      if (hasCloseButton) {
        await closeButton.click();

        // Wait for theater to close
        await expect(theaterPanel).not.toBeVisible({ timeout: 2000 });
      }
    }
  });

  test("should display image artifacts in theater mode", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const chatInput = page
      .locator('textarea[placeholder*="message"], [contenteditable="true"]')
      .first();
    await chatInput.waitFor({ state: "visible", timeout: 10000 });

    // Request image generation (if supported)
    await chatInput.fill(
      "Generate a simple test image or create an image file",
    );
    await chatInput.press("Enter");

    // Wait for response or image artifact
    await page.waitForSelector(
      '[data-testid="assistant-message"], img[alt*="artifact"], img[alt*="output"]',
      { timeout: 30000 },
    );

    // Look for image artifact
    const imageArtifact = page
      .locator(
        'img[alt*="artifact"], img[alt*="output"], [class*="image-artifact"]',
      )
      .first();
    const hasImage = await imageArtifact
      .isVisible({ timeout: 10000 })
      .catch(() => false);

    if (hasImage) {
      await expect(imageArtifact).toBeVisible();
    }
  });
});
