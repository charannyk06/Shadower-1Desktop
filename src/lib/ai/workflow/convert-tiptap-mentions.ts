/**
 * Converts text with {{nodeId.output.path}} placeholders to TipTap document format
 * with proper mention nodes that the workflow executor can resolve.
 *
 * Supported formats:
 * - {{nodeId.output}} - References the entire output of a node
 * - {{nodeId.output.field}} - References a specific field in the output
 * - {{nodeId.output.nested.path}} - References a nested path in the output
 *
 * @param text - Text containing {{nodeId.output.path}} placeholders
 * @param idMapping - Mapping from AI-generated node IDs to actual UUIDs
 * @param nodeKinds - Optional mapping from original node IDs to their kinds (for path correction)
 * @returns TipTap document structure with mentions
 */
export function convertTextToTiptapWithMentions(
  text: string,
  idMapping: Record<string, string>,
  nodeKinds?: Record<string, string>,
): any {
  if (!text || text.trim() === "") {
    return {
      type: "doc",
      content: [],
    };
  }

  // Split text by newlines to create separate paragraphs
  const lines = text.split(/\r?\n/);
  const paragraphs: any[] = [];

  for (const line of lines) {
    const paragraphContent = processLineWithMentions(
      line,
      idMapping,
      nodeKinds,
    );
    paragraphs.push({
      type: "paragraph",
      content: paragraphContent,
    });
  }

  return {
    type: "doc",
    content: paragraphs,
  };
}

/**
 * Corrects the output path based on the source node kind.
 * AI often generates wrong paths - this fixes common mistakes.
 */
function correctPathForNodeKind(
  path: string[],
  nodeKind: string | undefined,
): string[] {
  if (!nodeKind) return path;

  // Common wrong paths that AI generates
  const wrongPaths = [
    "response",
    "output",
    "result",
    "text",
    "data",
    "content",
  ];

  switch (nodeKind) {
    case "llm":
      // LLM nodes always output at ["answer"]
      if (path.length === 0 || wrongPaths.includes(path[0])) {
        return ["answer"];
      }
      break;
    case "tool":
      // Tool nodes always output at ["tool_result"]
      if (path.length === 0 || wrongPaths.includes(path[0])) {
        return ["tool_result"];
      }
      break;
    case "template":
      // Template nodes always output at ["template"]
      if (path.length === 0 || wrongPaths.includes(path[0])) {
        return ["template"];
      }
      break;
    case "http":
      // HTTP nodes output at ["response", "body"] for body content
      if (
        path.length === 0 ||
        (path.length === 1 && wrongPaths.includes(path[0]))
      ) {
        return ["response", "body"];
      }
      break;
    // input and condition nodes - keep path as-is (they reference schema properties)
  }

  return path;
}

/**
 * Processes a single line of text, converting {{nodeId.output.path}} placeholders
 * to TipTap mention nodes.
 */
function processLineWithMentions(
  line: string,
  idMapping: Record<string, string>,
  nodeKinds?: Record<string, string>,
): any[] {
  if (!line) {
    return [];
  }

  // Regex to match {{nodeId.output.path.to.value}} or {{nodeId.output}}
  // Also handles variations like {{ node-id.output.field }} with spaces
  const mentionRegex = /\{\{\s*([a-zA-Z0-9_-]+)\.output(?:\.([^}]+))?\s*\}\}/g;

  const content: any[] = [];
  let lastIndex = 0;
  let match;

  while ((match = mentionRegex.exec(line)) !== null) {
    // Add text before the match
    if (match.index > lastIndex) {
      const textBefore = line.slice(lastIndex, match.index);
      if (textBefore) {
        content.push({ type: "text", text: textBefore });
      }
    }

    const originalNodeId = match[1]; // e.g., "node-input-1" or "input-1"
    const pathString = match[2]; // e.g., "query" or "tool_result" or "nested.path" or undefined

    // Map to actual UUID if available, otherwise use original ID
    const actualNodeId = idMapping[originalNodeId] || originalNodeId;

    // Build the path array - split by dots
    let path = pathString ? pathString.split(".") : [];

    // Correct the path based on node kind (fix AI mistakes)
    const nodeKind = nodeKinds?.[originalNodeId];
    path = correctPathForNodeKind(path, nodeKind);

    // Create the mention node with OutputSchemaSourceKey in attrs.label
    // This format is expected by the workflow executor
    const sourceKey = {
      nodeId: actualNodeId,
      path: path,
    };

    content.push({
      type: "mention",
      attrs: {
        id: actualNodeId,
        label: JSON.stringify(sourceKey),
      },
    });

    lastIndex = match.index + match[0].length;
  }

  // Add remaining text after last match
  if (lastIndex < line.length) {
    const remainingText = line.slice(lastIndex);
    if (remainingText) {
      content.push({ type: "text", text: remainingText });
    }
  }

  // If no matches found and line is not empty, return plain text
  if (content.length === 0 && line) {
    content.push({ type: "text", text: line });
  }

  return content;
}

/**
 * Extracts all node references from a TipTap document.
 * Useful for validation and dependency tracking.
 */
export function extractMentionsFromTiptap(
  doc: any,
): Array<{ nodeId: string; path: string[] }> {
  const mentions: Array<{ nodeId: string; path: string[] }> = [];

  function traverse(node: any) {
    if (!node) return;

    if (node.type === "mention" && node.attrs?.label) {
      try {
        const sourceKey = JSON.parse(node.attrs.label);
        if (sourceKey.nodeId) {
          mentions.push({
            nodeId: sourceKey.nodeId,
            path: sourceKey.path || [],
          });
        }
      } catch {
        // Invalid JSON in label, skip
      }
    }

    if (Array.isArray(node.content)) {
      for (const child of node.content) {
        traverse(child);
      }
    }
  }

  traverse(doc);
  return mentions;
}

/**
 * Validates that all mentions in a TipTap document reference valid nodes.
 */
export function validateTiptapMentions(
  doc: any,
  validNodeIds: Set<string>,
): { valid: boolean; invalidRefs: string[] } {
  const mentions = extractMentionsFromTiptap(doc);
  const invalidRefs: string[] = [];

  for (const mention of mentions) {
    if (!validNodeIds.has(mention.nodeId)) {
      invalidRefs.push(mention.nodeId);
    }
  }

  return {
    valid: invalidRefs.length === 0,
    invalidRefs,
  };
}

/**
 * Converts a string value that may contain {{nodeId.output.path}} to OutputSchemaSourceKey.
 * Used for HTTP node fields like URL, headers, query params, and body.
 *
 * If the entire string is a single variable reference like {{input-1.output.webhookUrl}},
 * returns an OutputSchemaSourceKey object.
 * If it's a plain string (like "https://api.example.com"), returns the string as-is.
 * If it contains mixed content or multiple references, returns the string as-is
 * (these should use Template node for proper string interpolation).
 *
 * @param value - The string value that may contain a variable reference
 * @param idMapping - Mapping from AI-generated node IDs to actual UUIDs
 * @returns OutputSchemaSourceKey if single reference, otherwise the original string
 */
export function convertStringToHttpValue(
  value: string | undefined | null,
  idMapping: Record<string, string>,
): string | { nodeId: string; path: string[] } | undefined {
  if (!value || typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();

  // Check if the entire string is a single variable reference
  // Matches: {{nodeId.output}} or {{nodeId.output.field}} or {{nodeId.output.nested.path}}
  const fullMatchRegex =
    /^\{\{\s*([a-zA-Z0-9_-]+)\.output(?:\.([^}]+))?\s*\}\}$/;
  const match = trimmed.match(fullMatchRegex);

  if (match) {
    const originalNodeId = match[1];
    const pathString = match[2];

    // Map to actual UUID if available
    const actualNodeId = idMapping[originalNodeId] || originalNodeId;

    // Build the path array
    const path = pathString ? pathString.split(".") : [];

    return {
      nodeId: actualNodeId,
      path: path,
    };
  }

  // Not a single variable reference - return as plain string
  // If it contains {{...}} mixed with other content, it's a template that should
  // be handled differently (user should use Template node for string interpolation)
  return trimmed;
}

/**
 * Converts HTTP node header/query arrays, processing any variable references.
 *
 * @param items - Array of {key, value} objects
 * @param idMapping - Mapping from AI-generated node IDs to actual UUIDs
 * @returns Processed array with values converted to OutputSchemaSourceKey where applicable
 */
export function convertHttpKeyValueArray(
  items: Array<{ key: string; value?: string }> | undefined | null,
  idMapping: Record<string, string>,
): Array<{ key: string; value?: string | { nodeId: string; path: string[] } }> {
  if (!items || !Array.isArray(items)) {
    return [];
  }

  return items.map((item) => ({
    key: item.key,
    value: convertStringToHttpValue(item.value, idMapping),
  }));
}
