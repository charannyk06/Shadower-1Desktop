import { Locator, Page, expect } from "@playwright/test";

/**
 * Helper functions to reduce duplication in sandbox execution tests
 */

/**
 * Navigate to home page and wait for it to load
 */
export async function navigateToHome(page: Page): Promise<void> {
  await page.goto("/");
  await page.waitForLoadState("networkidle");
}

/**
 * Get the chat input element and wait for it to be visible
 */
export async function getChatInput(page: Page) {
  const chatInput = page
    .locator('textarea[placeholder*="message"], [contenteditable="true"]')
    .first();
  await chatInput.waitFor({ state: "visible", timeout: 10000 });
  return chatInput;
}

/**
 * Send a message in the chat and wait for response
 */
export async function sendChatMessage(
  page: Page,
  message: string,
  waitTimeMs = 2000,
): Promise<void> {
  const chatInput = await getChatInput(page);
  await chatInput.fill(message);
  await chatInput.press("Enter");
  await page.waitForTimeout(waitTimeMs);
}

/**
 * Extract thread ID from current page URL
 */
export function extractThreadIdFromUrl(page: Page): string | null {
  const currentUrl = page.url();
  const threadIdMatch = currentUrl.match(/\/thread\/([^/]+)/);
  return threadIdMatch ? threadIdMatch[1] : null;
}

/**
 * Get the last assistant message response
 */
export async function getLastAssistantResponse(page: Page) {
  return page.locator('[data-message-role="assistant"]').last();
}

/**
 * Check if response contains expected text (case-insensitive)
 */
export async function responseContainsText(
  responseElement: Locator,
  patterns: string | string[],
): Promise<boolean> {
  const patternArray = Array.isArray(patterns) ? patterns : [patterns];
  const regexPattern = new RegExp(patternArray.join("|"), "i");
  return responseElement
    .locator(`text=${regexPattern}`)
    .isVisible()
    .catch(() => false);
}

/**
 * Wait for and verify assistant response is visible
 */
export async function waitForAssistantResponse(
  page: Page,
  timeout = 30000,
): Promise<Locator> {
  const responseContent = await getLastAssistantResponse(page);
  await expect(responseContent).toBeVisible({ timeout });
  return responseContent;
}

/**
 * Complete flow: navigate, send message, wait for response
 */
export async function executeSandboxRequest(
  page: Page,
  request: string,
  waitTimeMs = 5000,
): Promise<Locator> {
  await navigateToHome(page);
  await sendChatMessage(page, request, waitTimeMs);
  return waitForAssistantResponse(page);
}
