/**
 * System prompts for conversation summarization/compaction
 */

/**
 * System prompt for summarizing conversation history
 * Used when context needs to be compacted to fit within model limits
 */
export const SUMMARIZATION_SYSTEM_PROMPT = `You are a conversation summarizer. Your task is to create a comprehensive summary of a conversation that will allow an AI assistant to continue the conversation seamlessly.

Your summary MUST preserve:
1. **Key Decisions & Conclusions**: Any decisions made, problems solved, or conclusions reached
2. **Important Context**: Facts, preferences, requirements, and constraints established
3. **Task State**: Current progress on any ongoing tasks, what has been completed, what remains
4. **Technical Details**: Code snippets, file paths, API endpoints, error messages, or other technical information that was referenced
5. **User Preferences**: Communication style, preferred approaches, or explicit preferences stated
6. **Tool Usage**: What tools were used and their results (summarized)

Format your summary as a structured document with clear sections. Be concise but thorough - the AI reading this summary should be able to continue the conversation as if it had full context.

DO NOT include:
- Redundant information or repetition
- Casual conversation that doesn't contribute to context
- Full tool outputs (summarize the key findings instead)
- Step-by-step recreation of the conversation flow`;

/**
 * Build the user prompt for summarization with the actual conversation
 */
export function buildSummarizationPrompt(
  conversationText: string,
  additionalContext?: string,
): string {
  let prompt = `## CONVERSATION TO SUMMARIZE

${conversationText}

---

Please create a comprehensive summary of this conversation following the guidelines provided. Focus on preserving all information needed for the AI to continue this conversation seamlessly.`;

  if (additionalContext) {
    prompt += `

## ADDITIONAL CONTEXT TO PRESERVE
${additionalContext}`;
  }

  return prompt;
}

/**
 * Template for the summary output format
 * This helps maintain consistency in generated summaries
 */
export const SUMMARY_FORMAT_TEMPLATE = `## Conversation Summary

### Context & Background
[Brief overview of what the conversation is about]

### Key Decisions & Conclusions
- [Decision/conclusion 1]
- [Decision/conclusion 2]

### Current Task State
- Completed: [What has been done]
- In Progress: [Current work]
- Remaining: [What still needs to be done]

### Technical Details
[Important code, paths, configurations, etc.]

### User Preferences
[Any stated preferences or requirements]

### Important Notes
[Any other critical context]`;

/**
 * Extract text content from message parts for summarization
 */
export function extractMessageText(parts: any[]): string {
  const textParts: string[] = [];

  for (const part of parts) {
    if (part.type === "text" && part.text) {
      textParts.push(part.text);
    } else if (part.type === "tool-invocation" || part.type === "tool-result") {
      // Include tool name and summarized output
      const toolName = part.toolName || "unknown tool";
      const hasOutput = part.state?.startsWith("output") && part.output;

      if (hasOutput) {
        const outputPreview =
          typeof part.output === "string"
            ? part.output.slice(0, 500)
            : JSON.stringify(part.output).slice(0, 500);
        textParts.push(
          `[Used ${toolName}: ${outputPreview}${outputPreview.length >= 500 ? "..." : ""}]`,
        );
      } else {
        textParts.push(`[Called ${toolName}]`);
      }
    }
  }

  return textParts.join("\n");
}

/**
 * Format messages array into text suitable for summarization
 */
export function formatMessagesForSummarization(
  messages: Array<{ role: string; parts: any[] }>,
): string {
  const formatted: string[] = [];

  for (const message of messages) {
    const roleLabel =
      message.role === "user"
        ? "User"
        : message.role === "assistant"
          ? "Assistant"
          : message.role;
    const content = extractMessageText(message.parts);

    if (content.trim()) {
      formatted.push(`**${roleLabel}:**\n${content}`);
    }
  }

  return formatted.join("\n\n---\n\n");
}
