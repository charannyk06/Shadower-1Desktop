import {
  APIResponse,
  BrowserContext,
  Page,
  expect,
  test,
} from "@playwright/test";
import { TEST_USERS } from "../constants/test-users";

// Helper to validate composio API response structure
async function expectValidComposioResponse(response: APIResponse) {
  expect([200, 400]).toContain(response.status());
  const data = await response.json();
  if (response.status() === 200) {
    expect(data).toHaveProperty("items");
    expect(data).toHaveProperty("enabled");
  }
  return data;
}

test.describe("Integrations API", () => {
  let adminPage: Page;
  let adminContext: BrowserContext;

  test.beforeAll(async ({ browser }) => {
    adminContext = await browser.newContext({
      storageState: TEST_USERS.admin.authFile,
    });
    adminPage = await adminContext.newPage();
  });

  test.afterAll(async () => {
    await adminContext.close();
  });

  test("GET /api/composio/apps returns valid response", async () => {
    const response = await adminPage.request.get("/api/composio/apps");
    await expectValidComposioResponse(response);
  });

  test("GET /api/composio/connections returns valid response", async () => {
    const response = await adminPage.request.get("/api/composio/connections");
    await expectValidComposioResponse(response);
  });

  test("GET /api/composio/tools returns valid response", async () => {
    const response = await adminPage.request.get("/api/composio/tools");
    await expectValidComposioResponse(response);
  });

  test("POST /api/composio/execute requires authentication", async ({
    browser,
  }) => {
    // Create a new context without auth
    const anonContext = await browser.newContext();
    const anonPage = await anonContext.newPage();

    const response = await anonPage.request.post("/api/composio/execute", {
      data: {
        actionName: "test_action",
        params: {},
      },
    });

    // Should return 401 Unauthorized (or 400 if integrations disabled)
    expect([401, 400]).toContain(response.status());

    await anonContext.close();
  });

  test("POST /api/composio/execute validates input", async () => {
    const response = await adminPage.request.post("/api/composio/execute", {
      data: {
        // Missing required fields
      },
    });

    // Should return error (400 or similar) for invalid input
    expect([400, 500]).toContain(response.status());
  });
});

test.describe("Admin Integrations API", () => {
  let adminContext: BrowserContext;

  test.beforeAll(async ({ browser }) => {
    adminContext = await browser.newContext({
      storageState: TEST_USERS.admin.authFile,
    });
  });

  test.afterAll(async () => {
    await adminContext.close();
  });

  test("GET /api/admin/composio/integrations requires admin role", async ({
    browser,
  }) => {
    // Test with regular user
    const userContext = await browser.newContext({
      storageState: TEST_USERS.regular.authFile,
    });
    const userPage = await userContext.newPage();

    const response = await userPage.request.get(
      "/api/admin/composio/integrations",
    );

    // Should return 403 Forbidden for non-admin
    expect([403, 401, 405]).toContain(response.status());

    await userContext.close();
  });

  test("POST /api/admin/composio/integrations requires admin role", async ({
    browser,
  }) => {
    // Test with editor user
    const editorContext = await browser.newContext({
      storageState: TEST_USERS.editor.authFile,
    });
    const editorPage = await editorContext.newPage();

    const response = await editorPage.request.post(
      "/api/admin/composio/integrations",
      {
        data: {
          appName: "test-app",
          clientId: "test-id",
          clientSecret: "test-secret",
        },
      },
    );

    // Should return 403 Forbidden for non-admin
    expect([403, 401]).toContain(response.status());

    await editorContext.close();
  });
});
