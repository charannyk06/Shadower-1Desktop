import { type Page, expect, test } from "@playwright/test";
import { TEST_USERS } from "../constants/test-users";
import {
  TIMEOUTS,
  clickPreviewButtonIfExists,
  sendMessageAndWaitForResponse,
  setupChatTest,
  waitForFileType,
  waitForTheaterPanel,
} from "../helpers/chat-test-helpers";

/**
 * E2E tests for Document Agent functionality
 * Tests presentation, document, and spreadsheet generation
 * Note: Requires E2B_API_KEY for document generation
 */

const skipDocumentTests = !process.env.E2B_API_KEY;

test.describe("Document Agent - Presentation Generation", () => {
  test.use({ storageState: TEST_USERS.admin.authFile });
  test.skip(skipDocumentTests, "E2B_API_KEY not configured");

  test.beforeEach(async ({ page }) => {
    await setupChatTest(page);
  });

  async function testPresentationCreation(
    page: Page,
    message: string,
  ): Promise<void> {
    await sendMessageAndWaitForResponse(page, message);
    const pptxFile = await waitForFileType(
      page,
      /\.pptx|powerpoint|presentation/i,
    );
    await expect(pptxFile).toBeVisible({ timeout: TIMEOUTS.medium });
  }

  test("should create a PowerPoint presentation", async ({ page }) => {
    await testPresentationCreation(
      page,
      "Create a PowerPoint presentation with 3 slides: title slide, content slide, and conclusion slide",
    );
  });

  test("should create presentation with custom color palette", async ({
    page,
  }) => {
    await testPresentationCreation(
      page,
      "Create a PowerPoint presentation with the vibrant-purple color palette",
    );
  });

  test("should preview presentation in theater mode", async ({ page }) => {
    await sendMessageAndWaitForResponse(
      page,
      "Create a simple PowerPoint presentation",
    );

    if (await clickPreviewButtonIfExists(page)) {
      const theaterPanel = await waitForTheaterPanel(page);
      await expect(theaterPanel).toBeVisible({ timeout: TIMEOUTS.short });
    }
  });
});

test.describe("Document Agent - Document Generation", () => {
  test.use({ storageState: TEST_USERS.admin.authFile });
  test.skip(skipDocumentTests, "E2B_API_KEY not configured");

  test.beforeEach(async ({ page }) => {
    await setupChatTest(page);
  });

  test("should create a Word document", async ({ page }) => {
    await sendMessageAndWaitForResponse(
      page,
      "Create a Word document with a title, introduction paragraph, and bullet points",
    );

    const docxFile = await waitForFileType(
      page,
      /\.docx|word document|document/i,
    );
    await expect(docxFile).toBeVisible({ timeout: TIMEOUTS.medium });
  });

  test("should create document with table of contents", async ({ page }) => {
    await sendMessageAndWaitForResponse(
      page,
      "Create a Word document with table of contents and multiple sections",
    );

    const docxFile = await waitForFileType(page, /\.docx|word document/i);
    await expect(docxFile).toBeVisible({ timeout: TIMEOUTS.medium });
  });
});

test.describe("Document Agent - Spreadsheet Generation", () => {
  test.use({ storageState: TEST_USERS.admin.authFile });
  test.skip(skipDocumentTests, "E2B_API_KEY not configured");

  test.beforeEach(async ({ page }) => {
    await setupChatTest(page);
  });

  async function testSpreadsheetCreation(
    page: Page,
    message: string,
    pattern: RegExp = /\.xlsx|excel|spreadsheet/i,
  ): Promise<void> {
    await sendMessageAndWaitForResponse(page, message);
    const xlsxFile = await waitForFileType(page, pattern);
    await expect(xlsxFile).toBeVisible({ timeout: TIMEOUTS.medium });
  }

  test("should create an Excel spreadsheet", async ({ page }) => {
    await testSpreadsheetCreation(
      page,
      "Create an Excel spreadsheet with columns: Name, Age, City and 5 rows of sample data",
    );
  });

  test("should create spreadsheet with multiple sheets", async ({ page }) => {
    await testSpreadsheetCreation(
      page,
      "Create an Excel workbook with 3 sheets: Sales, Expenses, and Summary",
      /\.xlsx|excel/i,
    );
  });

  test("should preview spreadsheet in theater mode", async ({ page }) => {
    await sendMessageAndWaitForResponse(
      page,
      "Create a simple Excel spreadsheet",
    );

    if (await clickPreviewButtonIfExists(page)) {
      const theaterPanel = await waitForTheaterPanel(page);
      await expect(theaterPanel).toBeVisible({ timeout: TIMEOUTS.short });
    }
  });
});

test.describe("Document Agent - Document Editing", () => {
  test.use({ storageState: TEST_USERS.admin.authFile });
  test.skip(skipDocumentTests, "E2B_API_KEY not configured");

  test.beforeEach(async ({ page }) => {
    await setupChatTest(page);
  });

  test("should edit an existing spreadsheet", async ({ page }) => {
    // First create a spreadsheet
    await sendMessageAndWaitForResponse(
      page,
      "Create an Excel file with 3 rows of data",
    );

    // Wait for file to be created
    await page.waitForTimeout(5000);

    // Then edit it
    await sendMessageAndWaitForResponse(
      page,
      "Add 2 more rows to the spreadsheet",
    );

    // Should show updated file
    const updatedFile = await waitForFileType(page, /\.xlsx|updated/i);
    await expect(updatedFile).toBeVisible({ timeout: TIMEOUTS.medium });
  });
});
