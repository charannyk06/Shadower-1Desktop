import { Browser, BrowserContext, Page } from "@playwright/test";
import { TEST_USERS } from "../constants/test-users";

// Only include user types that have authFile (exclude banned, testUsers)
type TestUserType = "admin" | "editor" | "editor2" | "regular";

interface TestContext {
  context: BrowserContext;
  page: Page;
}

/**
 * Creates a browser context with the specified user's authentication state
 * and navigates to the given URL.
 *
 * @param browser - Playwright Browser instance
 * @param userType - The type of user to authenticate as (regular, admin, editor)
 * @param url - The URL to navigate to
 * @returns TestContext with page and context
 */
export async function createTestContext(
  browser: Browser,
  userType: TestUserType,
  url: string,
): Promise<TestContext> {
  const user = TEST_USERS[userType] as { authFile: string };
  const context = await browser.newContext({
    storageState: user.authFile,
  });
  const page = await context.newPage();

  await page.goto(url);
  await page.waitForLoadState("networkidle");

  return { context, page };
}

/**
 * Closes the browser context properly
 *
 * @param testContext - The test context to close
 */
export async function closeTestContext(
  testContext: TestContext,
): Promise<void> {
  await testContext.context.close();
}

/**
 * Higher-order function that wraps a test with context setup and teardown.
 * Eliminates boilerplate for creating and closing browser contexts.
 *
 * @param browser - Playwright Browser instance
 * @param userType - The type of user to authenticate as
 * @param url - The URL to navigate to
 * @param testFn - The test function to execute with the page
 */
export async function withTestContext(
  browser: Browser,
  userType: TestUserType,
  url: string,
  testFn: (page: Page) => Promise<void>,
): Promise<void> {
  const { context, page } = await createTestContext(browser, userType, url);
  try {
    await testFn(page);
  } finally {
    await context.close();
  }
}

/**
 * Creates a test context for a regular user
 */
export async function withRegularUser(
  browser: Browser,
  url: string,
  testFn: (page: Page) => Promise<void>,
): Promise<void> {
  return withTestContext(browser, "regular", url, testFn);
}

/**
 * Creates a test context for an admin user
 */
export async function withAdminUser(
  browser: Browser,
  url: string,
  testFn: (page: Page) => Promise<void>,
): Promise<void> {
  return withTestContext(browser, "admin", url, testFn);
}

/**
 * Creates a test context for an editor user
 */
export async function withEditorUser(
  browser: Browser,
  url: string,
  testFn: (page: Page) => Promise<void>,
): Promise<void> {
  return withTestContext(browser, "editor", url, testFn);
}
