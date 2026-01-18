import { Locator, Page } from "@playwright/test";

/**
 * Helper functions for chat-related E2E tests.
 * These utilities help reduce duplication across feature test files.
 */

/**
 * Common selectors used across chat tests
 */
export const CHAT_SELECTORS = {
  input: 'textarea[placeholder*="message"], [contenteditable="true"]',
  assistantMessage: '[data-testid="assistant-message"]',
  toolCall: '[data-testid*="tool-call"], [class*="tool-invocation"]',
  toolStatus:
    '[data-testid*="tool-status"], [class*="tool-status-badge"], [class*="status-badge"]',
  subAgent: '[data-testid*="sub-agent"], [class*="sub-agent"]',
  theaterPanel: '[data-testid*="theater"], .theater-panel',
  previewButton: 'button:has-text("Preview"), button:has-text("Expand")',
  editButton: 'button:has-text("Edit"), button:has-text("Open in Editor")',
} as const;

/**
 * Common timeouts used across tests
 */
export const TIMEOUTS = {
  short: 5000,
  medium: 10000,
  long: 30000,
  veryLong: 60000,
} as const;

/**
 * Gets the chat input element and waits for it to be visible
 */
export async function getChatInput(
  page: Page,
  timeout: 10000 = TIMEOUTS.medium,
): Promise<Locator> {
  const chatInput = page.locator(CHAT_SELECTORS.input).first();
  await chatInput.waitFor({ state: "visible", timeout });
  return chatInput;
}

/**
 * Sends a message in the chat input
 */
export async function sendChatMessage(
  page: Page,
  message: string,
  timeout: 10000 = TIMEOUTS.medium,
): Promise<void> {
  const chatInput = await getChatInput(page, timeout);
  await chatInput.fill(message);
  await chatInput.press("Enter");
}

/**
 * Waits for an assistant message to appear
 */
export async function waitForAssistantMessage(
  page: Page,
  timeout: 60000 = TIMEOUTS.veryLong,
): Promise<Locator> {
  await page.waitForSelector(CHAT_SELECTORS.assistantMessage, { timeout });
  return page.locator(CHAT_SELECTORS.assistantMessage).last();
}

/**
 * Sends a chat message and waits for the assistant response
 */
export async function sendMessageAndWaitForResponse(
  page: Page,
  message: string,
  options?: {
    inputTimeout?: 10000;
    responseTimeout?: 60000;
  },
): Promise<Locator> {
  await sendChatMessage(
    page,
    message,
    (options?.inputTimeout as 10000 | undefined) ?? TIMEOUTS.medium,
  );
  return waitForAssistantMessage(
    page,
    (options?.responseTimeout as 60000 | undefined) ?? TIMEOUTS.veryLong,
  );
}

/**
 * Common beforeEach setup for chat tests
 */
export async function setupChatTest(page: Page): Promise<void> {
  await page.goto("/");
  await page.waitForLoadState("networkidle");
}

/**
 * Waits for a tool invocation to appear
 */
export async function waitForToolInvocation(
  page: Page,
  toolSelector?: string,
  timeout: 10000 | 30000 | 60000 = TIMEOUTS.veryLong,
): Promise<Locator> {
  const selector = toolSelector || CHAT_SELECTORS.toolCall;
  await page.waitForSelector(selector, { timeout });
  return page.locator(selector).first();
}

/**
 * Waits for a tool status badge to appear
 */
export async function waitForToolStatus(
  page: Page,
  timeout: 10000 | 30000 | 60000 = TIMEOUTS.veryLong,
): Promise<Locator> {
  await page.waitForSelector(CHAT_SELECTORS.toolStatus, { timeout });
  return page.locator(CHAT_SELECTORS.toolStatus).first();
}

/**
 * Checks if an element is visible, returning false if it times out
 */
export async function isElementVisible(
  locator: Locator,
  timeout: 10000 | 30000 | 60000 = TIMEOUTS.medium,
): Promise<boolean> {
  return locator.isVisible({ timeout: timeout as 10000 }).catch(() => false);
}

/**
 * Waits for a sub-agent to appear
 */
export async function waitForSubAgent(
  page: Page,
  timeout = TIMEOUTS.veryLong,
): Promise<Locator> {
  await page.waitForSelector(CHAT_SELECTORS.subAgent, { timeout });
  return page.locator(CHAT_SELECTORS.subAgent).first();
}

/**
 * Waits for theater mode panel to appear
 */
export async function waitForTheaterPanel(
  page: Page,
  timeout = TIMEOUTS.short,
): Promise<Locator> {
  await page.waitForSelector(CHAT_SELECTORS.theaterPanel, { timeout });
  return page.locator(CHAT_SELECTORS.theaterPanel).first();
}

/**
 * Clicks a preview/expand button if it exists
 */
export async function clickPreviewButtonIfExists(
  page: Page,
  timeout = TIMEOUTS.medium,
): Promise<boolean> {
  const previewButton = page.locator(CHAT_SELECTORS.previewButton).first();
  const canPreview = await isElementVisible(previewButton, timeout);
  if (canPreview) {
    await previewButton.click();
    await page.waitForTimeout(3000); // Wait for animation
    return true;
  }
  return false;
}

/**
 * Clicks an edit button if it exists
 */
export async function clickEditButtonIfExists(
  page: Page,
  timeout = TIMEOUTS.medium,
): Promise<boolean> {
  const editButton = page.locator(CHAT_SELECTORS.editButton).first();
  const canEdit = await isElementVisible(editButton, timeout);
  if (canEdit) {
    await editButton.click();
    return true;
  }
  return false;
}

/**
 * Waits for a Collabora editor iframe to appear
 */
export async function waitForCollaboraEditor(
  page: Page,
  timeout = TIMEOUTS.medium,
): Promise<Locator> {
  await page.waitForSelector(
    'iframe[src*="collabora"], iframe[src*="wopi"], [class*="collabora-editor"]',
    { timeout },
  );
  return page.locator('iframe[src*="collabora"], iframe[src*="wopi"]').first();
}

/**
 * Waits for a file type indicator (e.g., .pptx, .docx, .xlsx)
 */
export async function waitForFileType(
  page: Page,
  filePattern: RegExp | string,
  timeout = TIMEOUTS.long,
): Promise<Locator> {
  const pattern =
    typeof filePattern === "string"
      ? new RegExp(filePattern, "i")
      : filePattern;
  const selector = `text=${pattern}`;
  await page.waitForSelector(selector, { timeout });
  return page.locator(selector).first();
}

/**
 * Waits for a loading indicator
 */
export async function waitForLoadingIndicator(
  page: Page,
  timeout: 10000 = TIMEOUTS.medium,
): Promise<Locator | null> {
  const loadingSelector = page
    .locator(
      'text=/loading|Loading|connecting/i, [class*="loading"], [class*="spinner"]',
    )
    .first();
  const isLoading = await isElementVisible(loadingSelector, timeout);
  return isLoading ? loadingSelector : null;
}

/**
 * Creates a test suite helper that sets up common test configuration
 */
export function createTestSuite(config: {
  skipCondition?: boolean;
  skipMessage?: string;
  storageState?: string;
}) {
  return {
    use: (test: typeof import("@playwright/test").test) => {
      if (config.storageState) {
        test.use({ storageState: config.storageState });
      }
      if (config.skipCondition) {
        test.skip(config.skipCondition, config.skipMessage || "Test skipped");
      }
    },
    beforeEach: setupChatTest,
  };
}

/**
 * Helper to create a test that sends a message and waits for a file type
 */
export async function testFileCreation(
  page: Page,
  message: string,
  filePattern: RegExp | string,
): Promise<void> {
  await sendMessageAndWaitForResponse(page, message);
  const file = await waitForFileType(page, filePattern);
  const { expect } = await import("@playwright/test");
  await expect(file).toBeVisible({ timeout: TIMEOUTS.long });
}

/**
 * Helper to create a test that sends a message and checks for preview/theater mode
 */
export async function testPreviewInTheaterMode(
  page: Page,
  message: string,
): Promise<void> {
  await sendMessageAndWaitForResponse(page, message);
  if (await clickPreviewButtonIfExists(page)) {
    const theaterPanel = await waitForTheaterPanel(page);
    const { expect } = await import("@playwright/test");
    await expect(theaterPanel).toBeVisible({ timeout: TIMEOUTS.short });
  }
}

/**
 * Helper to test sub-agent spawning with a specific message and selector pattern
 */
export async function testSubAgentSpawn(
  page: Page,
  message: string,
  selectorPattern: string,
): Promise<void> {
  await sendMessageAndWaitForResponse(page, message);
  await page.waitForSelector(selectorPattern, { timeout: TIMEOUTS.veryLong });
  const subAgent = await waitForSubAgent(page);
  const { expect } = await import("@playwright/test");
  await expect(subAgent).toBeVisible({ timeout: TIMEOUTS.long });
}

/**
 * Helper to test tool invocation with a specific message and selector
 */
export async function testToolInvocation(
  page: Page,
  message: string,
  toolSelector: string,
  expectTimeout: 10000 | 60000 = TIMEOUTS.medium,
): Promise<void> {
  await sendChatMessage(page, message);
  const tool = await waitForToolInvocation(page, toolSelector, TIMEOUTS.long);
  const { expect } = await import("@playwright/test");
  await expect(tool).toBeVisible({ timeout: expectTimeout });
}
