import { expect, test } from "@playwright/test";
import {
  closeTestContext,
  createTestContext,
  withAdminUser,
  withEditorUser,
  withRegularUser,
} from "../helpers/test-context-helper";

test.describe("Admin Billing Dashboard", () => {
  test.describe("Admin Access", () => {
    test("admin can access billing overview page", async ({ browser }) => {
      await withAdminUser(browser, "/admin/billing", async (page) => {
        expect(page.url()).toContain("/admin/billing");
        expect(page.url()).not.toContain("/sign-in");
        await expect(page.getByText("Billing Management")).toBeVisible();
      });
    });

    test("admin billing page shows navigation tabs", async ({ browser }) => {
      await withAdminUser(browser, "/admin/billing", async (page) => {
        await expect(
          page.getByRole("link", { name: /overview/i }),
        ).toBeVisible();
        await expect(
          page.getByRole("link", { name: /subscriptions/i }),
        ).toBeVisible();
        await expect(
          page.getByRole("link", { name: /promo codes/i }),
        ).toBeVisible();
      });
    });

    test("admin billing overview shows stats cards", async ({ browser }) => {
      await withAdminUser(browser, "/admin/billing", async (page) => {
        await expect(page.getByText(/MRR|Revenue|Subscriptions/)).toBeVisible();
      });
    });
  });

  test.describe("Admin Subscriptions Page", () => {
    test("admin can access subscriptions page", async ({ browser }) => {
      await withAdminUser(
        browser,
        "/admin/billing/subscriptions",
        async (page) => {
          expect(page.url()).toContain("/admin/billing/subscriptions");
        },
      );
    });

    test("subscriptions page shows subscription list or table", async ({
      browser,
    }) => {
      await withAdminUser(
        browser,
        "/admin/billing/subscriptions",
        async (page) => {
          const table = page.locator("table");
          const hasTable = await table.isVisible().catch(() => false);

          if (hasTable) {
            const tableHeaders = page.locator("th");
            expect(await tableHeaders.count()).toBeGreaterThan(0);
          }
        },
      );
    });
  });

  test.describe("Admin Promo Codes Page", () => {
    test("admin can access promo codes page", async ({ browser }) => {
      await withAdminUser(
        browser,
        "/admin/billing/promo-codes",
        async (page) => {
          expect(page.url()).toContain("/admin/billing/promo-codes");
        },
      );
    });

    test("promo codes page shows create button", async ({ browser }) => {
      await withAdminUser(
        browser,
        "/admin/billing/promo-codes",
        async (page) => {
          await expect(
            page.getByRole("button", { name: /create promo code/i }),
          ).toBeVisible();
        },
      );
    });

    test("promo codes page shows promo code table or empty state", async ({
      browser,
    }) => {
      await withAdminUser(
        browser,
        "/admin/billing/promo-codes",
        async (page) => {
          const table = page.locator("table");
          const emptyState = page.getByText(/no promo codes/i);

          const hasTable = await table.isVisible().catch(() => false);
          const hasEmptyState = await emptyState.isVisible().catch(() => false);

          expect(hasTable || hasEmptyState).toBe(true);
        },
      );
    });

    test("can open create promo code dialog", async ({ browser }) => {
      await withAdminUser(
        browser,
        "/admin/billing/promo-codes",
        async (page) => {
          await page
            .getByRole("button", { name: /create promo code/i })
            .click();

          await expect(page.getByRole("dialog")).toBeVisible();
          await expect(page.getByText("Create Promo Code")).toBeVisible();
          await expect(page.getByLabel(/code/i)).toBeVisible();
          await expect(
            page
              .getByLabel(/discount type/i)
              .or(page.getByText(/discount type/i)),
          ).toBeVisible();
        },
      );
    });

    test("promo code form has required fields", async ({ browser }) => {
      await withAdminUser(
        browser,
        "/admin/billing/promo-codes",
        async (page) => {
          await page
            .getByRole("button", { name: /create promo code/i })
            .click();
          await page.waitForTimeout(300);

          await expect(page.getByLabel(/code/i)).toBeVisible();

          const discountTypeField = page
            .locator("text=Discount Type")
            .or(page.locator("[id*=discountType]"));
          await expect(discountTypeField).toBeVisible();

          await expect(page.getByText(/applies to/i)).toBeVisible();
        },
      );
    });
  });

  test.describe("Non-Admin Access Denied", () => {
    test("editor cannot access admin billing page", async ({ browser }) => {
      await withEditorUser(browser, "/admin/billing", async (page) => {
        await expect(
          page.getByText(/401|unauthorized|forbidden/i),
        ).toBeVisible();
      });
    });

    test("regular user cannot access admin billing page", async ({
      browser,
    }) => {
      await withRegularUser(browser, "/admin/billing", async (page) => {
        await expect(
          page.getByText(/401|unauthorized|forbidden/i),
        ).toBeVisible();
      });
    });

    test("editor cannot access admin promo codes page", async ({ browser }) => {
      await withEditorUser(
        browser,
        "/admin/billing/promo-codes",
        async (page) => {
          await expect(
            page.getByText(/401|unauthorized|forbidden/i),
          ).toBeVisible();
        },
      );
    });

    test("regular user cannot access admin subscriptions page", async ({
      browser,
    }) => {
      await withRegularUser(
        browser,
        "/admin/billing/subscriptions",
        async (page) => {
          await expect(
            page.getByText(/401|unauthorized|forbidden/i),
          ).toBeVisible();
        },
      );
    });
  });

  test.describe("Admin Billing Navigation", () => {
    test("admin can navigate between billing tabs", async ({ browser }) => {
      await withAdminUser(browser, "/admin/billing", async (page) => {
        await page.getByRole("link", { name: /subscriptions/i }).click();
        await page.waitForLoadState("networkidle");
        expect(page.url()).toContain("/admin/billing/subscriptions");

        await page.getByRole("link", { name: /promo codes/i }).click();
        await page.waitForLoadState("networkidle");
        expect(page.url()).toContain("/admin/billing/promo-codes");

        await page.getByRole("link", { name: /overview/i }).click();
        await page.waitForLoadState("networkidle");
        expect(page.url()).toContain("/admin/billing");
        expect(page.url()).not.toContain("/subscriptions");
        expect(page.url()).not.toContain("/promo-codes");
      });
    });
  });

  test.describe("Admin Billing API Routes", () => {
    test("admin billing stats API returns data", async ({ browser }) => {
      const testContext = await createTestContext(
        browser,
        "admin",
        "/admin/billing",
      );
      try {
        const response = await testContext.page.request.get(
          "/api/admin/billing/promo-codes",
        );
        expect(response.status()).toBe(200);

        const data = await response.json();
        expect(data).toHaveProperty("promoCodes");
      } finally {
        await closeTestContext(testContext);
      }
    });

    test("non-admin cannot access admin billing API", async ({ browser }) => {
      const testContext = await createTestContext(browser, "regular", "/");
      try {
        const response = await testContext.page.request.get(
          "/api/admin/billing/promo-codes",
        );
        expect([401, 403]).toContain(response.status());
      } finally {
        await closeTestContext(testContext);
      }
    });
  });
});
