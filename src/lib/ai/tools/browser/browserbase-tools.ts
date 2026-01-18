import { type Tool, tool as createTool } from "ai";
import { z } from "zod";
import { getSessionForThread } from "../../../middleware/session-quota";
import { getBrowserbaseService } from "../../browser/browserbase-service";
import {
  BrowserActParams,
  BrowserExtractParams,
  BrowserNavigateParams,
  BrowserObserveParams,
  BrowserScreenshotParams,
  BrowserStealthParams,
  BrowserWaitParams,
} from "../../browser/types";

/**
 * Browser automation tools using Browserbase + Stagehand AI.
 * These tools enable natural language browser control, stealth browsing,
 * and intelligent data extraction from web pages.
 *
 * IMPORTANT: These tools are stateless and look up sessions from the database.
 * Each tool requires userId and threadId to find the active session.
 */

// Common params for all tools that need session context
const SessionContextParams = z.object({
  userId: z.string().describe("User ID who owns this browser session"),
  threadId: z.string().describe("Thread ID to find the active session"),
});

/**
 * Helper to get active session for a thread from database
 */
async function getActiveSessionForThread(
  threadId: string,
): Promise<string | null> {
  const session = await getSessionForThread(threadId, "browserbase");
  return session?.sessionId || null;
}

/**
 * Navigate to a URL in the browser.
 * Creates a new session if one doesn't exist.
 */
export const browserNavigateTool = createTool({
  description:
    "Navigate to a URL in a web browser. Creates a new browser session if needed. Use this to visit websites for research, data extraction, or automation tasks.",
  inputSchema: BrowserNavigateParams,
  execute: async ({ url, userId, threadId, waitFor }) => {
    const service = getBrowserbaseService();

    if (!service.isConfigured()) {
      return {
        success: false,
        error:
          "Browserbase is not configured. Please set BROWSERBASE_API_KEY and BROWSERBASE_PROJECT_ID.",
      };
    }

    try {
      // Look up existing session from database
      let sessionId = await getActiveSessionForThread(threadId);

      // Create session if needed
      if (!sessionId) {
        const sessionResult = await service.createSession({
          userId,
          threadId,
          stealth: true,
        });
        if (!sessionResult.ok) {
          return {
            success: false,
            error: `Failed to create browser session: ${sessionResult.error.message}`,
          };
        }
        sessionId = sessionResult.value.sessionId;
      }

      const result = await service.navigate(
        sessionId,
        url,
        waitFor || "domcontentloaded",
      );

      if (!result.ok) {
        return {
          success: false,
          error: result.error.message,
          sessionId,
        };
      }

      return {
        success: result.value.success,
        message: result.value.message,
        sessionId,
        screenshot: result.value.screenshot
          ? `data:image/png;base64,${result.value.screenshot}`
          : undefined,
        error: result.value.error,
        guide: result.value.success
          ? "Successfully navigated to the URL. The screenshot shows the current page state. You can now use browser_act to interact with elements or browser_extract to get data."
          : undefined,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return {
        success: false,
        error: message,
      };
    }
  },
});

/**
 * Perform a natural language action on the page using Stagehand AI.
 * Examples: "click the login button", "type 'hello' in the search box"
 */
export const browserActTool = createTool({
  description:
    'Perform an action on the web page using natural language. Examples: "click the login button", "fill the email field with test@example.com", "scroll down", "select the second option from the dropdown". Stagehand AI understands context and finds the right elements automatically.',
  inputSchema: BrowserActParams.extend(SessionContextParams.shape),
  execute: async ({ action, timeout, userId: _userId, threadId }) => {
    const service = getBrowserbaseService();

    // Look up session from database
    const sessionId = await getActiveSessionForThread(threadId);

    if (!sessionId) {
      return {
        success: false,
        error:
          "No active browser session. Use browser_navigate first to open a page.",
      };
    }

    try {
      const result = await service.act(sessionId, action, timeout);

      if (!result.ok) {
        return {
          success: false,
          error: result.error.message,
        };
      }

      return {
        success: result.value.success,
        message: result.value.message,
        sessionId,
        screenshot: result.value.screenshot
          ? `data:image/png;base64,${result.value.screenshot}`
          : undefined,
        error: result.value.error,
        guide: result.value.success
          ? "Action completed successfully. Check the screenshot to verify the result. Continue with more actions or use browser_extract to get data."
          : undefined,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return {
        success: false,
        error: message,
      };
    }
  },
});

/**
 * Observe elements on the page using natural language.
 * Returns selectors and descriptions of found elements.
 */
export const browserObserveTool = createTool({
  description:
    'Observe and find elements on the current page using natural language. Examples: "find all product cards", "locate the submit button", "find the navigation menu". Returns element selectors and descriptions that can be used for further actions.',
  inputSchema: BrowserObserveParams.extend(SessionContextParams.shape),
  execute: async ({ instruction, userId: _userId, threadId }) => {
    const service = getBrowserbaseService();

    // Look up session from database
    const sessionId = await getActiveSessionForThread(threadId);

    if (!sessionId) {
      return {
        success: false,
        elements: [],
        error: "No active browser session. Use browser_navigate first.",
      };
    }

    try {
      const result = await service.observe(sessionId, instruction);

      if (!result.ok) {
        return {
          success: false,
          elements: [],
          error: result.error.message,
        };
      }

      return {
        success: result.value.success,
        elements: result.value.elements,
        elementCount: result.value.elements.length,
        sessionId,
        screenshot: result.value.screenshot
          ? `data:image/png;base64,${result.value.screenshot}`
          : undefined,
        error: result.value.error,
        guide: result.value.success
          ? `Found ${result.value.elements.length} matching elements. You can use browser_act to interact with them or browser_extract to get their data.`
          : undefined,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return {
        success: false,
        elements: [],
        error: message,
      };
    }
  },
});

/**
 * Extract structured data from the page using Stagehand AI.
 */
export const browserExtractTool = createTool({
  description:
    'Extract structured data from the current page using natural language. Examples: "extract all product names and prices", "get the article title and content", "extract all links with their text". Returns structured data that can be processed or saved.',
  inputSchema: BrowserExtractParams.extend(SessionContextParams.shape),
  execute: async ({ instruction, schema, userId: _userId, threadId }) => {
    const service = getBrowserbaseService();

    // Look up session from database
    const sessionId = await getActiveSessionForThread(threadId);

    if (!sessionId) {
      return {
        success: false,
        error: "No active browser session. Use browser_navigate first.",
      };
    }

    try {
      // Build a dynamic Zod schema from the provided schema shape
      const zodSchema = schema
        ? z.object(
            Object.fromEntries(
              Object.entries(schema).map(([key, value]) => [
                key,
                z.any().describe(String(value)),
              ]),
            ),
          )
        : z.object({
            items: z.array(z.any()).describe("Extracted items"),
            text: z.string().optional().describe("Extracted text content"),
          });

      const result = await service.extract(sessionId, instruction, zodSchema);

      if (!result.ok) {
        return {
          success: false,
          error: result.error.message,
        };
      }

      return {
        success: true,
        data: result.value,
        sessionId,
        guide:
          "Successfully extracted data from the page. You can now process this data, save it, or continue browsing.",
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return {
        success: false,
        error: message,
      };
    }
  },
});

/**
 * Take a screenshot of the current page.
 */
export const browserScreenshotTool = createTool({
  description:
    "Take a screenshot of the current browser page. Can capture the visible viewport or the full scrollable page. Use this to document the current state or verify actions.",
  inputSchema: BrowserScreenshotParams.extend(SessionContextParams.shape),
  execute: async ({ fullPage, selector, userId: _userId, threadId }) => {
    const service = getBrowserbaseService();

    // Look up session from database
    const sessionId = await getActiveSessionForThread(threadId);

    if (!sessionId) {
      return {
        success: false,
        error: "No active browser session. Use browser_navigate first.",
      };
    }

    try {
      const result = await service.screenshot(sessionId, {
        fullPage,
        selector,
      });

      if (!result.ok) {
        return {
          success: false,
          error: result.error.message,
        };
      }

      return {
        success: true,
        screenshot: `data:image/png;base64,${result.value.base64}`,
        width: result.value.width,
        height: result.value.height,
        format: result.value.format,
        sessionId,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return {
        success: false,
        error: message,
      };
    }
  },
});

/**
 * Wait for a specific condition on the page.
 */
export const browserWaitTool = createTool({
  description:
    "Wait for a specific condition on the page before continuing. Can wait for an element to appear (by CSS selector) or for text to be visible. Useful after actions that trigger page changes.",
  inputSchema: BrowserWaitParams.extend(SessionContextParams.shape),
  execute: async ({ selector, text, timeout, userId: _userId, threadId }) => {
    const service = getBrowserbaseService();

    // Look up session from database
    const sessionId = await getActiveSessionForThread(threadId);

    if (!sessionId) {
      return {
        success: false,
        error: "No active browser session. Use browser_navigate first.",
      };
    }

    try {
      const result = await service.waitFor(sessionId, {
        selector,
        text,
        timeout,
      });

      if (!result.ok) {
        return {
          success: false,
          error: result.error.message,
        };
      }

      return {
        success: result.value.success,
        message: result.value.message,
        sessionId,
        screenshot: result.value.screenshot
          ? `data:image/png;base64,${result.value.screenshot}`
          : undefined,
        error: result.value.error,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return {
        success: false,
        error: message,
      };
    }
  },
});

/**
 * Close the current browser session.
 */
export const browserCloseTool = createTool({
  description:
    "Close the current browser session and release resources. Use this when done with browser automation tasks.",
  inputSchema: SessionContextParams,
  execute: async ({ userId: _userId, threadId }) => {
    const service = getBrowserbaseService();

    // Look up session from database
    const sessionId = await getActiveSessionForThread(threadId);

    if (!sessionId) {
      return {
        success: true,
        message: "No active session to close.",
      };
    }

    try {
      const result = await service.closeSession(sessionId);

      if (!result.ok) {
        return {
          success: false,
          error: result.error.message,
        };
      }

      return {
        success: true,
        message: `Browser session ${sessionId} closed successfully.`,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return {
        success: false,
        error: message,
      };
    }
  },
});

/**
 * Get the replay URL for the current session.
 */
export const browserReplayTool = createTool({
  description:
    "Get the replay URL for the current browser session. This allows viewing a recording of all browser actions performed during the session.",
  inputSchema: SessionContextParams,
  execute: async ({ userId: _userId, threadId }) => {
    const service = getBrowserbaseService();

    // Look up session from database
    const sessionId = await getActiveSessionForThread(threadId);

    if (!sessionId) {
      return {
        success: false,
        error: "No active browser session.",
      };
    }

    try {
      const result = await service.getReplayUrl(sessionId);

      if (!result.ok) {
        return {
          success: false,
          error: result.error.message,
        };
      }

      return {
        success: true,
        replayUrl: result.value,
        sessionId,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return {
        success: false,
        error: message,
      };
    }
  },
});

/**
 * Get the page content as text or HTML.
 */
export const browserGetContentTool = createTool({
  description:
    "Get the text content or HTML of the current page. Useful for reading page content without extracting structured data.",
  inputSchema: z
    .object({
      format: z
        .enum(["text", "html"])
        .optional()
        .describe(
          "Output format - text returns visible text only, html returns full HTML",
        ),
    })
    .extend(SessionContextParams.shape),
  execute: async ({ format, userId: _userId, threadId }) => {
    const service = getBrowserbaseService();

    // Look up session from database
    const sessionId = await getActiveSessionForThread(threadId);

    if (!sessionId) {
      return {
        success: false,
        error: "No active browser session. Use browser_navigate first.",
      };
    }

    try {
      const result = await service.getPageContent(sessionId, format || "text");

      if (!result.ok) {
        return {
          success: false,
          error: result.error.message,
        };
      }

      const content = result.value;

      // Truncate if too long
      const maxLength = 50000;
      const truncated = content.length > maxLength;
      const finalContent = truncated
        ? content.substring(0, maxLength) + "\n...[truncated]"
        : content;

      return {
        success: true,
        content: finalContent,
        truncated,
        originalLength: content.length,
        format: format || "text",
        sessionId,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return {
        success: false,
        error: message,
      };
    }
  },
});

/**
 * Create a stealth browser session with advanced anti-detection.
 */
export const browserStealthTool = createTool({
  description:
    "Create a new stealth browser session with advanced anti-detection features. Use this when you need to browse sites that block bots or require human-like behavior. Includes fingerprint randomization, CAPTCHA solving, and optional proxy support.",
  inputSchema: BrowserStealthParams,
  execute: async ({ userId, threadId, enable, proxy }) => {
    const service = getBrowserbaseService();

    if (!service.isConfigured()) {
      return {
        success: false,
        error: "Browserbase is not configured.",
      };
    }

    try {
      // Check for existing session and close it
      const existingSessionId = await getActiveSessionForThread(threadId);
      if (existingSessionId) {
        await service.closeSession(existingSessionId);
      }

      if (enable) {
        const result = await service.createStealthSession(
          userId,
          threadId,
          proxy?.country,
        );

        if (!result.ok) {
          return {
            success: false,
            error: result.error.message,
          };
        }

        return {
          success: true,
          message:
            "Stealth browser session created with anti-detection features enabled.",
          sessionId: result.value.sessionId,
          replayUrl: result.value.replayUrl,
        };
      } else {
        const result = await service.createSession({
          userId,
          threadId,
          stealth: false,
        });

        if (!result.ok) {
          return {
            success: false,
            error: result.error.message,
          };
        }

        return {
          success: true,
          message: "Standard browser session created.",
          sessionId: result.value.sessionId,
        };
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return {
        success: false,
        error: message,
      };
    }
  },
});

// Export all browser tools as a collection
export const browserbaseTools = {
  browser_navigate: browserNavigateTool,
  browser_act: browserActTool,
  browser_observe: browserObserveTool,
  browser_extract: browserExtractTool,
  browser_screenshot: browserScreenshotTool,
  browser_wait: browserWaitTool,
  browser_close: browserCloseTool,
  browser_replay: browserReplayTool,
  browser_get_content: browserGetContentTool,
  browser_stealth: browserStealthTool,
};

/**
 * Creates browser tools with pre-injected userId and threadId.
 * Used by sub-agents where the AI model shouldn't provide these values directly.
 *
 * This prevents the AI from inventing fake UUIDs like "user_1234" which cause
 * validation errors and foreign key constraint violations.
 *
 * @param userId - The authenticated user's UUID
 * @param threadId - The conversation thread UUID (can be null for standalone sessions)
 * @returns Record of browser tools with context pre-injected
 */
export function createBrowserToolsWithContext(
  userId: string,
  threadId: string | null,
): Record<string, Tool> {
  const service = getBrowserbaseService();

  // Normalize empty/undefined threadId to empty string for tool execution
  const normalizedThreadId = threadId || "";

  return {
    browser_navigate: createTool({
      description: browserNavigateTool.description,
      inputSchema: z.object({
        url: z.string().url().describe("The URL to navigate to"),
        waitFor: z
          .enum(["load", "domcontentloaded", "networkidle"])
          .optional()
          .describe("Wait condition after navigation"),
      }),
      execute: async ({ url, waitFor }) => {
        if (!service.isConfigured()) {
          return {
            success: false,
            error:
              "Browserbase is not configured. Please set BROWSERBASE_API_KEY and BROWSERBASE_PROJECT_ID.",
          };
        }

        try {
          // Always look up existing session from database first (reuse existing container)
          // This ensures sub-agents reuse the same browser session as the parent agent
          let sessionId: string | null = null;

          if (normalizedThreadId && normalizedThreadId.trim() !== "") {
            sessionId = await getActiveSessionForThread(normalizedThreadId);
            if (sessionId) {
              console.log(
                `[BrowserTools] Reusing existing browser session ${sessionId} for thread ${normalizedThreadId}`,
              );
            }
          }

          // Create session only if no existing session found
          if (!sessionId) {
            console.log(
              `[BrowserTools] No existing session found, creating new browser session for thread ${normalizedThreadId || "standalone"}`,
            );
            const sessionResult = await service.createSession({
              userId,
              threadId:
                normalizedThreadId && normalizedThreadId.trim() !== ""
                  ? normalizedThreadId
                  : undefined,
              stealth: true,
            });
            if (!sessionResult.ok) {
              return {
                success: false,
                error: `Failed to create browser session: ${sessionResult.error.message}`,
              };
            }
            sessionId = sessionResult.value.sessionId;
            console.log(
              `[BrowserTools] Created new browser session ${sessionId} for thread ${normalizedThreadId || "standalone"}`,
            );
          }

          const result = await service.navigate(
            sessionId,
            url,
            waitFor || "domcontentloaded",
          );

          if (!result.ok) {
            return {
              success: false,
              error: result.error.message,
              sessionId,
            };
          }

          return {
            success: result.value.success,
            message: result.value.message,
            sessionId,
            screenshot: result.value.screenshot
              ? `data:image/png;base64,${result.value.screenshot}`
              : undefined,
            error: result.value.error,
            guide: result.value.success
              ? "Successfully navigated to the URL. The screenshot shows the current page state. You can now use browser_act to interact with elements or browser_extract to get data."
              : undefined,
          };
        } catch (error: unknown) {
          const message =
            error instanceof Error ? error.message : "Unknown error";
          return {
            success: false,
            error: message,
          };
        }
      },
    }),

    browser_act: createTool({
      description: browserActTool.description,
      inputSchema: BrowserActParams,
      execute: async ({ action, timeout }) => {
        const sessionId = normalizedThreadId
          ? await getActiveSessionForThread(normalizedThreadId)
          : null;

        if (!sessionId) {
          return {
            success: false,
            error:
              "No active browser session. Use browser_navigate first to open a page.",
          };
        }

        try {
          const result = await service.act(sessionId, action, timeout);

          if (!result.ok) {
            return {
              success: false,
              error: result.error.message,
            };
          }

          return {
            success: result.value.success,
            message: result.value.message,
            sessionId,
            screenshot: result.value.screenshot
              ? `data:image/png;base64,${result.value.screenshot}`
              : undefined,
            error: result.value.error,
            guide: result.value.success
              ? "Action completed successfully. Check the screenshot to verify the result. Continue with more actions or use browser_extract to get data."
              : undefined,
          };
        } catch (error: unknown) {
          const message =
            error instanceof Error ? error.message : "Unknown error";
          return {
            success: false,
            error: message,
          };
        }
      },
    }),

    browser_observe: createTool({
      description: browserObserveTool.description,
      inputSchema: BrowserObserveParams,
      execute: async ({ instruction }) => {
        const sessionId = normalizedThreadId
          ? await getActiveSessionForThread(normalizedThreadId)
          : null;

        if (!sessionId) {
          return {
            success: false,
            elements: [],
            error: "No active browser session. Use browser_navigate first.",
          };
        }

        try {
          const result = await service.observe(sessionId, instruction);

          if (!result.ok) {
            return {
              success: false,
              elements: [],
              error: result.error.message,
            };
          }

          return {
            success: result.value.success,
            elements: result.value.elements,
            elementCount: result.value.elements.length,
            sessionId,
            screenshot: result.value.screenshot
              ? `data:image/png;base64,${result.value.screenshot}`
              : undefined,
            error: result.value.error,
            guide: result.value.success
              ? `Found ${result.value.elements.length} matching elements. You can use browser_act to interact with them or browser_extract to get their data.`
              : undefined,
          };
        } catch (error: unknown) {
          const message =
            error instanceof Error ? error.message : "Unknown error";
          return {
            success: false,
            elements: [],
            error: message,
          };
        }
      },
    }),

    browser_extract: createTool({
      description: browserExtractTool.description,
      inputSchema: BrowserExtractParams,
      execute: async ({ instruction, schema }) => {
        const sessionId = normalizedThreadId
          ? await getActiveSessionForThread(normalizedThreadId)
          : null;

        if (!sessionId) {
          return {
            success: false,
            error: "No active browser session. Use browser_navigate first.",
          };
        }

        try {
          // Build a dynamic Zod schema from the provided schema shape
          const zodSchema = schema
            ? z.object(
                Object.fromEntries(
                  Object.entries(schema).map(([key, value]) => [
                    key,
                    z.any().describe(String(value)),
                  ]),
                ),
              )
            : z.object({
                items: z.array(z.any()).describe("Extracted items"),
                text: z.string().optional().describe("Extracted text content"),
              });

          const result = await service.extract(
            sessionId,
            instruction,
            zodSchema,
          );

          if (!result.ok) {
            return {
              success: false,
              error: result.error.message,
            };
          }

          return {
            success: true,
            data: result.value,
            sessionId,
            guide:
              "Successfully extracted data from the page. You can now process this data, save it, or continue browsing.",
          };
        } catch (error: unknown) {
          const message =
            error instanceof Error ? error.message : "Unknown error";
          return {
            success: false,
            error: message,
          };
        }
      },
    }),

    browser_screenshot: createTool({
      description: browserScreenshotTool.description,
      inputSchema: BrowserScreenshotParams,
      execute: async ({ fullPage, selector }) => {
        const sessionId = normalizedThreadId
          ? await getActiveSessionForThread(normalizedThreadId)
          : null;

        if (!sessionId) {
          return {
            success: false,
            error: "No active browser session. Use browser_navigate first.",
          };
        }

        try {
          const result = await service.screenshot(sessionId, {
            fullPage,
            selector,
          });

          if (!result.ok) {
            return {
              success: false,
              error: result.error.message,
            };
          }

          return {
            success: true,
            screenshot: `data:image/png;base64,${result.value.base64}`,
            width: result.value.width,
            height: result.value.height,
            format: result.value.format,
            sessionId,
          };
        } catch (error: unknown) {
          const message =
            error instanceof Error ? error.message : "Unknown error";
          return {
            success: false,
            error: message,
          };
        }
      },
    }),

    browser_wait: createTool({
      description: browserWaitTool.description,
      inputSchema: BrowserWaitParams,
      execute: async ({ selector, text, timeout }) => {
        const sessionId = normalizedThreadId
          ? await getActiveSessionForThread(normalizedThreadId)
          : null;

        if (!sessionId) {
          return {
            success: false,
            error: "No active browser session. Use browser_navigate first.",
          };
        }

        try {
          const result = await service.waitFor(sessionId, {
            selector,
            text,
            timeout,
          });

          if (!result.ok) {
            return {
              success: false,
              error: result.error.message,
            };
          }

          return {
            success: result.value.success,
            message: result.value.message,
            sessionId,
            screenshot: result.value.screenshot
              ? `data:image/png;base64,${result.value.screenshot}`
              : undefined,
            error: result.value.error,
          };
        } catch (error: unknown) {
          const message =
            error instanceof Error ? error.message : "Unknown error";
          return {
            success: false,
            error: message,
          };
        }
      },
    }),

    browser_close: createTool({
      description: browserCloseTool.description,
      inputSchema: z.object({}),
      execute: async () => {
        const sessionId = normalizedThreadId
          ? await getActiveSessionForThread(normalizedThreadId)
          : null;

        if (!sessionId) {
          return {
            success: true,
            message: "No active session to close.",
          };
        }

        try {
          const result = await service.closeSession(sessionId);

          if (!result.ok) {
            return {
              success: false,
              error: result.error.message,
            };
          }

          return {
            success: true,
            message: `Browser session ${sessionId} closed successfully.`,
          };
        } catch (error: unknown) {
          const message =
            error instanceof Error ? error.message : "Unknown error";
          return {
            success: false,
            error: message,
          };
        }
      },
    }),

    browser_replay: createTool({
      description: browserReplayTool.description,
      inputSchema: z.object({}),
      execute: async () => {
        const sessionId = normalizedThreadId
          ? await getActiveSessionForThread(normalizedThreadId)
          : null;

        if (!sessionId) {
          return {
            success: false,
            error: "No active browser session.",
          };
        }

        try {
          const result = await service.getReplayUrl(sessionId);

          if (!result.ok) {
            return {
              success: false,
              error: result.error.message,
            };
          }

          return {
            success: true,
            replayUrl: result.value,
            sessionId,
          };
        } catch (error: unknown) {
          const message =
            error instanceof Error ? error.message : "Unknown error";
          return {
            success: false,
            error: message,
          };
        }
      },
    }),

    browser_get_content: createTool({
      description: browserGetContentTool.description,
      inputSchema: z.object({
        format: z
          .enum(["text", "html"])
          .optional()
          .describe(
            "Output format - text returns visible text only, html returns full HTML",
          ),
      }),
      execute: async ({ format }) => {
        const sessionId = normalizedThreadId
          ? await getActiveSessionForThread(normalizedThreadId)
          : null;

        if (!sessionId) {
          return {
            success: false,
            error: "No active browser session. Use browser_navigate first.",
          };
        }

        try {
          const result = await service.getPageContent(
            sessionId,
            format || "text",
          );

          if (!result.ok) {
            return {
              success: false,
              error: result.error.message,
            };
          }

          const content = result.value;

          // Truncate if too long
          const maxLength = 50000;
          const truncated = content.length > maxLength;
          const finalContent = truncated
            ? content.substring(0, maxLength) + "\n...[truncated]"
            : content;

          return {
            success: true,
            content: finalContent,
            truncated,
            originalLength: content.length,
            format: format || "text",
            sessionId,
          };
        } catch (error: unknown) {
          const message =
            error instanceof Error ? error.message : "Unknown error";
          return {
            success: false,
            error: message,
          };
        }
      },
    }),

    browser_stealth: createTool({
      description: browserStealthTool.description,
      inputSchema: z.object({
        enable: z.boolean().describe("Enable or disable stealth mode"),
        proxy: z
          .object({
            country: z.string().optional(),
            type: z.enum(["residential", "datacenter"]).optional(),
          })
          .optional()
          .describe("Proxy configuration for stealth mode"),
      }),
      execute: async ({ enable, proxy }) => {
        if (!service.isConfigured()) {
          return {
            success: false,
            error: "Browserbase is not configured.",
          };
        }

        try {
          // Check for existing session and close it
          if (normalizedThreadId) {
            const existingSessionId =
              await getActiveSessionForThread(normalizedThreadId);
            if (existingSessionId) {
              await service.closeSession(existingSessionId);
            }
          }

          if (enable) {
            const result = await service.createStealthSession(
              userId,
              normalizedThreadId || undefined,
              proxy?.country,
            );

            if (!result.ok) {
              return {
                success: false,
                error: result.error.message,
              };
            }

            return {
              success: true,
              message:
                "Stealth browser session created with anti-detection features enabled.",
              sessionId: result.value.sessionId,
              replayUrl: result.value.replayUrl,
            };
          } else {
            const result = await service.createSession({
              userId,
              threadId: normalizedThreadId || undefined,
              stealth: false,
            });

            if (!result.ok) {
              return {
                success: false,
                error: result.error.message,
              };
            }

            return {
              success: true,
              message: "Standard browser session created.",
              sessionId: result.value.sessionId,
            };
          }
        } catch (error: unknown) {
          const message =
            error instanceof Error ? error.message : "Unknown error";
          return {
            success: false,
            error: message,
          };
        }
      },
    }),
  };
}
