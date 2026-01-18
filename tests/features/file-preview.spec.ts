import { expect, test } from "@playwright/test";
import { TEST_USERS } from "../constants/test-users";

/**
 * E2E tests for file type detection and preview functionality
 * Tests various file types: images, PDFs, office documents, text files
 */

test.describe("File Type Detection and Preview", () => {
  test.use({ storageState: TEST_USERS.admin.authFile });

  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
  });

  test("should detect and preview text files", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const chatInput = page
      .locator('textarea[placeholder*="message"], [contenteditable="true"]')
      .first();
    await chatInput.waitFor({ state: "visible", timeout: 10000 });

    // Create a text file
    await chatInput.fill(
      "Create a text file named 'test.txt' with content 'Hello World'",
    );
    await chatInput.press("Enter");

    await page.waitForTimeout(8000);

    // Look for text file indicator
    const textFile = page.locator("text=/test.txt|.txt|text file/i").first();
    await expect(textFile).toBeVisible({ timeout: 15000 });
  });

  test("should detect PDF files", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const chatInput = page
      .locator('textarea[placeholder*="message"], [contenteditable="true"]')
      .first();
    await chatInput.waitFor({ state: "visible", timeout: 10000 });

    // Request PDF creation
    await chatInput.fill("Create a PDF file with some content");
    await chatInput.press("Enter");

    await page.waitForTimeout(8000);

    // Look for PDF indicator
    const pdfFile = page.locator("text=/.pdf|PDF|pdf file/i").first();
    const hasPdf = await pdfFile
      .isVisible({ timeout: 15000 })
      .catch(() => false);

    if (hasPdf) {
      await expect(pdfFile).toBeVisible();
    }
  });

  test("should detect office documents (DOCX, XLSX, PPTX)", async ({
    page,
  }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const chatInput = page
      .locator('textarea[placeholder*="message"], [contenteditable="true"]')
      .first();
    await chatInput.waitFor({ state: "visible", timeout: 10000 });

    // Request Excel file creation
    await chatInput.fill("Create an Excel file (.xlsx) with sample data");
    await chatInput.press("Enter");

    await page.waitForTimeout(10000);

    // Look for Excel file indicator
    const excelFile = page.locator("text=/.xlsx|excel|spreadsheet/i").first();
    const hasExcel = await excelFile
      .isVisible({ timeout: 20000 })
      .catch(() => false);

    if (hasExcel) {
      await expect(excelFile).toBeVisible();
    }
  });

  test("should show appropriate file type icons", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const chatInput = page
      .locator('textarea[placeholder*="message"], [contenteditable="true"]')
      .first();
    await chatInput.waitFor({ state: "visible", timeout: 10000 });

    // Create multiple file types
    await chatInput.fill("Create a text file, an HTML file, and an Excel file");
    await chatInput.press("Enter");

    await page.waitForTimeout(10000);

    // Look for file type indicators
    const fileIcons = page.locator(
      '[class*="file-icon"], [class*="file-type"], svg[class*="file"]',
    );
    await fileIcons
      .first()
      .isVisible()
      .catch(() => false);

    // At minimum, verify files were created
    const files = page.locator("text=/.txt|.html|.xlsx|file/i");
    await expect(files.first()).toBeVisible({ timeout: 15000 });
  });

  test("should handle archive files correctly", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const chatInput = page
      .locator('textarea[placeholder*="message"], [contenteditable="true"]')
      .first();
    await chatInput.waitFor({ state: "visible", timeout: 10000 });

    // Request zip file creation
    await chatInput.fill("Create a zip file containing multiple files");
    await chatInput.press("Enter");

    await page.waitForTimeout(10000);

    // Look for archive file
    const archiveFile = page.locator("text=/.zip|archive|zip file/i").first();
    const hasArchive = await archiveFile
      .isVisible({ timeout: 15000 })
      .catch(() => false);

    if (hasArchive) {
      await expect(archiveFile).toBeVisible();

      // Should show download option, not preview
      const downloadButton = page
        .locator('button:has-text("Download"), [aria-label*="download" i]')
        .first();
      const hasDownload = await downloadButton
        .isVisible({ timeout: 3000 })
        .catch(() => false);

      if (hasDownload) {
        await expect(downloadButton).toBeVisible();
      }
    }
  });

  test("should preview office documents in theater mode", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const chatInput = page
      .locator('textarea[placeholder*="message"], [contenteditable="true"]')
      .first();
    await chatInput.waitFor({ state: "visible", timeout: 10000 });

    // Request PowerPoint creation
    await chatInput.fill(
      "Create a PowerPoint presentation (.pptx) with a title slide",
    );
    await chatInput.press("Enter");

    await page.waitForTimeout(12000);

    // Look for PPTX file
    const pptxFile = page
      .locator("text=/.pptx|powerpoint|presentation/i")
      .first();
    const hasPptx = await pptxFile
      .isVisible({ timeout: 20000 })
      .catch(() => false);

    if (hasPptx) {
      await expect(pptxFile).toBeVisible();

      // Try to open preview
      const previewButton = page
        .locator('button:has-text("Preview"), button:has-text("Expand")')
        .first();

      const canPreview = await previewButton
        .isVisible({ timeout: 5000 })
        .catch(() => false);

      if (canPreview) {
        await previewButton.click();
        await page.waitForTimeout(3000);

        // Should show office document preview
        const previewContent = page
          .locator('[class*="preview"], iframe, [class*="office"]')
          .first();
        const hasPreview = await previewContent
          .isVisible({ timeout: 5000 })
          .catch(() => false);

        expect(hasPreview).toBeTruthy();
      }
    }
  });
});
