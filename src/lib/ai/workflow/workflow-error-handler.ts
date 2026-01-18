/**
 * Shared error handling utilities for workflow generation
 * Consolidates duplicated error detection logic
 */

export interface WorkflowErrorInfo {
  isToolCallUnsupported: boolean;
  isReasoningError: boolean;
  errorMessage: string;
}

/**
 * Detects workflow generation error types from error objects
 * Used to provide appropriate error messages to users
 */
export function detectWorkflowError(error: unknown): WorkflowErrorInfo {
  const errorStr = String(error);
  const errorMessage = error instanceof Error ? error.message : errorStr;

  // Check for model not supported error (custom 400 response)
  const isToolCallUnsupported =
    errorStr.includes("doesn't support tool calling") ||
    errorStr.includes("not supported for workflow generation");

  // Check for reasoning model errors
  // This error occurs when the AI SDK processes a function_call that references
  // a reasoning item that doesn't exist in the stream
  const isReasoningError =
    errorStr.includes("reasoning") ||
    errorStr.includes("function_call") ||
    (errorStr.includes("Item") && errorStr.includes("reasoning")) ||
    (errorStr.includes("required") && errorStr.includes("reasoning"));

  return {
    isToolCallUnsupported,
    isReasoningError,
    errorMessage,
  };
}

/**
 * Get user-friendly error message for workflow generation errors
 */
export function getWorkflowErrorMessage(error: unknown): string {
  const errorInfo = detectWorkflowError(error);

  if (errorInfo.isToolCallUnsupported) {
    return "This model doesn't support workflow generation. Please select a different model like Gemini 2.5 Flash or GPT-4.1.";
  }

  if (errorInfo.isReasoningError) {
    return "This model isn't compatible with workflow generation. Try Gemini 2.5 Flash or GPT-4.1.";
  }

  return "Failed to generate workflow. Try using a different model.";
}

/**
 * Log workflow generation error with appropriate level
 * Used in API routes for server-side logging
 */
export function logWorkflowError(
  error: unknown,
  context: {
    model?: string;
    isReasoningModel?: boolean;
    prefix?: string;
  } = {},
): void {
  const errorInfo = detectWorkflowError(error);
  const prefix = context.prefix || "[Workflow Generation]";
  const errorStr = String(error);

  if (errorInfo.isReasoningError) {
    console.error(
      `${prefix} Reasoning-related error. Model: ${context.model}, isReasoningModel: ${context.isReasoningModel}, Error: ${errorStr}`,
    );
  } else {
    console.error(`${prefix} Unexpected error: ${errorStr}`);
  }
}
