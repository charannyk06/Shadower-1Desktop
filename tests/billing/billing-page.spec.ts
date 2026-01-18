import { expect, test } from "@playwright/test";
import { ensureSidebarOpen } from "../helpers/sidebar-helper";
import {
  closeTestContext,
  createTestContext,
  withEditorUser,
  withRegularUser,
} from "../helpers/test-context-helper";

test.describe("Billing Page", () => {
  test.describe("Regular User - Billing Dashboard", () => {
    test("can access billing page and see dashboard", async ({ browser }) => {
      await withRegularUser(browser, "/billing", async (page) => {
        expect(page.url()).toContain("/billing");
        expect(page.url()).not.toContain("/sign-in");
        await expect(page.getByText("Usage & Billing")).toBeVisible();
      });
    });

    test("billing dashboard shows current plan card", async ({ browser }) => {
      await withRegularUser(browser, "/billing", async (page) => {
        const planCard = page.locator("text=Plan").first();
        await expect(planCard).toBeVisible();
      });
    });

    test("billing dashboard has tab navigation", async ({ browser }) => {
      await withRegularUser(browser, "/billing", async (page) => {
        await expect(page.getByText("Overview")).toBeVisible();
        await expect(page.getByText("Usage Details")).toBeVisible();
        await expect(page.getByText("Plans & Pricing")).toBeVisible();
      });
    });

    test("can switch between billing tabs", async ({ browser }) => {
      await withRegularUser(browser, "/billing", async (page) => {
        await page.getByText("Usage Details").click();
        await page.waitForTimeout(500);
        await expect(page.getByText("Credits Overview")).toBeVisible();

        await page.getByText("Plans & Pricing").click();
        await page.waitForTimeout(500);
        await expect(page.getByText("Monthly")).toBeVisible();
        await expect(page.getByText("Yearly")).toBeVisible();
      });
    });

    test("plans tab shows all subscription tiers", async ({ browser }) => {
      await withRegularUser(browser, "/billing", async (page) => {
        await page.getByText("Plans & Pricing").click();
        await page.waitForTimeout(500);

        await expect(page.getByText("Free")).toBeVisible();
        await expect(page.getByText("Pro")).toBeVisible();
        await expect(page.getByText("Ultra")).toBeVisible();
      });
    });

    test("overview tab shows usage statistics", async ({ browser }) => {
      await withRegularUser(browser, "/billing", async (page) => {
        await expect(page.getByText("Credits Used")).toBeVisible();
      });
    });

    test("billing cycle toggle switches between monthly and yearly", async ({
      browser,
    }) => {
      await withRegularUser(browser, "/billing", async (page) => {
        await page.getByText("Plans & Pricing").click();
        await page.waitForTimeout(500);

        await page.getByText("Yearly").click();
        await page.waitForTimeout(300);

        await expect(page.getByText("Save 20%")).toBeVisible();
      });
    });
  });

  test.describe("Editor User - Billing Access", () => {
    test("editor can access billing page", async ({ browser }) => {
      await withEditorUser(browser, "/billing", async (page) => {
        expect(page.url()).toContain("/billing");
        await expect(page.getByText("Usage & Billing")).toBeVisible();
      });
    });
  });

  test.describe("Billing API Routes", () => {
    test("billing usage API returns data for authenticated user", async ({
      browser,
    }) => {
      const testContext = await createTestContext(
        browser,
        "regular",
        "/billing",
      );
      try {
        const response =
          await testContext.page.request.get("/api/billing/usage");
        expect(response.status()).toBe(200);

        const data = await response.json();
        expect(data).toHaveProperty("limits");
        expect(data).toHaveProperty("usage");
      } finally {
        await closeTestContext(testContext);
      }
    });
  });

  test.describe("Sidebar Navigation to Billing", () => {
    test("billing link is visible in sidebar", async ({ browser }) => {
      await withRegularUser(browser, "/", async (page) => {
        await ensureSidebarOpen(page);

        const billingLink = page.getByRole("link", { name: /billing/i });
        expect(billingLink).toBeDefined();
      });
    });
  });
});
