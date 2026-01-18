import { expect, test } from "@playwright/test";
import {
  closeTestContext,
  createTestContext,
  withEditorUser,
  withRegularUser,
} from "../helpers/test-context-helper";

test.describe("Referral Page", () => {
  test.describe("Regular User - Referral Program", () => {
    test("can access referral page", async ({ browser }) => {
      await withRegularUser(browser, "/referral", async (page) => {
        expect(page.url()).toContain("/referral");
        expect(page.url()).not.toContain("/sign-in");
      });
    });

    test("referral page shows program title and description", async ({
      browser,
    }) => {
      await withRegularUser(browser, "/referral", async (page) => {
        await expect(page.getByText("Referral Program")).toBeVisible();
        await expect(
          page.getByText(/Invite friends and earn .* credits/),
        ).toBeVisible();
      });
    });

    test("referral page displays user referral code", async ({ browser }) => {
      await withRegularUser(browser, "/referral", async (page) => {
        await expect(page.getByText("Your Referral Code")).toBeVisible();

        const codeInput = page.locator("input[readonly]");
        await expect(codeInput).toBeVisible();
      });
    });

    test("referral page shows stats cards", async ({ browser }) => {
      await withRegularUser(browser, "/referral", async (page) => {
        await expect(page.getByText("Total Referrals")).toBeVisible();
        await expect(page.getByText("Completed")).toBeVisible();
        await expect(page.getByText("Credits Earned")).toBeVisible();
      });
    });

    test("referral page shows how it works section", async ({ browser }) => {
      await withRegularUser(browser, "/referral", async (page) => {
        await expect(page.getByText("How it Works")).toBeVisible();
        await expect(page.getByText("Share your code")).toBeVisible();
        await expect(page.getByText("They sign up")).toBeVisible();
        await expect(page.getByText("They make a purchase")).toBeVisible();
        await expect(page.getByText("Everyone wins!")).toBeVisible();
      });
    });

    test("referral page has share button", async ({ browser }) => {
      await withRegularUser(browser, "/referral", async (page) => {
        const shareButton = page.getByRole("button", { name: /share/i });
        await expect(shareButton).toBeVisible();
      });
    });

    test("referral page has copy button for code", async ({ browser }) => {
      await withRegularUser(browser, "/referral", async (page) => {
        const copyButtons = page
          .locator("button")
          .filter({ has: page.locator("svg") });
        expect(await copyButtons.count()).toBeGreaterThanOrEqual(2);
      });
    });

    test("referral page displays referral link", async ({ browser }) => {
      await withRegularUser(browser, "/referral", async (page) => {
        await expect(page.getByText("Or share this link:")).toBeVisible();

        const linkText = page
          .locator("code")
          .filter({ hasText: /sign-up\?ref=/ });
        await expect(linkText).toBeVisible();
      });
    });
  });

  test.describe("Referral API Routes", () => {
    test("referral API returns data for authenticated user", async ({
      browser,
    }) => {
      const testContext = await createTestContext(
        browser,
        "regular",
        "/referral",
      );
      try {
        const response = await testContext.page.request.get("/api/referral");
        expect(response.status()).toBe(200);

        const data = await response.json();
        expect(data).toHaveProperty("code");
        expect(data).toHaveProperty("stats");
        expect(data).toHaveProperty("config");
      } finally {
        await closeTestContext(testContext);
      }
    });
  });

  test.describe("Editor User - Referral Access", () => {
    test("editor can access referral page", async ({ browser }) => {
      await withEditorUser(browser, "/referral", async (page) => {
        expect(page.url()).toContain("/referral");
        await expect(page.getByText("Referral Program")).toBeVisible();
      });
    });
  });
});
