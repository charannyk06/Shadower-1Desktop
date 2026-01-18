import { getSession } from "auth/server";
import { NextResponse } from "next/server";
import { indexContent } from "lib/vector-search/vector-search-service";
import {
  chunkTextWithMetadata,
  estimateTokens,
} from "lib/vector-search/text-chunking";
import { serverFileStorage } from "lib/file-storage";
import {
  ensureCollection,
  scrollPoints,
} from "lib/vector-search/qdrant-service";
import { COLLECTIONS } from "lib/vector-search/qdrant-client";
import logger from "logger";
import { randomUUID } from "crypto";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5 minutes for large file processing

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

/**
 * GET /api/knowledge/bases
 * List knowledge bases for the current user with pagination and search
 * Query params:
 * - page: page number (default: 1)
 * - limit: items per page (default: 20, max: 100)
 * - search: search query for name/description (optional)
 */
export async function GET(request: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const limit = Math.min(
      MAX_PAGE_SIZE,
      Math.max(
        1,
        parseInt(searchParams.get("limit") || String(DEFAULT_PAGE_SIZE), 10),
      ),
    );
    const searchQuery = searchParams.get("search")?.trim() || undefined;

    const userId = session.user.id;

    // Build filter
    const baseFilter: any = {
      must: [{ key: "userId", match: { value: userId } }],
    };

    // Scroll through all knowledge base points for this user
    // Note: We need to group by knowledgeBaseId, so we fetch all matching points
    // then group and paginate the grouped results
    let allPoints: Array<{
      id: string | number;
      payload?: Record<string, unknown> | null;
    }> = [];
    let currentOffset: string | number | undefined = undefined;
    let hasMore = true;

    // Fetch all points (we need to group them, so pagination happens after grouping)
    while (hasMore) {
      const batch = await scrollPoints(COLLECTIONS.KNOWLEDGE_BASE, {
        limit: 1000, // Fetch in batches
        offset: currentOffset,
        filter: baseFilter,
        withPayload: true,
        withVector: false,
      });

      allPoints = allPoints.concat(batch.points);
      currentOffset = batch.nextOffset || undefined;
      hasMore = batch.nextOffset !== null;

      // Limit total fetch to prevent excessive memory usage
      if (allPoints.length > 10000) {
        logger.warn(
          "[Knowledge API] Limiting knowledge base fetch to 10000 points",
        );
        break;
      }
    }

    // Group points by knowledgeBaseId
    const knowledgeBasesMap = new Map<
      string,
      {
        id: string;
        name: string;
        description?: string;
        files: Array<{
          fileName: string;
          chunks: number;
          fileUrl?: string;
          storageKey?: string;
        }>;
        totalChunks: number;
        createdAt: string;
      }
    >();

    for (const point of allPoints) {
      const payload = point.payload as any;
      const kbId = payload?.knowledgeBaseId;

      if (!kbId) continue; // Skip points without knowledgeBaseId

      if (!knowledgeBasesMap.has(kbId)) {
        knowledgeBasesMap.set(kbId, {
          id: kbId,
          name: payload?.knowledgeBaseName || "Unnamed Knowledge Base",
          description: payload?.description,
          files: [],
          totalChunks: 0,
          createdAt: payload?.createdAt || new Date().toISOString(),
        });
      }

      const kb = knowledgeBasesMap.get(kbId)!;
      const fileName = payload?.fileName;

      if (fileName) {
        const existingFile = kb.files.find((f) => f.fileName === fileName);
        if (existingFile) {
          existingFile.chunks += 1;
        } else {
          kb.files.push({
            fileName,
            chunks: 1,
            fileUrl: payload?.fileUrl,
            storageKey: payload?.storageKey,
          });
        }
      }

      kb.totalChunks += 1;
    }

    let knowledgeBases = Array.from(knowledgeBasesMap.values());

    // Apply search filter if provided
    if (searchQuery) {
      const queryLower = searchQuery.toLowerCase();
      knowledgeBases = knowledgeBases.filter(
        (kb) =>
          kb.name.toLowerCase().includes(queryLower) ||
          (kb.description && kb.description.toLowerCase().includes(queryLower)),
      );
    }

    // Sort by creation date (newest first)
    knowledgeBases.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );

    // Apply pagination to grouped results
    const total = knowledgeBases.length;
    const totalPages = Math.ceil(total / limit);
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + limit;
    const paginatedBases = knowledgeBases.slice(startIndex, endIndex);

    return NextResponse.json({
      knowledgeBases: paginatedBases,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasMore: page < totalPages,
      },
    });
  } catch (error: any) {
    logger.error("[Knowledge API] Failed to list knowledge bases:", error);
    return NextResponse.json(
      { error: error.message || "Failed to list knowledge bases" },
      { status: 500 },
    );
  }
}

/**
 * POST /api/knowledge/bases
 * Create a new knowledge base by uploading and processing files
 */
export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const formData = await request.formData();
    const name = formData.get("name") as string;
    const description = (formData.get("description") as string) || "";
    const minChunkSize = parseInt(
      (formData.get("minChunkSize") as string) || "100",
      10,
    );
    const maxChunkSize = parseInt(
      (formData.get("maxChunkSize") as string) || "1024",
      10,
    );
    const overlap = parseInt((formData.get("overlap") as string) || "200", 10);
    const files = formData.getAll("files") as File[];

    if (!name || !name.trim()) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    if (!files || files.length === 0) {
      return NextResponse.json(
        { error: "At least one file is required" },
        { status: 400 },
      );
    }

    const knowledgeBaseId = `kb-${Date.now()}-${randomUUID()}`;
    const processedFiles: Array<{
      fileName: string;
      chunks: number;
      indexed: number;
    }> = [];
    let lastError: string | null = null; // Track the last error for better error messages

    // Ensure knowledge_base collection exists before processing files
    try {
      logger.info(
        "[Knowledge API] Ensuring knowledge_base collection exists...",
      );
      await ensureCollection(COLLECTIONS.KNOWLEDGE_BASE);
      logger.info("[Knowledge API] Knowledge base collection ready");
    } catch (collectionError: any) {
      logger.error(
        "[Knowledge API] Failed to ensure knowledge_base collection:",
        collectionError,
      );
      return NextResponse.json(
        {
          error: `Failed to initialize knowledge base collection: ${collectionError.message || String(collectionError)}`,
          details: "Please ensure Qdrant is configured and accessible",
        },
        { status: 500 },
      );
    }

    // Process each file
    for (const file of files) {
      const fileName = file.name;

      try {
        logger.info(
          `[Knowledge API] Processing file: ${fileName} (${file.size} bytes)`,
        );

        // Read file content
        const arrayBuffer = await file.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        // Extract text based on file type
        let text = "";
        const fileExtension = fileName.split(".").pop()?.toLowerCase();

        if (fileExtension === "txt" || fileExtension === "md") {
          text = buffer.toString("utf-8");
        } else if (fileExtension === "pdf") {
          // For PDF files - try pdf-parse, fallback to text extraction
          try {
            // Dynamic import - pdf-parse may not be installed
            const pdfParse = await import("pdf-parse" as string).catch(
              () => null,
            );
            if (pdfParse?.default) {
              const pdfData = await pdfParse.default(buffer);
              text = pdfData.text;
            } else {
              throw new Error("pdf-parse not available");
            }
          } catch (error) {
            logger.warn(
              `PDF parsing not available for ${fileName}, using text fallback:`,
              error,
            );
            // Fallback: try to extract readable text from PDF buffer
            // This is a basic fallback - proper PDF parsing requires pdf-parse package
            text = buffer.toString("utf-8").replace(/[^\x20-\x7E\n\r]/g, "");
            if (text.trim().length < 100) {
              throw new Error(
                "PDF parsing failed and text extraction insufficient",
              );
            }
          }
        } else if (fileExtension === "docx") {
          // For DOCX files using mammoth
          try {
            const mammoth = await import("mammoth");
            const result = await mammoth.extractRawText({ buffer });
            text = result.value;
          } catch (error) {
            logger.warn(`Failed to parse DOCX ${fileName}:`, error);
            throw new Error(`Failed to parse DOCX file: ${fileName}`);
          }
        } else if (fileExtension === "csv") {
          // For CSV files, convert to readable text
          text = buffer.toString("utf-8");
          // Convert CSV rows to readable format
          const lines = text.split("\n");
          text = lines
            .map((line, i) => {
              if (i === 0) return `Headers: ${line}`;
              return `Row ${i}: ${line}`;
            })
            .join("\n");
        } else if (fileExtension === "html") {
          // For HTML files, extract text content (basic)
          text = buffer.toString("utf-8");
          // Remove HTML tags (basic implementation)
          text = text
            .replace(/<[^>]*>/g, " ")
            .replace(/\s+/g, " ")
            .trim();
        } else if (fileExtension === "pptx") {
          // For PPTX files - extract text from slides
          try {
            logger.info(
              `[Knowledge API] Starting PPTX parsing for ${fileName}`,
            );
            const JSZipModule = await import("jszip");
            // Handle both ESM and CJS module formats
            const JSZip = (JSZipModule as any).default || JSZipModule;
            const { DOMParser } = await import("@xmldom/xmldom");

            logger.info(
              `[Knowledge API] JSZip and DOMParser loaded, loading ZIP archive...`,
            );
            const zip = await JSZip.loadAsync(buffer);
            logger.info(`[Knowledge API] ZIP archive loaded successfully`);

            // Find all slide XML files
            const slideFiles: string[] = [];
            zip.forEach((relativePath: string) => {
              if (
                relativePath.startsWith("ppt/slides/slide") &&
                relativePath.endsWith(".xml")
              ) {
                slideFiles.push(relativePath);
              }
            });

            // Sort slides by number
            slideFiles.sort((a, b) => {
              const matchA = /slide(\d+)\.xml/.exec(a);
              const matchB = /slide(\d+)\.xml/.exec(b);
              const numA = Number.parseInt(matchA?.[1] || "0", 10);
              const numB = Number.parseInt(matchB?.[1] || "0", 10);
              return numA - numB;
            });

            if (slideFiles.length === 0) {
              throw new Error("No slides found in PPTX file");
            }

            logger.info(
              `[Knowledge API] Found ${slideFiles.length} slides in PPTX file ${fileName}`,
            );

            // Extract text from each slide
            const slideTexts: string[] = [];
            for (let i = 0; i < slideFiles.length; i++) {
              const slidePath = slideFiles[i];
              try {
                const slideXml = await zip.file(slidePath)?.async("string");
                if (!slideXml) {
                  logger.warn(
                    `[Knowledge API] Slide ${i + 1} XML not found: ${slidePath}`,
                  );
                  continue;
                }

                // Parse XML to extract text content
                const parser = new DOMParser();
                const xmlDoc = parser.parseFromString(slideXml, "text/xml");

                // Check for parsing errors
                const parseError = xmlDoc.getElementsByTagName("parsererror");
                if (parseError.length > 0) {
                  const errorText =
                    parseError[0].textContent || "Unknown XML parsing error";
                  logger.warn(
                    `[Knowledge API] XML parsing error in slide ${i + 1}:`,
                    errorText,
                  );
                }

                // Extract text from <a:t> elements (text runs in PowerPoint)
                const textElements = xmlDoc.getElementsByTagName("a:t");
                const slideText: string[] = [];
                for (let j = 0; j < textElements.length; j++) {
                  const element = textElements[j];
                  const txt = element.textContent?.trim();
                  if (txt) slideText.push(txt);
                }

                if (slideText.length > 0) {
                  slideTexts.push(
                    `Slide ${slideTexts.length + 1}: ${slideText.join(" ")}`,
                  );
                } else {
                  logger.warn(
                    `[Knowledge API] No text found in slide ${i + 1} (${slidePath})`,
                  );
                }
              } catch (slideError: any) {
                logger.warn(
                  `[Knowledge API] Error processing slide ${i + 1}:`,
                  {
                    error: slideError.message,
                    slidePath,
                  },
                );
                // Continue with other slides
              }
            }

            text = slideTexts.join("\n\n");

            if (!text || text.trim().length === 0) {
              throw new Error(
                `No text content found in PPTX slides (processed ${slideFiles.length} slides, extracted ${slideTexts.length} slide texts)`,
              );
            }

            logger.info(
              `[Knowledge API] Extracted ${text.length} characters from PPTX (${slideTexts.length} slides with text)`,
            );
          } catch (error: any) {
            logger.error(`[Knowledge API] Failed to parse PPTX ${fileName}:`, {
              error: error.message,
              stack: error.stack,
              name: error.name,
            });
            throw new Error(
              `Failed to parse PPTX file: ${error.message || String(error)}`,
            );
          }
        } else if (fileExtension === "xlsx" || fileExtension === "xls") {
          // For Excel files - basic text extraction
          try {
            // Dynamic import - exceljs may not be installed
            const ExcelJSModule = await import("exceljs" as string).catch(
              () => null,
            );
            if (!ExcelJSModule?.default) {
              throw new Error("exceljs not available");
            }
            const ExcelJS = ExcelJSModule.default;
            const workbook = new ExcelJS.Workbook();
            await workbook.xlsx.load(buffer);

            const sheetTexts: string[] = [];
            workbook.eachSheet((worksheet) => {
              const rows: string[] = [];
              worksheet.eachRow((row, rowNumber) => {
                const cellValues = row.values
                  .slice(1) // Remove first empty element
                  .map((cell: any) => {
                    if (cell && typeof cell === "object" && cell.text) {
                      return cell.text;
                    }
                    return String(cell || "");
                  })
                  .filter((v: string) => v.trim().length > 0);

                if (cellValues.length > 0) {
                  rows.push(`Row ${rowNumber}: ${cellValues.join(" | ")}`);
                }
              });

              if (rows.length > 0) {
                sheetTexts.push(`Sheet: ${worksheet.name}\n${rows.join("\n")}`);
              }
            });

            text = sheetTexts.join("\n\n");
          } catch (error: any) {
            logger.warn(`Failed to parse Excel ${fileName}:`, error);
            // Fallback to basic text extraction
            text = buffer.toString("utf-8").replace(/[^\x20-\x7E\n\r]/g, "");
          }
        } else {
          // Try as plain text for other formats (txt, md, etc.)
          text = buffer.toString("utf-8");
        }

        // Validate text content
        const trimmedText = text.trim();
        logger.info(
          `[Knowledge API] Extracted text from ${fileName}: ${trimmedText.length} characters`,
        );

        if (!trimmedText || trimmedText.length < minChunkSize) {
          const errorMsg = `File ${fileName} has insufficient content (${trimmedText.length} chars, min: ${minChunkSize})`;
          logger.warn(`[Knowledge API] ${errorMsg}`);
          throw new Error(errorMsg);
        }

        // Upload file to storage
        const storageKey = `knowledge-bases/${knowledgeBaseId}/${fileName}`;
        let uploadResult;
        try {
          uploadResult = await serverFileStorage.upload(buffer, {
            filename: storageKey,
            contentType: file.type || "application/octet-stream",
          });
          logger.info(
            `[Knowledge API] File uploaded to storage: ${storageKey}`,
          );
        } catch (uploadError: any) {
          logger.error(
            `[Knowledge API] Failed to upload file ${fileName} to storage:`,
            uploadError,
          );
          throw new Error(
            `Failed to upload file to storage: ${uploadError.message || String(uploadError)}`,
          );
        }

        // Chunk the text according to user parameters
        const tokenCount = estimateTokens(trimmedText);
        const basePayload = {
          userId: session.user.id,
          knowledgeBaseId,
          knowledgeBaseName: name,
          fileName,
          fileUrl: uploadResult.sourceUrl,
          storageKey,
          description,
          createdAt: new Date().toISOString(),
        };

        let chunks: Array<{
          id?: string;
          content: string;
          payload?: Record<string, unknown>;
        }> = [];

        if (tokenCount > maxChunkSize) {
          // Use chunking for large documents
          chunks = chunkTextWithMetadata(trimmedText, {
            documentId: `${knowledgeBaseId}-${fileName}`,
            maxTokens: maxChunkSize,
            overlap,
            preserveSentences: true,
            metadata: basePayload,
          });
        } else {
          // Single chunk for small documents
          chunks = [
            {
              id: `${knowledgeBaseId}-${fileName}-chunk-0`,
              content: trimmedText,
              payload: basePayload,
            },
          ];
        }

        // Index chunks to Qdrant
        let result;
        try {
          result = await indexContent("knowledge", chunks, {
            userId: session.user.id,
            trackInPostgres: true,
          });
          logger.info(
            `[Knowledge API] Indexed ${result.indexed} chunks to Qdrant for ${fileName}`,
          );
        } catch (indexError: any) {
          logger.error(
            `[Knowledge API] Failed to index chunks for ${fileName}:`,
            indexError,
          );
          throw new Error(
            `Failed to index content: ${indexError.message || String(indexError)}`,
          );
        }

        processedFiles.push({
          fileName,
          chunks: chunks.length,
          indexed: result.indexed,
        });

        logger.info(
          `Processed ${fileName}: ${chunks.length} chunks, ${result.indexed} indexed`,
        );
      } catch (error: any) {
        const fileError = error.message || String(error);
        lastError = fileError; // Update lastError for error reporting
        const errorDetails = {
          error: fileError,
          fileName,
          fileSize: file.size,
          fileType: file.type,
          fileExtension: fileName.split(".").pop()?.toLowerCase(),
        };
        logger.error(
          `[Knowledge API] Failed to process file ${fileName}:`,
          errorDetails,
        );
        console.error(
          `[Knowledge API] File processing error for ${fileName}:`,
          {
            message: error.message,
            name: error.name,
            stack: error.stack,
            ...errorDetails,
          },
        );

        // Add to processedFiles with error info so user knows what failed
        processedFiles.push({
          fileName,
          chunks: 0,
          indexed: 0,
        });
      }
    }

    // Check if any files were successfully processed
    const successfulFiles = processedFiles.filter((f) => f.indexed > 0);

    if (successfulFiles.length === 0) {
      const fileNames = files.map((f) => f.name).join(", ");
      const errorDetails = {
        totalFiles: files.length,
        processedFiles: processedFiles.length,
        fileNames: files.map((f) => ({
          name: f.name,
          size: f.size,
          type: f.type,
          extension: f.name.split(".").pop()?.toLowerCase(),
        })),
        qdrantUrl: process.env.QDRANT_URL ? "configured" : "missing",
        hasStorage: !!serverFileStorage,
      };

      logger.error(
        "[Knowledge API] No files successfully processed:",
        errorDetails,
      );
      console.error(
        "[Knowledge API] Processing failed - details:",
        JSON.stringify(errorDetails, null, 2),
      );

      // Get the last error message if available
      const errorMsg =
        lastError || "Unknown error occurred during file processing";

      const errorMessage =
        processedFiles.length === 0
          ? `Failed to process any files. Please check file formats and try again. Files: ${fileNames}`
          : `Failed to process any files. ${processedFiles.length} file(s) attempted but none were indexed. Error: ${errorMsg}. Files: ${fileNames}. Check server console for detailed error messages.`;

      logger.error(`[Knowledge API] Returning error response:`, {
        errorMessage,
        errorDetails,
      });

      return NextResponse.json(
        {
          error: errorMessage,
          details: errorDetails,
          lastError: errorMsg, // Include the actual error message
        },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,
      knowledgeBaseId,
      name,
      description,
      files: processedFiles,
      totalChunks: processedFiles.reduce((sum, f) => sum + f.chunks, 0),
      totalIndexed: processedFiles.reduce((sum, f) => sum + f.indexed, 0),
    });
  } catch (error: any) {
    logger.error("[Knowledge API] Failed to create knowledge base:", error);
    return NextResponse.json(
      { error: error.message || "Failed to create knowledge base" },
      { status: 500 },
    );
  }
}
