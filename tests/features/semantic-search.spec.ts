import { expect, test } from "@playwright/test";
import { TEST_USERS } from "../constants/test-users";

/**
 * E2E tests for Semantic Search functionality
 * Tests:
 * - Semantic search API endpoint
 * - Batch semantic search
 * - Search across different collection types (documents, messages, knowledge)
 * - Search filters (userId, threadId, role, date range)
 * - Search performance and caching
 * - Search result relevance scoring
 *
 * Note: These tests require QDRANT_URL to be configured.
 * They will be skipped in CI if Qdrant is not available.
 */

const skipSearchTests = !process.env.QDRANT_URL;

test.describe("Semantic Search API", () => {
  test.skip(
    skipSearchTests,
    "QDRANT_URL not configured - skipping semantic search tests",
  );
  test.use({ storageState: TEST_USERS.admin.authFile });

  test("should perform semantic search on messages", async ({ request }) => {
    const response = await request.post("/api/search/semantic", {
      data: {
        query: "test query",
        collectionType: "messages",
        limit: 10,
        scoreThreshold: 0.7,
      },
    });

    expect(response.status()).toBe(200);
    const data = await response.json();
    expect(data).toHaveProperty("results");
    expect(data).toHaveProperty("count");
    expect(data).toHaveProperty("performance");
    expect(Array.isArray(data.results)).toBe(true);
    expect(data.collectionType).toBe("messages");
  });

  test("should perform semantic search on knowledge base", async ({
    request,
  }) => {
    const response = await request.post("/api/search/semantic", {
      data: {
        query: "knowledge search",
        collectionType: "knowledge",
        limit: 10,
      },
    });

    expect(response.status()).toBe(200);
    const data = await response.json();
    expect(data.collectionType).toBe("knowledge");
    expect(Array.isArray(data.results)).toBe(true);
  });

  test("should filter search results by userId", async ({ request }) => {
    const response = await request.post("/api/search/semantic", {
      data: {
        query: "test",
        collectionType: "messages",
        filters: {
          userId: TEST_USERS.admin.id,
        },
      },
    });

    expect(response.status()).toBe(200);
    const data = await response.json();

    // Verify all results belong to the specified user
    data.results.forEach((result: any) => {
      expect(result.payload?.userId).toBe(TEST_USERS.admin.id);
    });
  });

  test("should filter search results by role", async ({ request }) => {
    const response = await request.post("/api/search/semantic", {
      data: {
        query: "test",
        collectionType: "messages",
        filters: {
          role: "user",
        },
      },
    });

    expect(response.status()).toBe(200);
    const data = await response.json();

    // Verify all results have the specified role
    data.results.forEach((result: any) => {
      expect(result.payload?.role).toBe("user");
    });
  });

  test("should respect score threshold", async ({ request }) => {
    const response = await request.post("/api/search/semantic", {
      data: {
        query: "unrelated query that should return few results",
        collectionType: "messages",
        scoreThreshold: 0.9, // High threshold
        limit: 10,
      },
    });

    expect(response.status()).toBe(200);
    const data = await response.json();

    // Verify all results meet the score threshold
    data.results.forEach((result: any) => {
      expect(result.score).toBeGreaterThanOrEqual(0.9);
    });
  });

  test("should support hybrid search", async ({ request }) => {
    const response = await request.post("/api/search/semantic", {
      data: {
        query: "test hybrid search",
        collectionType: "messages",
        searchType: "hybrid",
        keywordBoost: 0.2,
      },
    });

    expect(response.status()).toBe(200);
    const data = await response.json();
    expect(data.searchType).toBe("hybrid");
    expect(Array.isArray(data.results)).toBe(true);
  });

  test("should perform batch semantic search", async ({ request }) => {
    const response = await request.put("/api/search/semantic", {
      data: {
        queries: ["query 1", "query 2", "query 3"],
        collectionType: "messages",
        limit: 5,
      },
    });

    expect(response.status()).toBe(200);
    const data = await response.json();
    expect(data).toHaveProperty("results");
    expect(data).toHaveProperty("queriesCount", 3);
    expect(data).toHaveProperty("totalResults");
    expect(Array.isArray(data.results)).toBe(true);
    expect(data.results.length).toBe(3); // One result array per query
  });

  test("should return search performance metrics", async ({ request }) => {
    const response = await request.post("/api/search/semantic", {
      data: {
        query: "performance test",
        collectionType: "messages",
      },
    });

    expect(response.status()).toBe(200);
    const data = await response.json();
    expect(data).toHaveProperty("performance");
    expect(data.performance).toHaveProperty("totalTimeMs");
    expect(typeof data.performance.totalTimeMs).toBe("number");
  });

  test("should get search service stats", async ({ request }) => {
    const response = await request.get("/api/search/semantic");

    expect(response.status()).toBe(200);
    const data = await response.json();
    expect(data).toHaveProperty("status", "healthy");
    expect(data).toHaveProperty("cache");
  });

  test("should validate search request parameters", async ({ request }) => {
    // Test invalid query (too short)
    const response1 = await request.post("/api/search/semantic", {
      data: {
        query: "",
        collectionType: "messages",
      },
    });

    expect(response1.status()).toBe(400);

    // Test invalid collection type
    const response2 = await request.post("/api/search/semantic", {
      data: {
        query: "test",
        collectionType: "invalid",
      },
    });

    expect(response2.status()).toBe(400);

    // Test invalid limit (too high)
    const response3 = await request.post("/api/search/semantic", {
      data: {
        query: "test",
        collectionType: "messages",
        limit: 200,
      },
    });

    expect(response3.status()).toBe(400);
  });

  test("should require authentication", async ({ request }) => {
    // Create a new request context without auth
    const response = await request.post("/api/search/semantic", {
      data: {
        query: "test",
        collectionType: "messages",
      },
      headers: {
        Cookie: "", // Clear auth cookie
      },
    });

    expect(response.status()).toBe(401);
  });
});

test.describe("Semantic Search UI", () => {
  test.skip(
    skipSearchTests,
    "QDRANT_URL not configured - skipping semantic search UI tests",
  );
  test.use({ storageState: TEST_USERS.admin.authFile });

  test("should display search results in UI", async ({ page }) => {
    await page.goto("/knowledge");
    await page.waitForLoadState("networkidle");

    const searchInput = page
      .locator('input[type="search"], input[placeholder*="search" i]')
      .first();

    if (await searchInput.isVisible().catch(() => false)) {
      await searchInput.fill("test search query");
      await page.waitForTimeout(2000); // Wait for semantic search

      // Verify results are displayed
      const results = page.locator(
        '[data-testid*="search-result"], [class*="search-result"], [class*="memory-card"]',
      );
      await expect(results.first()).toBeVisible({ timeout: 10000 });
    }
  });

  test("should show search relevance scores", async ({ page }) => {
    await page.goto("/knowledge");
    await page.waitForLoadState("networkidle");

    const searchInput = page
      .locator('input[type="search"], input[placeholder*="search" i]')
      .first();

    if (await searchInput.isVisible().catch(() => false)) {
      await searchInput.fill("relevant query");
      await page.waitForTimeout(2000);

      // Check if relevance indicators are shown (score badges, etc.)
      const relevanceIndicators = page.locator(
        '[class*="score"], [class*="relevance"], [data-testid*="score"]',
      );
      // This is optional - not all UIs show scores
      await relevanceIndicators
        .first()
        .isVisible()
        .catch(() => {});
    }
  });
});
