import { generateObject, generateText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { z } from "zod";
import { customModelProvider } from "lib/ai/models";
import logger from "logger";

/**
 * Morph Service - Surgical Code Editing
 * Uses Morph API for TARGETED edits without rewriting entire files
 * This is the secret sauce for fast, intelligent code editing
 */
export class MorphService {
  private morphClient;
  private enabled: boolean;

  constructor() {
    const morphApiKey = process.env.MORPH_API_KEY;
    this.enabled = !!morphApiKey;

    if (this.enabled) {
      this.morphClient = createOpenAI({
        apiKey: morphApiKey,
        baseURL: "https://api.morphllm.com/v1",
      });
      logger.info("[MORPH] Surgical editing ENABLED");
    } else {
      logger.warn(
        "[MORPH] Surgical editing DISABLED (MORPH_API_KEY not set) - using fallback",
      );
    }
  }

  /**
   * Apply surgical edit to code
   * ONLY CHANGES WHAT'S NEEDED - not full rewrite
   */
  async applyEdit(
    originalCode: string,
    editRequest: string,
    filePath: string,
  ): Promise<{ patchedCode: string; commentary: string }> {
    if (!this.enabled) {
      // Fallback: Use AI to regenerate (less ideal, but works)
      return await this.fallbackEdit(originalCode, editRequest);
    }

    try {
      logger.info(`[MORPH] Applying surgical edit to ${filePath}`);

      // STEP 1: Generate edit instructions with AI
      const { object: editPlan } = await generateObject({
        model: customModelProvider.getModel({
          provider: "anthropic",
          model: "claude-sonnet-4-20250514",
        }),
        schema: z.object({
          instruction: z.string().describe("One-line instruction"),
          edit: z
            .string()
            .describe("Surgical edit with // ... existing code ... markers"),
          commentary: z.string().describe("Explanation"),
        }),
        prompt: `Original code:
\`\`\`
${originalCode}
\`\`\`

User edit request: "${editRequest}"

Generate SURGICAL edit instructions:
1. Use // ... existing code ... for unchanged sections
2. Be LAZY - only show lines that change + minimal context
3. Example: If changing one variable, show ONLY that line + 1-2 lines context

DO NOT regenerate the entire file. ONLY show what changes.`,
      });

      logger.debug(`[MORPH] Edit instruction: ${editPlan.instruction}`);

      // STEP 2: Apply edit with Morph API
      const { text: patchedCode } = await generateText({
        model: this.morphClient("morph-v3-large"),
        prompt: `<instruction>${editPlan.instruction}</instruction>
<code>${originalCode}</code>
<update>${editPlan.edit}</update>`,
      });

      logger.info(`[MORPH] ✅ Surgical edit applied successfully`);

      return {
        patchedCode,
        commentary: editPlan.commentary,
      };
    } catch (error) {
      logger.error("[MORPH] Surgical edit failed, using fallback:", error);
      return await this.fallbackEdit(originalCode, editRequest);
    }
  }

  /**
   * Fallback: AI-based edit (less precise than Morph)
   */
  private async fallbackEdit(
    originalCode: string,
    editRequest: string,
  ): Promise<{ patchedCode: string; commentary: string }> {
    logger.info("[MORPH] Using fallback AI edit");

    const { object } = await generateObject({
      model: customModelProvider.getModel({
        provider: "anthropic",
        model: "claude-sonnet-4-20250514",
      }),
      schema: z.object({
        code: z.string(),
        commentary: z.string(),
      }),
      prompt: `Original code:
\`\`\`
${originalCode}
\`\`\`

Apply this edit: "${editRequest}"

Return the COMPLETE modified code. Try to minimize changes - only modify what's necessary.`,
    });

    return {
      patchedCode: object.code,
      commentary: object.commentary,
    };
  }

  /**
   * Batch edit multiple files (for complex changes)
   */
  async applyBatchEdits(
    edits: Array<{
      filePath: string;
      code: string;
      editRequest: string;
    }>,
  ): Promise<
    Array<{ filePath: string; patchedCode: string; commentary: string }>
  > {
    logger.info(`[MORPH] Applying ${edits.length} batch edits`);

    const results = await Promise.all(
      edits.map(async ({ filePath, code, editRequest }) => {
        const result = await this.applyEdit(code, editRequest, filePath);
        return {
          filePath,
          ...result,
        };
      }),
    );

    return results;
  }
}

// Singleton instance
export const morphService = new MorphService();
