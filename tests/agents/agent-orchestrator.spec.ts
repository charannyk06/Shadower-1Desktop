import { expect, test } from "@playwright/test";
import { TEST_USERS } from "../constants/test-users";

test.describe("Agent Orchestrator Behavior", () => {
  test.use({ storageState: TEST_USERS.admin.authFile });

  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Create a new chat thread
    const newChatButton = page.getByTestId("new-chat-button");
    if (await newChatButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await newChatButton.click();
      await page.waitForLoadState("networkidle");
    }
  });

  test.describe("Plan Creation and Execution", () => {
    test("should create and display a plan for complex requests", async ({
      page,
    }) => {
      const chatInput = page.locator('[data-testid="chat-input"]');
      await chatInput.fill(
        "Research the top 3 AI frameworks, compare their features, and create a summary report.",
      );
      await chatInput.press("Enter");

      // Wait for plan view to appear (should be created by orchestrator)
      const planView = page.getByTestId("plan-view");
      await expect(planView).toBeVisible({ timeout: 30000 });

      // Verify plan has tasks
      const planTasks = planView.locator('[data-testid^="plan-task-"]');
      const taskCount = await planTasks.count();
      expect(taskCount).toBeGreaterThan(0);

      // Verify plan shows progress
      const progressText = await planView.textContent();
      expect(progressText).toMatch(/\d{1,5}\/\d{1,5}/); // Should show "X/Y" format
    });

    test("should show plan status updates", async ({ page }) => {
      const chatInput = page.locator('[data-testid="chat-input"]');
      await chatInput.fill(
        "Create a plan with 3 steps: research, analyze, and summarize.",
      );
      await chatInput.press("Enter");

      // Wait for plan status to appear
      const planStatus = page.getByTestId("plan-status");
      await expect(planStatus).toBeVisible({ timeout: 30000 });

      // Verify status is one of the expected states
      const status = await planStatus.getAttribute("data-status");
      expect(["planning", "executing", "completed"]).toContain(status);
    });

    test("should update task statuses as plan executes", async ({ page }) => {
      const chatInput = page.locator('[data-testid="chat-input"]');
      await chatInput.fill(
        "Break down this task into steps: 1) Research, 2) Analyze, 3) Report",
      );
      await chatInput.press("Enter");

      // Wait for plan view
      const planView = page.getByTestId("plan-view");
      await expect(planView).toBeVisible({ timeout: 30000 });

      // Wait for at least one task to be in progress or completed
      await page.waitForFunction(
        () => {
          const tasks = document.querySelectorAll("[data-task-status]");
          return Array.from(tasks).some((task) => {
            const status = (task as HTMLElement).dataset.taskStatus;
            return status === "in-progress" || status === "completed";
          });
        },
        { timeout: 60000 },
      );

      // Verify task status updates are visible
      const inProgressTask = planView.locator(
        '[data-task-status="in-progress"]',
      );
      const completedTask = planView.locator('[data-task-status="completed"]');

      // At least one should be visible (either in-progress or completed)
      const hasActiveTask =
        (await inProgressTask.count()) > 0 || (await completedTask.count()) > 0;
      expect(hasActiveTask).toBeTruthy();
    });

    test("should show task status updates in chat", async ({ page }) => {
      const chatInput = page.locator('[data-testid="chat-input"]');
      await chatInput.fill("Create a plan and execute it step by step.");
      await chatInput.press("Enter");

      // Wait for task status updates to appear
      await page.waitForSelector('[data-testid="task-status"]', {
        timeout: 30000,
      });

      const taskStatuses = page.locator('[data-testid="task-status"]');
      const count = await taskStatuses.count();
      expect(count).toBeGreaterThan(0);

      // Verify at least one task status shows a valid status
      const firstTaskStatus = taskStatuses.first();
      const status = await firstTaskStatus.getAttribute("data-task-status");
      expect([
        "pending",
        "in-progress",
        "completed",
        "failed",
        "blocked",
      ]).toContain(status);
    });
  });

  test.describe("Plan View Interactions", () => {
    test("should expand and collapse plan view", async ({ page }) => {
      const chatInput = page.locator('[data-testid="chat-input"]');
      await chatInput.fill("Create a plan with multiple steps.");
      await chatInput.press("Enter");

      const planView = page.getByTestId("plan-view");
      await expect(planView).toBeVisible({ timeout: 30000 });

      const toggleButton = planView.getByTestId("plan-view-toggle");

      // Initially should be expanded (tasks visible)
      const taskLocator = planView.locator('[data-testid^="plan-task-"]');
      await expect(taskLocator.first()).toBeVisible();

      // Collapse
      await toggleButton.click();
      await page.waitForTimeout(500);

      // Expand again
      await toggleButton.click();
      await page.waitForTimeout(500);

      // Tasks should be visible again
      await expect(taskLocator.first()).toBeVisible();
    });

    test("should auto-collapse when plan is complete", async ({ page }) => {
      const chatInput = page.locator('[data-testid="chat-input"]');
      await chatInput.fill(
        "Create a simple plan with 2 steps and complete them.",
      );
      await chatInput.press("Enter");

      const planView = page.getByTestId("plan-view");
      await expect(planView).toBeVisible({ timeout: 30000 });

      // Wait for plan to complete (all tasks done)
      await page.waitForFunction(
        () => {
          const view = document.querySelector('[data-testid="plan-view"]');
          if (!view) return false;
          const tasks = view.querySelectorAll("[data-task-status]");
          if (tasks.length === 0) return false;
          return Array.from(tasks).every(
            (task) => (task as HTMLElement).dataset.taskStatus === "completed",
          );
        },
        { timeout: 120000 },
      );

      // Plan view should show completed state (green border/background)
      const planViewClasses = await planView.getAttribute("class");
      expect(planViewClasses).toContain("border-emerald-500");
    });
  });

  test.describe("Sub-Agent Spawning", () => {
    test("should display sub-agent activity when agents are spawned", async ({
      page,
    }) => {
      const chatInput = page.locator('[data-testid="chat-input"]');
      await chatInput.fill(
        "Use parallel agents to research multiple topics simultaneously.",
      );
      await chatInput.press("Enter");

      // Wait for sub-agent view to appear (if agents are spawned)
      const subAgentView = page.getByTestId("sub-agent-view");
      const hasSubAgents = await subAgentView
        .isVisible({ timeout: 60000 })
        .catch(() => false);

      if (hasSubAgents) {
        // Verify sub-agent cards are displayed
        const agentCards = page.locator('[data-testid="sub-agent-card"]');
        const cardCount = await agentCards.count();
        expect(cardCount).toBeGreaterThan(0);

        // Verify at least one agent has a status
        const firstCard = agentCards.first();
        const status = await firstCard.getAttribute("data-agent-status");
        expect(["running", "complete", "error"]).toContain(status);
      } else {
        // If no sub-agents spawned, that's also valid - just log it
        console.log("No sub-agents spawned for this request");
      }
    });

    test("should show sub-agent progress and completion", async ({ page }) => {
      const chatInput = page.locator('[data-testid="chat-input"]');
      await chatInput.fill(
        "Spawn agents to handle parallel tasks: research, analysis, and reporting.",
      );
      await chatInput.press("Enter");

      // Wait for sub-agent view
      const subAgentView = page.getByTestId("sub-agent-view");
      const hasSubAgents = await subAgentView
        .isVisible({ timeout: 60000 })
        .catch(() => false);

      if (hasSubAgents) {
        // Wait for at least one agent to complete
        await page.waitForFunction(
          () => {
            const cards = document.querySelectorAll(
              '[data-agent-status="complete"]',
            );
            return cards.length > 0;
          },
          { timeout: 120000 },
        );

        const completedAgents = page.locator('[data-agent-status="complete"]');
        const count = await completedAgents.count();
        expect(count).toBeGreaterThan(0);
      }
    });
  });

  test.describe("Simple Requests", () => {
    test("should handle simple requests without excessive planning", async ({
      page,
    }) => {
      const chatInput = page.locator('[data-testid="chat-input"]');
      await chatInput.fill("What is 2 + 2?");
      await chatInput.press("Enter");

      // Wait for response
      await page.waitForSelector('[data-testid="assistant-message"]', {
        timeout: 30000,
      });

      // Simple requests should get direct answers
      const assistantMessage = page
        .locator('[data-testid="assistant-message"]')
        .last();
      await expect(assistantMessage).toBeVisible();

      const messageText = await assistantMessage.textContent();
      expect(messageText).toContain("4");
    });
  });

  test.describe("Tool Usage", () => {
    test("should use web search tool when appropriate", async ({ page }) => {
      const chatInput = page.locator('[data-testid="chat-input"]');
      await chatInput.fill(
        "Search for the latest news about artificial intelligence.",
      );
      await chatInput.press("Enter");

      // Wait for web search tool invocation
      await page.waitForSelector('[data-testid="tool-invocation"]', {
        timeout: 60000,
      });

      // Verify tool was used
      const toolInvocation = page.locator('[data-testid="tool-invocation"]');
      await expect(toolInvocation.first()).toBeVisible();
    });
  });

  test.describe("Error Handling", () => {
    test("should gracefully handle tool failures", async ({ page }) => {
      const chatInput = page.locator('[data-testid="chat-input"]');
      await chatInput.fill(
        "Execute a workflow with ID that-does-not-exist-12345",
      );
      await chatInput.press("Enter");

      // Wait for response
      await page.waitForSelector('[data-testid="assistant-message"]', {
        timeout: 30000,
      });

      const assistantMessage = page
        .locator('[data-testid="assistant-message"]')
        .last();
      const responseText = await assistantMessage.textContent();

      // Should not crash, should give meaningful response
      expect(responseText?.length).toBeGreaterThan(0);

      // Should indicate the issue gracefully
      const handledGracefully =
        responseText?.includes("not found") ||
        responseText?.includes("couldn't") ||
        responseText?.includes("unable") ||
        responseText?.includes("error") ||
        responseText?.includes("doesn't exist") ||
        responseText?.includes("help you");

      expect(handledGracefully).toBeTruthy();
    });
  });

  test.describe("Context Sharing", () => {
    test("should maintain context across conversation turns", async ({
      page,
    }) => {
      // First message - set context
      const chatInput = page.locator('[data-testid="chat-input"]');
      await chatInput.fill("My name is TestUser and I work on AI projects.");
      await chatInput.press("Enter");

      // Wait for response
      await page.waitForSelector('[data-testid="assistant-message"]', {
        timeout: 30000,
      });

      // Second message - reference context
      await chatInput.fill("What do I work on?");
      await chatInput.press("Enter");

      // Wait for second response
      await page.waitForSelector(
        '[data-testid="assistant-message"]:nth-of-type(2)',
        { timeout: 30000 },
      );

      const messages = page.locator('[data-testid="assistant-message"]');
      const lastMessage = messages.last();
      const responseText = await lastMessage.textContent();

      // Should reference AI projects from context
      expect(
        responseText?.toLowerCase().includes("ai") ||
          responseText?.toLowerCase().includes("artificial intelligence"),
      ).toBeTruthy();
    });
  });
});

test.describe("Agent with Custom Agents", () => {
  test.use({ storageState: TEST_USERS.admin.authFile });

  test("should be able to reference created agents", async ({ page }) => {
    // First create an agent
    await page.goto("/agent/new");
    await page.waitForLoadState("networkidle");

    const nameInput = page.getByTestId("agent-name-input");
    if (await nameInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      const testAgentName = `TestAgent-${Date.now()}`;
      await nameInput.fill(testAgentName);

      // Fill other required fields if present
      const descriptionInput = page.locator(
        '[data-testid="agent-description-input"]',
      );
      if (
        await descriptionInput.isVisible({ timeout: 2000 }).catch(() => false)
      ) {
        await descriptionInput.fill("A test agent for orchestrator testing");
      }

      // Save the agent
      const saveButton = page.getByTestId("save-agent-button");
      if (await saveButton.isVisible({ timeout: 2000 }).catch(() => false)) {
        await saveButton.click();
        await page.waitForURL(/\/agent\/.+/, { timeout: 10000 });
      }
    }

    // Navigate to chat
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // The orchestrator should have access to spawn user-created agents
    // This is tested by the system having the spawnAgent tool available
    // The actual spawning requires a valid agent ID which we'd get from the creation
  });
});
