import "server-only";

/**
 * Text Chunking Utility for RAG
 *
 * Chunks text into smaller pieces for embedding generation.
 * Preserves sentence boundaries and adds overlap between chunks
 * to maintain context across chunk boundaries.
 */

export interface ChunkOptions {
  /** Approximate max tokens per chunk (default: 500) */
  maxTokens?: number;
  /** Number of tokens to overlap between chunks (default: 50) */
  overlap?: number;
  /** Try to keep sentences intact (default: true) */
  preserveSentences?: boolean;
}

export interface TextChunk {
  text: string;
  startIndex: number;
  endIndex: number;
  chunkIndex: number;
}

/**
 * Rough token estimation: ~4 characters per token for English text
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Split text into chunks with optional overlap
 *
 * @param text - The text to chunk
 * @param options - Chunking options
 * @returns Array of text chunks with metadata
 */
export function chunkText(
  text: string,
  options: ChunkOptions = {},
): TextChunk[] {
  const { maxTokens = 500, overlap = 50, preserveSentences = true } = options;

  // Calculate character limits based on token estimates
  const maxChars = maxTokens * 4;
  const overlapChars = overlap * 4;

  // If text fits in one chunk, return as-is
  if (text.length <= maxChars) {
    return [
      {
        text: text.trim(),
        startIndex: 0,
        endIndex: text.length,
        chunkIndex: 0,
      },
    ];
  }

  const chunks: TextChunk[] = [];
  let startIndex = 0;
  let chunkIndex = 0;

  while (startIndex < text.length) {
    let endIndex = Math.min(startIndex + maxChars, text.length);

    // Try to end at sentence boundary if preserveSentences is enabled
    if (preserveSentences && endIndex < text.length) {
      // Look for sentence-ending punctuation
      const sentenceEnd = text.lastIndexOf(".", endIndex);
      const questionEnd = text.lastIndexOf("?", endIndex);
      const exclamationEnd = text.lastIndexOf("!", endIndex);

      const lastSentenceEnd = Math.max(
        sentenceEnd,
        questionEnd,
        exclamationEnd,
      );

      // Only use sentence boundary if it's not too early in the chunk
      // (at least 70% of maxChars to avoid tiny chunks)
      const minChunkEnd = startIndex + maxChars * 0.7;
      if (lastSentenceEnd > minChunkEnd) {
        endIndex = lastSentenceEnd + 1;
      }
    }

    const chunkText = text.slice(startIndex, endIndex).trim();

    if (chunkText.length > 0) {
      chunks.push({
        text: chunkText,
        startIndex,
        endIndex,
        chunkIndex: chunkIndex++,
      });
    }

    // Move start forward, with overlap to maintain context
    // Don't overlap if we're at the end
    if (endIndex >= text.length) {
      break;
    }

    startIndex = Math.max(startIndex + 1, endIndex - overlapChars);
  }

  return chunks;
}

/**
 * Chunk text and return with metadata for indexing
 *
 * @param text - The text to chunk
 * @param options - Chunking options plus metadata
 * @returns Array of content objects ready for indexing
 */
export function chunkTextWithMetadata(
  text: string,
  options: ChunkOptions & {
    /** Parent document/message ID */
    documentId?: string;
    /** Additional metadata to include in each chunk */
    metadata?: Record<string, unknown>;
  } = {},
): Array<{
  id?: string;
  content: string;
  payload: Record<string, unknown>;
}> {
  const { documentId, metadata = {}, ...chunkOptions } = options;
  const chunks = chunkText(text, chunkOptions);

  return chunks.map((chunk) => ({
    // Generate unique ID for each chunk
    id: documentId ? `${documentId}_chunk_${chunk.chunkIndex}` : undefined,
    content: chunk.text,
    payload: {
      ...metadata,
      parentId: documentId,
      chunkIndex: chunk.chunkIndex,
      totalChunks: chunks.length,
      startIndex: chunk.startIndex,
      endIndex: chunk.endIndex,
      isChunked: chunks.length > 1,
    },
  }));
}

/**
 * Check if text needs chunking based on token estimate
 */
export function needsChunking(text: string, maxTokens: number = 500): boolean {
  return estimateTokens(text) > maxTokens;
}

/**
 * Truncate text to fit within token limit
 * Useful for single-chunk scenarios
 */
export function truncateToTokenLimit(
  text: string,
  maxTokens: number = 8000,
  suffix: string = "...",
): string {
  const maxChars = maxTokens * 4;

  if (text.length <= maxChars) {
    return text;
  }

  // Try to truncate at sentence boundary
  const truncated = text.slice(0, maxChars - suffix.length);
  const lastSentence = Math.max(
    truncated.lastIndexOf("."),
    truncated.lastIndexOf("?"),
    truncated.lastIndexOf("!"),
  );

  if (lastSentence > maxChars * 0.7) {
    return truncated.slice(0, lastSentence + 1) + suffix;
  }

  // Fall back to word boundary
  const lastSpace = truncated.lastIndexOf(" ");
  if (lastSpace > 0) {
    return truncated.slice(0, lastSpace) + suffix;
  }

  return truncated + suffix;
}
