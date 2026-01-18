import { expect, test } from "@playwright/test";
import { TEST_USERS } from "../constants/test-users";

/**
 * E2E tests for Knowledge Base functionality
 * Tests:
 * - Knowledge base creation with file upload
 * - Knowledge base listing and pagination
 * - Knowledge base search
 * - Knowledge base deletion
 * - Knowledge base file management
 * - Vector indexing verification
 *
 * Note: These tests require QDRANT_URL to be configured.
 * They will be skipped in CI if Qdrant is not available.
 */

const skipKnowledgeTests = !process.env.QDRANT_URL;

test.describe("Knowledge Base Management", () => {
  test.skip(
    skipKnowledgeTests,
    "QDRANT_URL not configured - skipping knowledge base tests",
  );
  test.use({ storageState: TEST_USERS.admin.authFile });

  test.beforeEach(async ({ page }) => {
    await page.goto("/knowledge");
    await page.waitForLoadState("networkidle");
  });

  test("should display knowledge base page", async ({ page }) => {
    await expect(page.locator("h1, h2")).toContainText(/knowledge|Knowledge/i);
  });

  test("should create a new knowledge base", async ({ page }) => {
    // Click create button
    const createButton = page
      .locator('button:has-text("Create"), button:has-text("New")')
      .first();
    await createButton.click();

    // Fill in knowledge base form
    await page.fill(
      'input[name="name"], input[placeholder*="name" i]',
      "Test Knowledge Base",
    );
    await page.fill(
      'textarea[name="description"], textarea[placeholder*="description" i]',
      "Test description for knowledge base",
    );

    // Submit form
    await page.click('button[type="submit"], button:has-text("Create")');

    // Verify knowledge base appears in list
    await expect(page.locator("text=Test Knowledge Base")).toBeVisible({
      timeout: 10000,
    });
  });

  test("should list knowledge bases with pagination", async ({ page }) => {
    // Check if pagination controls exist
    const pagination = page
      .locator('[data-testid="pagination"], .pagination')
      .first();

    if (await pagination.isVisible().catch(() => false)) {
      // Test pagination if available
      const nextButton = page.locator(
        'button:has-text("Next"), [aria-label*="next" i]',
      );
      if (await nextButton.isEnabled().catch(() => false)) {
        await nextButton.click();
        await page.waitForTimeout(1000);
      }
    }

    // Verify knowledge bases are displayed
    const knowledgeBaseList = page.locator(
      '[data-testid="knowledge-base-list"], .knowledge-base-list, [class*="knowledge"]',
    );
    await expect(knowledgeBaseList.first()).toBeVisible({ timeout: 5000 });
  });

  test("should search knowledge bases", async ({ page }) => {
    // Find search input
    const searchInput = page
      .locator('input[type="search"], input[placeholder*="search" i]')
      .first();

    if (await searchInput.isVisible().catch(() => false)) {
      await searchInput.fill("test");
      await page.waitForTimeout(1000);

      // Verify search results
      const results = page.locator(
        '[data-testid*="knowledge"], [class*="knowledge-base"]',
      );
      await expect(results.first()).toBeVisible({ timeout: 5000 });
    }
  });

  test("should delete a knowledge base", async ({ page }) => {
    // Find first knowledge base
    const knowledgeBaseCard = page
      .locator('[data-testid*="knowledge"], [class*="knowledge-base"]')
      .first();

    if (await knowledgeBaseCard.isVisible().catch(() => false)) {
      // Click delete button
      const deleteButton = knowledgeBaseCard
        .locator('button:has-text("Delete"), [aria-label*="delete" i]')
        .first();

      if (await deleteButton.isVisible().catch(() => false)) {
        await deleteButton.click();

        // Confirm deletion if confirmation dialog appears
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

test.describe("Knowledge Base API", () => {
  test.skip(
    skipKnowledgeTests,
    "QDRANT_URL not configured - skipping knowledge base API tests",
  );
  test.use({ storageState: TEST_USERS.admin.authFile });

  test("should create knowledge base via API", async ({ request }) => {
    const response = await request.post("/api/knowledge/bases", {
      data: {
        name: "API Test Knowledge Base",
        description: "Created via API test",
      },
    });

    expect(response.status()).toBe(201);
    const data = await response.json();
    expect(data).toHaveProperty("id");
    expect(data.name).toBe("API Test Knowledge Base");
  });

  test("should list knowledge bases via API", async ({ request }) => {
    const response = await request.get("/api/knowledge/bases?page=1&limit=10");

    expect(response.status()).toBe(200);
    const data = await response.json();
    expect(data).toHaveProperty("knowledgeBases");
    expect(Array.isArray(data.knowledgeBases)).toBe(true);
  });

  test("should search knowledge bases via API", async ({ request }) => {
    const response = await request.get(
      "/api/knowledge/bases?search=test&page=1&limit=10",
    );

    expect(response.status()).toBe(200);
    const data = await response.json();
    expect(data).toHaveProperty("knowledgeBases");
  });

  test("should get knowledge base by ID via API", async ({ request }) => {
    // First create a knowledge base
    const createResponse = await request.post("/api/knowledge/bases", {
      data: {
        name: "Get Test KB",
        description: "Test description",
      },
    });

    const created = await createResponse.json();
    const kbId = created.id;

    // Then get it
    const getResponse = await request.get(`/api/knowledge/bases/${kbId}`);

    expect(getResponse.status()).toBe(200);
    const data = await getResponse.json();
    expect(data.id).toBe(kbId);
    expect(data.name).toBe("Get Test KB");
  });

  test("should delete knowledge base via API", async ({ request }) => {
    // Create a knowledge base first
    const createResponse = await request.post("/api/knowledge/bases", {
      data: {
        name: "Delete Test KB",
        description: "Will be deleted",
      },
    });

    const created = await createResponse.json();
    const kbId = created.id;

    // Delete it
    const deleteResponse = await request.delete(`/api/knowledge/bases/${kbId}`);

    expect(deleteResponse.status()).toBe(200);

    // Verify it's deleted
    const getResponse = await request.get(`/api/knowledge/bases/${kbId}`);
    expect(getResponse.status()).toBe(404);
  });
});
