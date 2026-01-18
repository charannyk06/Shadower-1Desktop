import { expect, test } from "@playwright/test";
import { TEST_USERS } from "../constants/test-users";

/**
 * E2E tests for Memory Management functionality
 * Tests:
 * - Memory listing with pagination
 * - Memory search (semantic search)
 * - Memory filtering by role
 * - Memory creation
 * - Memory update
 * - Memory deletion
 * - Bulk memory operations
 *
 * Note: These tests require QDRANT_URL to be configured.
 * They will be skipped in CI if Qdrant is not available.
 */

const skipMemoryTests = !process.env.QDRANT_URL;

test.describe("Memory Management", () => {
  test.skip(
    skipMemoryTests,
    "QDRANT_URL not configured - skipping memory tests",
  );
  test.use({ storageState: TEST_USERS.admin.authFile });

  test.beforeEach(async ({ page }) => {
    await page.goto("/knowledge");
    await page.waitForLoadState("networkidle");

    // Navigate to memories tab if needed
    const memoriesTab = page.locator(
      'button:has-text("Memories"), [role="tab"]:has-text("Memories")',
    );
    if (await memoriesTab.isVisible().catch(() => false)) {
      await memoriesTab.click();
      await page.waitForTimeout(1000);
    }
  });

  test("should display memories page", async ({ page }) => {
    await expect(page.locator("h1, h2")).toContainText(/memory|Memory/i);
  });

  test("should list memories with pagination", async ({ page }) => {
    // Wait for memories to load
    const memoryList = page
      .locator('[data-testid="memory-list"], [class*="memory"]')
      .first();
    await expect(memoryList).toBeVisible({ timeout: 10000 });

    // Check pagination if available
    const pagination = page
      .locator('[data-testid="pagination"], .pagination')
      .first();
    if (await pagination.isVisible().catch(() => false)) {
      const nextButton = page.locator(
        'button:has-text("Next"), [aria-label*="next" i]',
      );
      if (await nextButton.isEnabled().catch(() => false)) {
        await nextButton.click();
        await page.waitForTimeout(1000);
      }
    }
  });

  test("should search memories semantically", async ({ page }) => {
    const searchInput = page
      .locator('input[type="search"], input[placeholder*="search" i]')
      .first();

    if (await searchInput.isVisible().catch(() => false)) {
      await searchInput.fill("test query");
      await page.waitForTimeout(2000); // Wait for semantic search

      const results = page.locator(
        '[data-testid*="memory"], [class*="memory-card"]',
      );
      await expect(results.first()).toBeVisible({ timeout: 10000 });
    }
  });

  test("should filter memories by role", async ({ page }) => {
    // Look for role filter dropdown or buttons
    const roleFilter = page
      .locator(
        'select[name="role"], button:has-text("User"), button:has-text("Assistant")',
      )
      .first();

    if (await roleFilter.isVisible().catch(() => false)) {
      await roleFilter.click();
      await page.waitForTimeout(1000);

      // Verify filtered results
      const results = page.locator(
        '[data-testid*="memory"], [class*="memory-card"]',
      );
      await expect(results.first()).toBeVisible({ timeout: 5000 });
    }
  });

  test("should create a memory", async ({ page }) => {
    const createButton = page
      .locator('button:has-text("Create"), button:has-text("New Memory")')
      .first();

    if (await createButton.isVisible().catch(() => false)) {
      await createButton.click();
      await page.waitForTimeout(500);

      // Fill memory form if dialog appears
      const contentInput = page
        .locator('textarea[name="content"], textarea[placeholder*="content" i]')
        .first();
      if (await contentInput.isVisible().catch(() => false)) {
        await contentInput.fill("Test memory content");

        const submitButton = page
          .locator('button[type="submit"], button:has-text("Save")')
          .last();
        await submitButton.click();

        await page.waitForTimeout(2000);

        // Verify memory appears
        await expect(page.locator("text=Test memory content")).toBeVisible({
          timeout: 10000,
        });
      }
    }
  });

  test("should delete a memory", async ({ page }) => {
    const memoryCard = page
      .locator('[data-testid*="memory"], [class*="memory-card"]')
      .first();

    if (await memoryCard.isVisible().catch(() => false)) {
      const deleteButton = memoryCard
        .locator('button:has-text("Delete"), [aria-label*="delete" i]')
        .first();

      if (await deleteButton.isVisible().catch(() => false)) {
        await deleteButton.click();

        // Confirm deletion
        const confirmButton = page
          .locator('button:has-text("Confirm"), button:has-text("Delete")')
          .last();
        if (await confirmButton.isVisible().catch(() => false)) {
          await confirmButton.click();
        }

        await page.waitForTimeout(1000);
      }
    }
  });
});

test.describe("Memory Management API", () => {
  test.skip(
    skipMemoryTests,
    "QDRANT_URL not configured - skipping memory API tests",
  );
  test.use({ storageState: TEST_USERS.admin.authFile });

  test("should list memories via API", async ({ request }) => {
    const response = await request.get(
      "/api/knowledge/memories?page=1&limit=10",
    );

    expect(response.status()).toBe(200);
    const data = await response.json();
    expect(data).toHaveProperty("memories");
    expect(Array.isArray(data.memories)).toBe(true);
  });

  test("should search memories semantically via API", async ({ request }) => {
    const response = await request.get(
      "/api/knowledge/memories?search=test&page=1&limit=10",
    );

    expect(response.status()).toBe(200);
    const data = await response.json();
    expect(data).toHaveProperty("memories");
  });

  test("should filter memories by role via API", async ({ request }) => {
    const response = await request.get(
      "/api/knowledge/memories?role=user&page=1&limit=10",
    );

    expect(response.status()).toBe(200);
    const data = await response.json();
    expect(data).toHaveProperty("memories");

    // Verify all returned memories have user role
    if (data.memories.length > 0) {
      data.memories.forEach((memory: any) => {
        expect(memory.role).toBe("user");
      });
    }
  });

  test("should create memory via API", async ({ request }) => {
    const response = await request.post("/api/knowledge/memories", {
      data: {
        content: "Test memory content from API",
        role: "user",
      },
    });

    expect(response.status()).toBe(201);
    const data = await response.json();
    expect(data).toHaveProperty("id");
    expect(data.content).toBe("Test memory content from API");
  });

  test("should update memory via API", async ({ request }) => {
    // Create a memory first
    const createResponse = await request.post("/api/knowledge/memories", {
      data: {
        content: "Original content",
        role: "user",
      },
    });

    const created = await createResponse.json();
    const memoryId = created.id;

    // Update it
    const updateResponse = await request.put(
      `/api/knowledge/memories/${memoryId}`,
      {
        data: {
          content: "Updated content",
        },
      },
    );

    expect(updateResponse.status()).toBe(200);
    const updated = await updateResponse.json();
    expect(updated.content).toBe("Updated content");
  });

  test("should delete memory via API", async ({ request }) => {
    // Create a memory first
    const createResponse = await request.post("/api/knowledge/memories", {
      data: {
        content: "Memory to be deleted",
        role: "user",
      },
    });

    const created = await createResponse.json();
    const memoryId = created.id;

    // Delete it
    const deleteResponse = await request.delete(
      `/api/knowledge/memories/${memoryId}`,
    );

    expect(deleteResponse.status()).toBe(200);

    // Verify it's deleted
    const getResponse = await request.get(
      `/api/knowledge/memories/${memoryId}`,
    );
    expect(getResponse.status()).toBe(404);
  });

  test("should perform bulk memory operations via API", async ({ request }) => {
    // Test bulk delete
    const createResponse1 = await request.post("/api/knowledge/memories", {
      data: { content: "Bulk test 1", role: "user" },
    });
    const createResponse2 = await request.post("/api/knowledge/memories", {
      data: { content: "Bulk test 2", role: "user" },
    });

    const memory1 = await createResponse1.json();
    const memory2 = await createResponse2.json();

    const bulkResponse = await request.post("/api/knowledge/memories/bulk", {
      data: {
        action: "delete",
        memoryIds: [memory1.id, memory2.id],
      },
    });

    expect(bulkResponse.status()).toBe(200);
  });
});
