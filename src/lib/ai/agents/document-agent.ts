/**
 * Document Agent - Gamma-Quality Document Generation
 *
 * Enhanced document generation with professional Gamma-style templates,
 * slide transitions, conditional formatting, and stunning visual design.
 * Uses JavaScript libraries (PptxGenJS, docx, ExcelJS) for better
 * compatibility and richer features.
 */

import { type UIMessageStreamWriter, tool } from "ai";
import {
  chunkTextWithMetadata,
  estimateTokens,
} from "lib/vector-search/text-chunking";
import {
  indexContent,
  semanticSearch,
} from "lib/vector-search/vector-search-service";
import logger from "logger";
import { z } from "zod";
import { E2BSandboxService } from "../sandbox/e2b-service";
import {
  generateEditorConfig,
  isCollaboraConfigured,
  isCollaboraSupported,
  getMimeTypeFromExtension,
} from "lib/collabora";
import { threadSandboxContextRepository } from "lib/db/repository";
import { serverFileStorage } from "lib/file-storage";
import {
  type ChartConfig,
  type ColorPalette,
  type ColumnConfig,
  type ConditionalFormatRule,
  type DocumentChange,
  type DocumentOptions,
  type FormulaConfig,
  type PDFOptions,
  type PresentationChange,
  type SheetConfig,
  type SlideLayoutType,
  type SlideTransition,
  type SpreadsheetChange,
  type SpreadsheetOptions,
  type DocumentSection as TemplateDocumentSection,
  type PDFSection as TemplatePDFSection,
  type SlideContent as TemplateSlideContent,
  type WorkbookOptions,
  generateDocumentEditCode,
  generateDocumentTemplate,
  generateMultiSheetWorkbook,
  // PDF templates
  generatePDFTemplate,
  generatePresentationEditCode,
  generatePresentationTemplate,
  // Edit templates for surgical document editing
  generateSpreadsheetEditCode,
  generateSpreadsheetTemplate,
  getPalette,
  getPaletteNames,
} from "./document-templates";

// Document types supported
export type DocType = "presentation" | "document" | "spreadsheet" | "pdf";

// Presentation options for Gamma-style generation
export interface PresentationOptions {
  paletteName?: string;
  transition?: SlideTransition;
  author?: string;
}

// Slide content interface (enhanced)
export interface SlideContent {
  type: SlideLayoutType;
  title?: string;
  subtitle?: string;
  content?: string | string[];
  leftContent?: string | string[];
  rightContent?: string | string[];
  quote?: string;
  author?: string;
  number?: string | number;
  label?: string;
  items?: Array<{
    title?: string;
    description?: string;
    value?: string | number;
  }>;
  notes?: string;
}

// Document section interface (enhanced)
export interface DocumentSection {
  type:
    | "heading1"
    | "heading2"
    | "heading3"
    | "paragraph"
    | "bullet-list"
    | "numbered-list"
    | "table"
    | "quote"
    | "code"
    | "page-break";
  content?: string;
  items?: string[];
  tableData?: {
    headers: string[];
    rows: string[][];
  };
}

// Spreadsheet sheet interface (enhanced)
export interface SpreadsheetSheet {
  name: string;
  columns: ColumnConfig[];
  data: Record<string, unknown>[];
  conditionalFormatting?: ConditionalFormatRule[];
  charts?: ChartConfig[];
  freezePane?: { row?: number; col?: number };
  autoFilter?: boolean;
}

// PDF section interface
export interface PDFSection {
  type:
    | "cover"
    | "heading1"
    | "heading2"
    | "heading3"
    | "paragraph"
    | "bullet-list"
    | "numbered-list"
    | "table"
    | "image"
    | "image-text"
    | "quote"
    | "code"
    | "callout"
    | "divider"
    | "two-column"
    | "three-column"
    | "stats"
    | "timeline"
    | "page-break";
  content?: string;
  items?: string[];
  tableData?: {
    headers: string[];
    rows: string[][];
  };
  imageUrl?: string;
  imageCaption?: string;
  imageWidth?: string;
  imageHeight?: string;
  imagePosition?: "left" | "center" | "right" | "inline";
  calloutType?: "info" | "warning" | "success" | "error";
  leftContent?: string | string[];
  rightContent?: string | string[];
  centerContent?: string | string[];
  stats?: Array<{
    value: string | number;
    label: string;
    icon?: string;
  }>;
  timelineItems?: Array<{
    date: string;
    title: string;
    description?: string;
  }>;
}

// Document style options (legacy compatibility)
export interface DocStyle {
  primaryColor?: string;
  secondaryColor?: string;
  fontFamily?: string;
  fontSize?: number;
  headerStyle?: "modern" | "classic" | "minimal";
  paletteName?: string;
}

// Document result interface
export interface DocumentResult {
  success: boolean;
  documentType: DocType;
  title: string;
  fileUrl?: string;
  fileBase64?: string;
  fileName: string;
  pageCount?: number;
  error?: string;
  palette?: string;
  /** Similar documents found via RAG - can be used for context or shown to users */
  similarDocuments?: Array<{
    content: string;
    score: number;
    title?: string;
    documentType?: string;
  }>;
}

/**
 * Document Agent class for generating Gamma-quality documents
 */
export class DocumentAgent {
  private dataStream?: UIMessageStreamWriter;
  private threadId?: string;
  private userId?: string;

  constructor(
    dataStream?: UIMessageStreamWriter,
    threadId?: string,
    userId?: string,
  ) {
    this.dataStream = dataStream;
    this.threadId = threadId;
    this.userId = userId;
  }

  /**
   * Emit progress events to the UI
   */
  private emitProgress(stage: string, details: string): void {
    if (this.dataStream) {
      this.dataStream.write({
        type: "data-document-progress",
        data: {
          stage,
          details,
          timestamp: Date.now(),
        },
      });
    }
  }

  /**
   * Search for similar documents to get context and suggestions
   */
  private async searchSimilarDocuments(
    query: string,
    documentType?: "word" | "excel" | "presentation" | "pdf",
    limit: number = 5,
  ): Promise<
    Array<{ content: string; score: number; metadata: Record<string, unknown> }>
  > {
    if (!this.userId) {
      return [];
    }

    try {
      const results = await semanticSearch(query, "documents", {
        limit,
        scoreThreshold: 0.7,
        filters: {
          userId: this.userId,
          documentType,
        },
      });

      return results.map((result) => ({
        content: (result.payload.content as string) || "",
        score: result.score,
        metadata: result.payload,
      }));
    } catch (error) {
      logger.warn("Failed to search similar documents:", error);
      return [];
    }
  }

  /**
   * Generate JavaScript code for creating a Gamma-style presentation
   */
  generatePresentationCode(
    title: string,
    slides: SlideContent[],
    options: PresentationOptions = {},
  ): string {
    const { paletteName = "gamma-dark", transition = "fade", author } = options;

    // Convert slides to template format
    const templateSlides: TemplateSlideContent[] = slides.map((slide) => ({
      type: slide.type,
      title: slide.title,
      subtitle: slide.subtitle,
      content: slide.content,
      leftContent: slide.leftContent,
      rightContent: slide.rightContent,
      quote: slide.quote,
      author: slide.author,
      number: slide.number,
      label: slide.label,
      items: slide.items,
    }));

    return generatePresentationTemplate(templateSlides, {
      paletteName,
      transition,
      title,
      author: author || "Shadower AI",
    });
  }

  /**
   * Generate JavaScript code for creating a professional Word document
   */
  generateDocumentCode(
    _title: string,
    sections: DocumentSection[],
    options: DocumentOptions,
  ): string {
    // Convert sections to template format
    const templateSections: TemplateDocumentSection[] = sections.map(
      (section) => ({
        type: section.type as any,
        content: section.content,
        items: section.items,
        tableData: section.tableData,
      }),
    );

    return generateDocumentTemplate(templateSections, options);
  }

  /**
   * Generate JavaScript code for creating an Excel spreadsheet
   */
  generateSpreadsheetCode(
    title: string,
    sheets: SpreadsheetSheet[],
    options: SpreadsheetOptions,
  ): string {
    // Use the first sheet for now (can be extended)
    const sheet = sheets[0];
    return generateSpreadsheetTemplate(sheet.columns, sheet.data, {
      ...options,
      title,
      sheetName: sheet.name,
      conditionalFormatting: sheet.conditionalFormatting,
      charts: sheet.charts,
      freezePane: sheet.freezePane,
      autoFilter: sheet.autoFilter,
    });
  }

  /**
   * Generate JavaScript code for creating a multi-sheet Excel workbook
   */
  generateMultiSheetWorkbookCode(
    title: string,
    sheets: Array<{
      name: string;
      columns: ColumnConfig[];
      data: Record<string, unknown>[];
      formulas?: FormulaConfig[];
      freezePane?: { row?: number; col?: number };
      autoFilter?: boolean;
      paletteName?: string;
    }>,
    paletteName?: string,
  ): string {
    // Convert to SheetConfig format
    const sheetConfigs: SheetConfig[] = sheets.map((sheet) => ({
      name: sheet.name,
      columns: sheet.columns,
      data: sheet.data,
      formulas: sheet.formulas,
      options: {
        freezePane: sheet.freezePane,
        autoFilter: sheet.autoFilter,
        paletteName: sheet.paletteName,
      },
    }));

    const workbookOptions: WorkbookOptions = {
      title,
      sheets: sheetConfigs,
      paletteName,
    };

    return generateMultiSheetWorkbook(workbookOptions);
  }

  /**
   * Generate JavaScript code for creating a professional PDF document
   */
  generatePDFCode(
    _title: string,
    sections: PDFSection[],
    options: PDFOptions,
  ): string {
    // Convert sections to template format
    const templateSections: TemplatePDFSection[] = sections.map((section) => ({
      type: section.type as any,
      content: section.content,
      items: section.items,
      tableData: section.tableData,
      imageUrl: section.imageUrl,
      imageCaption: section.imageCaption,
      imageWidth: section.imageWidth,
      imageHeight: section.imageHeight,
      imagePosition: section.imagePosition,
      calloutType: section.calloutType,
      leftContent: section.leftContent,
      rightContent: section.rightContent,
      centerContent: section.centerContent,
      stats: section.stats,
      timelineItems: section.timelineItems,
    }));

    return generatePDFTemplate(templateSections, options);
  }

  /**
   * Auto-open document in Collabora editor if configured and supported
   */
  private async autoOpenInCollabora(
    fileName: string,
    fileUrl?: string,
    fileBase64?: string,
    documentType: "presentation" | "document" | "spreadsheet" = "document",
  ): Promise<void> {
    if (!this.dataStream || !this.threadId || !this.userId) {
      return;
    }

    // Check if Collabora is configured
    if (!isCollaboraConfigured()) {
      logger.debug(
        "[DocumentAgent] Collabora not configured, skipping auto-open",
      );
      return;
    }

    // Check if file type is supported
    const mimeType = getMimeTypeFromExtension(fileName);
    if (!isCollaboraSupported(mimeType)) {
      logger.debug(
        `[DocumentAgent] File type ${mimeType} not supported by Collabora`,
      );
      return;
    }

    try {
      // Upload file to storage if we have base64 but no URL
      let storageKey: string;
      let finalFileUrl: string;

      if (fileUrl) {
        // File already uploaded, extract storage key from URL or use URL as fileId
        finalFileUrl = fileUrl;
        // Try to get storage key from thread context
        const context = await threadSandboxContextRepository.getByThreadId(
          this.threadId,
        );
        const fileMetadata = context?.fileMetadata?.find(
          (f) => f.url === fileUrl || f.name === fileName,
        );
        storageKey = fileMetadata?.storageKey || fileUrl;
      } else if (fileBase64) {
        // Upload file to storage
        const buffer = Buffer.from(fileBase64, "base64");
        storageKey = `thread-documents/${this.threadId}/${fileName}`;
        const uploadResult = await serverFileStorage.upload(buffer, {
          filename: storageKey,
          contentType: mimeType,
        });
        finalFileUrl = uploadResult.sourceUrl;

        // Add to thread context
        await threadSandboxContextRepository.addFile(this.threadId, {
          name: fileName,
          size: buffer.length,
          type: mimeType,
          source: "generated",
          storageKey,
          url: finalFileUrl,
          uploadedAt: new Date().toISOString(),
        });
      } else {
        logger.warn(
          "[DocumentAgent] No file URL or base64 data for Collabora auto-open",
        );
        return;
      }

      // Generate Collabora editor URL
      const editorConfig = await generateEditorConfig(
        storageKey,
        fileName,
        mimeType,
        this.userId,
        this.threadId,
        true, // canWrite
      );

      // Emit collabora-open event
      this.dataStream.write({
        type: "collabora-open",
        data: {
          editorUrl: editorConfig.collaboraUrl,
          fileUrl: finalFileUrl,
          fileName,
          documentType,
        },
      });

      logger.info(
        `[DocumentAgent] Auto-opened ${fileName} in Collabora editor`,
      );
    } catch (error) {
      logger.error("[DocumentAgent] Failed to auto-open in Collabora:", error);
      // Don't throw - document creation succeeded, Collabora is optional
    }
  }

  /**
   * Execute code in E2B sandbox and handle result
   */
  private async executeCode(
    code: string,
    language: "javascript" | "python",
    fileName: string,
  ): Promise<{
    success: boolean;
    fileUrl?: string;
    fileBase64?: string;
    fileName?: string;
    error?: string;
  }> {
    try {
      const sandbox = E2BSandboxService.getInstance();

      const logs: any[] = [];
      let artifacts: any[] = [];
      let executionError: string | undefined;

      const onEvent = (event: any) => {
        if (event.type === "log") {
          logs.push(event.value);
        } else if (event.type === "artifacts") {
          artifacts = event.value;
        } else if (event.type === "finish" && event.value?.error) {
          executionError = event.value.error;
        }
      };

      if (this.threadId && this.userId) {
        await sandbox.runCodeWithContext(
          code,
          language,
          this.threadId,
          this.userId,
          onEvent,
        );
      } else {
        await sandbox.runCodeWithCallback(code, language, onEvent);
      }

      if (executionError) {
        return { success: false, error: executionError };
      }

      // Find the file in artifacts
      const fileExtension = fileName.split(".").pop();
      const outputFile = artifacts.find(
        (a: any) =>
          a.filename?.endsWith(`.${fileExtension}`) || a.filename === fileName,
      );

      if (outputFile) {
        return {
          success: true,
          fileName: outputFile.filename || fileName,
          fileUrl: outputFile.url,
          fileBase64: outputFile.base64,
        };
      }

      // Check if result is in stdout (for JavaScript with console.log)
      const stdout = logs
        .filter(
          (l) =>
            (l.type === "data" && l.args?.[0]?.value) ||
            (typeof l === "string" && l.includes("saved to")),
        )
        .map((l) => (typeof l === "string" ? l : l.args?.[0]?.value || ""))
        .join("\n");

      if (stdout.includes("saved to")) {
        return {
          success: true,
          fileName,
        };
      }

      // If no artifacts found but no error, still return success
      return {
        success: true,
        fileName,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || "Failed to execute code",
      };
    }
  }

  /**
   * Create a Gamma-style presentation
   */
  async createPresentation(
    title: string,
    slides: SlideContent[],
    options: PresentationOptions = {},
  ): Promise<DocumentResult> {
    const paletteName = options.paletteName || "gamma-dark";
    this.emitProgress(
      "creating",
      `Creating Gamma-style presentation: ${title} (${paletteName} theme)`,
    );

    // Generate code
    const code = this.generatePresentationCode(title, slides, options);
    const fileName = `${title.toLowerCase().replaceAll(/\s+/g, "-")}.pptx`;

    this.emitProgress("executing", `Generating presentation with PptxGenJS...`);

    const result = await this.executeCode(code, "javascript", fileName);

    if (!result.success) {
      this.emitProgress(
        "error",
        `Failed to create presentation: ${result.error}`,
      );
      return {
        success: false,
        documentType: "presentation",
        title,
        fileName,
        error: result.error,
        palette: paletteName,
      };
    }

    this.emitProgress(
      "complete",
      `Presentation created successfully: ${fileName}`,
    );

    // Index the created presentation for future RAG retrieval (non-blocking)
    if (this.userId) {
      const presentationContent = slides
        .map((slide, idx) => {
          const parts = [`Slide ${idx + 1}: ${slide.title || "Untitled"}`];
          if (slide.subtitle) parts.push(`Subtitle: ${slide.subtitle}`);
          if (slide.content) {
            const content = Array.isArray(slide.content)
              ? slide.content.join(", ")
              : slide.content;
            parts.push(`Content: ${content}`);
          }
          return parts.join("\n");
        })
        .join("\n\n");

      const fullContent = `${title}\n\n${presentationContent}`;
      const documentId = `presentation-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      const basePayload = {
        userId: this.userId,
        threadId: this.threadId,
        documentType: "presentation",
        title,
        fileName: result.fileName || fileName,
        slideCount: slides.length,
        palette: paletteName,
        createdAt: new Date().toISOString(),
      };

      // Use chunking for long presentations (> 500 tokens)
      const tokenCount = estimateTokens(fullContent);
      if (tokenCount > 500) {
        const chunks = chunkTextWithMetadata(fullContent, {
          documentId,
          maxTokens: 500,
          overlap: 50,
          metadata: basePayload,
        });
        indexContent("documents", chunks, { userId: this.userId }).catch(
          (error) => {
            logger.warn("Failed to index presentation for RAG:", error);
          },
        );
      } else {
        indexContent(
          "documents",
          [
            {
              id: documentId,
              content: fullContent,
              payload: basePayload,
            },
          ],
          { userId: this.userId },
        ).catch((error) => {
          logger.warn("Failed to index presentation for RAG:", error);
        });
      }
    }

    const documentResult = {
      success: true,
      documentType: "presentation",
      title,
      fileName: result.fileName || fileName,
      fileUrl: result.fileUrl,
      fileBase64: result.fileBase64,
      pageCount: slides.length,
      palette: paletteName,
    };

    // Auto-open in Collabora if configured and supported
    await this.autoOpenInCollabora(
      documentResult.fileName || fileName,
      result.fileUrl,
      result.fileBase64,
      "presentation",
    );

    return documentResult;
  }

  /**
   * Create a professional Word document
   */
  async createDocument(
    title: string,
    sections: DocumentSection[],
    options: Partial<DocumentOptions> = {},
  ): Promise<DocumentResult> {
    const fullOptions: DocumentOptions = {
      template: options.template || "report",
      title,
      subtitle: options.subtitle,
      author: options.author || "Shadower AI",
      company: options.company,
      date: options.date || new Date().toLocaleDateString(),
      includeToc: options.includeToc ?? true,
      includeCoverPage: options.includeCoverPage ?? true,
      includeHeaderFooter: options.includeHeaderFooter ?? true,
      paletteName: options.paletteName || "gamma-light",
    };

    this.emitProgress(
      "creating",
      `Creating professional document: ${title} (${fullOptions.template} template)`,
    );

    // Search for similar documents to get context for better generation
    let similarDocuments: Array<{
      content: string;
      score: number;
      metadata: Record<string, unknown>;
    }> = [];
    const searchQuery =
      `${title} ${sections.map((s) => s.content || "").join(" ")}`.trim();
    if (searchQuery.length > 10) {
      try {
        similarDocuments = await this.searchSimilarDocuments(
          searchQuery,
          "word",
          3,
        );
        if (similarDocuments.length > 0) {
          logger.debug(
            `Found ${similarDocuments.length} similar documents for context`,
          );
          // Emit progress with similar documents for UI display
          this.emitProgress(
            "context",
            `Found ${similarDocuments.length} similar documents for reference`,
          );
          // Log retrieved context for debugging
          similarDocuments.forEach((doc, idx) => {
            logger.debug(
              `Similar doc ${idx + 1} (score: ${doc.score.toFixed(2)}): ${doc.content.slice(0, 100)}...`,
            );
          });
        }
      } catch (error) {
        // Non-blocking - continue without context if search fails
        logger.warn("Failed to retrieve similar documents:", error);
      }
    }

    // Generate code
    const code = this.generateDocumentCode(title, sections, fullOptions);
    const fileName = `${title.toLowerCase().replace(/\s+/g, "-")}.docx`;

    this.emitProgress("executing", `Generating document with docx...`);

    const result = await this.executeCode(code, "javascript", fileName);

    if (!result.success) {
      this.emitProgress("error", `Failed to create document: ${result.error}`);
      return {
        success: false,
        documentType: "document",
        title,
        fileName,
        error: result.error,
        palette: fullOptions.paletteName,
      };
    }

    this.emitProgress("complete", `Document created successfully: ${fileName}`);

    // Index the created document for future RAG retrieval (non-blocking)
    if (this.userId) {
      const documentContent = sections
        .map((s) => s.content || s.items?.join(" ") || "")
        .filter(Boolean)
        .join("\n");

      const fullContent = `${title}\n\n${documentContent}`;
      const documentId = `doc-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      const basePayload = {
        userId: this.userId,
        threadId: this.threadId,
        documentType: "word",
        title,
        fileName: result.fileName || fileName,
        template: fullOptions.template,
        createdAt: new Date().toISOString(),
      };

      // Use chunking for long documents (> 500 tokens)
      const tokenCount = estimateTokens(fullContent);
      if (tokenCount > 500) {
        const chunks = chunkTextWithMetadata(fullContent, {
          documentId,
          maxTokens: 500,
          overlap: 50,
          metadata: basePayload,
        });
        indexContent("documents", chunks, { userId: this.userId }).catch(
          (error) => {
            logger.warn("Failed to index document for RAG:", error);
          },
        );
      } else {
        indexContent(
          "documents",
          [
            {
              id: documentId,
              content: fullContent,
              payload: basePayload,
            },
          ],
          { userId: this.userId },
        ).catch((error) => {
          logger.warn("Failed to index document for RAG:", error);
        });
      }
    }

    const documentResult = {
      success: true,
      documentType: "document" as const,
      title,
      fileName: result.fileName || fileName,
      fileUrl: result.fileUrl,
      fileBase64: result.fileBase64,
      pageCount: sections.length,
      palette: fullOptions.paletteName,
      // Include similar documents found via RAG for caller's use
      similarDocuments:
        similarDocuments.length > 0
          ? similarDocuments.map((doc) => ({
              content: doc.content.slice(0, 500), // Truncate for response size
              score: doc.score,
              title: doc.metadata.title as string | undefined,
              documentType: doc.metadata.documentType as string | undefined,
            }))
          : undefined,
    };

    // Auto-open in Collabora if configured and supported
    await this.autoOpenInCollabora(
      documentResult.fileName,
      result.fileUrl,
      result.fileBase64,
      "document",
    );

    return documentResult;
  }

  /**
   * Create an Excel spreadsheet with conditional formatting
   */
  async createSpreadsheet(
    title: string,
    sheets: SpreadsheetSheet[],
    options: Partial<SpreadsheetOptions> = {},
  ): Promise<DocumentResult> {
    const fullOptions: SpreadsheetOptions = {
      template: options.template || "data-table",
      title,
      paletteName: options.paletteName || "gamma-light",
    };

    this.emitProgress(
      "creating",
      `Creating professional spreadsheet: ${title} (${fullOptions.template} template)`,
    );

    // Generate code
    const code = this.generateSpreadsheetCode(title, sheets, fullOptions);
    const fileName = `${title.toLowerCase().replaceAll(/\s+/g, "-")}.xlsx`;

    this.emitProgress("executing", `Generating spreadsheet with ExcelJS...`);

    const result = await this.executeCode(code, "javascript", fileName);

    if (!result.success) {
      this.emitProgress(
        "error",
        `Failed to create spreadsheet: ${result.error}`,
      );
      return {
        success: false,
        documentType: "spreadsheet",
        title,
        fileName,
        error: result.error,
        palette: fullOptions.paletteName,
      };
    }

    this.emitProgress(
      "complete",
      `Spreadsheet created successfully: ${fileName}`,
    );

    // Index the created spreadsheet for future RAG retrieval (non-blocking)
    if (this.userId) {
      const spreadsheetContent = sheets
        .map((sheet) => {
          const headers = sheet.columns.map((c) => c.header).join(", ");
          const dataPreview = sheet.data
            .slice(0, 5)
            .map((row) => Object.values(row).join(", "))
            .join("\n");
          return `Sheet: ${sheet.name}\nColumns: ${headers}\nData preview:\n${dataPreview}`;
        })
        .join("\n\n");

      const fullContent = `${title}\n\n${spreadsheetContent}`;
      const documentId = `spreadsheet-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      const basePayload = {
        userId: this.userId,
        threadId: this.threadId,
        documentType: "excel",
        title,
        fileName: result.fileName || fileName,
        template: fullOptions.template,
        sheetCount: sheets.length,
        createdAt: new Date().toISOString(),
      };

      // Use chunking for large spreadsheets (> 500 tokens)
      const tokenCount = estimateTokens(fullContent);
      if (tokenCount > 500) {
        const chunks = chunkTextWithMetadata(fullContent, {
          documentId,
          maxTokens: 500,
          overlap: 50,
          metadata: basePayload,
        });
        indexContent("documents", chunks, { userId: this.userId }).catch(
          (error) => {
            logger.warn("Failed to index spreadsheet for RAG:", error);
          },
        );
      } else {
        indexContent(
          "documents",
          [
            {
              id: documentId,
              content: fullContent,
              payload: basePayload,
            },
          ],
          { userId: this.userId },
        ).catch((error) => {
          logger.warn("Failed to index spreadsheet for RAG:", error);
        });
      }
    }

    const spreadsheetResult = {
      success: true,
      documentType: "spreadsheet" as const,
      title,
      fileName: result.fileName || fileName,
      fileUrl: result.fileUrl,
      fileBase64: result.fileBase64,
      palette: fullOptions.paletteName,
    };

    // Auto-open in Collabora if configured and supported
    await this.autoOpenInCollabora(
      spreadsheetResult.fileName,
      result.fileUrl,
      result.fileBase64,
      "spreadsheet",
    );

    return spreadsheetResult;
  }

  /**
   * Create a multi-sheet Excel workbook with formulas
   */
  async createMultiSheetWorkbook(
    title: string,
    sheets: Array<{
      name: string;
      columns: ColumnConfig[];
      data: Record<string, unknown>[];
      formulas?: FormulaConfig[];
      freezePane?: { row?: number; col?: number };
      autoFilter?: boolean;
      paletteName?: string;
    }>,
    paletteName?: string,
  ): Promise<DocumentResult> {
    this.emitProgress(
      "creating",
      `Creating multi-sheet workbook: ${title} (${sheets.length} sheets)`,
    );

    // Generate code
    const code = this.generateMultiSheetWorkbookCode(
      title,
      sheets,
      paletteName,
    );
    // Replace all whitespace sequences with hyphens
    // SonarQube: regex pattern \s+ requires replace() instead of replaceAll()
    // NOSONAR: replaceAll() does not support regex patterns
    const fileName = `${title.toLowerCase().replace(/\s+/g, "-")}.xlsx`; // NOSONAR

    this.emitProgress(
      "executing",
      `Generating multi-sheet workbook with ExcelJS...`,
    );

    const result = await this.executeCode(code, "javascript", fileName);

    if (!result.success) {
      this.emitProgress("error", `Failed to create workbook: ${result.error}`);
      return {
        success: false,
        documentType: "spreadsheet",
        title,
        fileName,
        error: result.error,
        palette: paletteName,
      };
    }

    this.emitProgress(
      "complete",
      `Multi-sheet workbook created successfully: ${fileName}`,
    );

    // Index the created workbook for future RAG retrieval (non-blocking)
    if (this.userId) {
      const workbookContent = sheets
        .map((sheet) => {
          const headers = sheet.columns.map((c) => c.header).join(", ");
          const dataPreview = sheet.data
            .slice(0, 3)
            .map((row) => Object.values(row).join(", "))
            .join("\n");
          return `Sheet: ${sheet.name}\nColumns: ${headers}\nData preview:\n${dataPreview}`;
        })
        .join("\n\n");

      const fullContent = `${title}\n\n${workbookContent}`;
      const documentId = `workbook-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      const basePayload = {
        userId: this.userId,
        threadId: this.threadId,
        documentType: "excel",
        title,
        fileName: result.fileName || fileName,
        sheetCount: sheets.length,
        sheetNames: sheets.map((s) => s.name),
        palette: paletteName,
        createdAt: new Date().toISOString(),
      };

      // Use chunking for large workbooks (> 500 tokens)
      const tokenCount = estimateTokens(fullContent);
      if (tokenCount > 500) {
        const chunks = chunkTextWithMetadata(fullContent, {
          documentId,
          maxTokens: 500,
          overlap: 50,
          metadata: basePayload,
        });
        indexContent("documents", chunks, { userId: this.userId }).catch(
          (error) => {
            logger.warn("Failed to index workbook for RAG:", error);
          },
        );
      } else {
        indexContent(
          "documents",
          [
            {
              id: documentId,
              content: fullContent,
              payload: basePayload,
            },
          ],
          { userId: this.userId },
        ).catch((error) => {
          logger.warn("Failed to index workbook for RAG:", error);
        });
      }
    }

    return {
      success: true,
      documentType: "spreadsheet",
      title,
      fileName: result.fileName || fileName,
      fileUrl: result.fileUrl,
      fileBase64: result.fileBase64,
      palette: paletteName,
    };
  }

  /**
   * Create a professional PDF document using Puppeteer
   */
  async createPDF(
    title: string,
    sections: PDFSection[],
    options: Partial<PDFOptions> = {},
  ): Promise<DocumentResult> {
    const fullOptions: PDFOptions = {
      template: options.template || "report",
      title,
      subtitle: options.subtitle,
      author: options.author || "Shadower AI",
      company: options.company,
      date: options.date || new Date().toLocaleDateString(),
      logoUrl: options.logoUrl,
      paletteName: options.paletteName || "gamma-light",
      pageSize: options.pageSize || "A4",
      orientation: options.orientation || "portrait",
      margins: options.margins || {
        top: "1in",
        right: "0.75in",
        bottom: "1in",
        left: "0.75in",
      },
      headerHtml: options.headerHtml,
      footerHtml: options.footerHtml,
      includePageNumbers: options.includePageNumbers ?? true,
    };

    this.emitProgress(
      "creating",
      `Creating professional PDF: ${title} (${fullOptions.template} template)`,
    );

    // Generate code
    const code = this.generatePDFCode(title, sections, fullOptions);
    // Replace all whitespace sequences with hyphens
    // SonarQube: regex pattern \s+ requires replace() instead of replaceAll()
    // NOSONAR: replaceAll() does not support regex patterns
    const fileName = `${title.toLowerCase().replace(/\s+/g, "-")}.pdf`; // NOSONAR

    this.emitProgress("executing", `Generating PDF with Puppeteer...`);

    const result = await this.executeCode(code, "javascript", fileName);

    if (!result.success) {
      this.emitProgress("error", `Failed to create PDF: ${result.error}`);
      return {
        success: false,
        documentType: "pdf",
        title,
        fileName,
        error: result.error,
        palette: fullOptions.paletteName,
      };
    }

    this.emitProgress("complete", `PDF created successfully: ${fileName}`);

    // Index the created PDF for future RAG retrieval (non-blocking)
    if (this.userId) {
      const pdfContent = sections
        .map((s) => s.content || s.items?.join(" ") || "")
        .filter(Boolean)
        .join("\n");

      const fullContent = `${title}\n\n${pdfContent}`;
      const documentId = `pdf-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      const basePayload = {
        userId: this.userId,
        threadId: this.threadId,
        documentType: "pdf",
        title,
        fileName: result.fileName || fileName,
        template: fullOptions.template,
        pageSize: fullOptions.pageSize,
        createdAt: new Date().toISOString(),
      };

      // Use chunking for long PDFs (> 500 tokens)
      const tokenCount = estimateTokens(fullContent);
      if (tokenCount > 500) {
        const chunks = chunkTextWithMetadata(fullContent, {
          documentId,
          maxTokens: 500,
          overlap: 50,
          metadata: basePayload,
        });
        indexContent("documents", chunks, { userId: this.userId }).catch(
          (error) => {
            logger.warn("Failed to index PDF for RAG:", error);
          },
        );
      } else {
        indexContent(
          "documents",
          [
            {
              id: documentId,
              content: fullContent,
              payload: basePayload,
            },
          ],
          { userId: this.userId },
        ).catch((error) => {
          logger.warn("Failed to index PDF for RAG:", error);
        });
      }
    }

    return {
      success: true,
      documentType: "pdf",
      title,
      fileName: result.fileName || fileName,
      fileUrl: result.fileUrl,
      fileBase64: result.fileBase64,
      pageCount: sections.length,
      palette: fullOptions.paletteName,
    };
  }

  /**
   * Get available color palettes
   */
  getAvailablePalettes(): string[] {
    return getPaletteNames();
  }

  /**
   * Get palette details
   */
  getPaletteDetails(name: string): ColorPalette {
    return getPalette(name);
  }

  // ============================================================================
  // EDIT METHODS - Surgical editing of existing documents
  // ============================================================================

  /**
   * Edit an existing Excel spreadsheet with surgical changes
   * Uses ExcelJS which supports full read/write operations
   */
  async editSpreadsheet(
    fileUrl: string,
    changes: SpreadsheetChange[],
    outputFileName?: string,
  ): Promise<DocumentResult> {
    this.emitProgress(
      "editing",
      `Downloading and editing spreadsheet (${changes.length} changes)...`,
    );

    const fileName = outputFileName || "edited-spreadsheet.xlsx";
    const code = generateSpreadsheetEditCode(fileUrl, changes, fileName);

    this.emitProgress("executing", `Applying changes with ExcelJS...`);

    const result = await this.executeCode(code, "javascript", fileName);

    if (!result.success) {
      this.emitProgress("error", `Failed to edit spreadsheet: ${result.error}`);
      return {
        success: false,
        documentType: "spreadsheet",
        title: fileName,
        fileName,
        error: result.error,
      };
    }

    this.emitProgress(
      "complete",
      `Spreadsheet edited successfully: ${fileName}`,
    );
    return {
      success: true,
      documentType: "spreadsheet",
      title: fileName,
      fileName: result.fileName || fileName,
      fileUrl: result.fileUrl,
      fileBase64: result.fileBase64,
    };
  }

  /**
   * Edit an existing PowerPoint presentation with surgical changes
   * Uses JSZip for parsing and PptxGenJS for recreation
   */
  async editPresentation(
    fileUrl: string,
    changes: PresentationChange[],
    outputFileName?: string,
    paletteName?: string,
  ): Promise<DocumentResult> {
    this.emitProgress(
      "editing",
      `Downloading and editing presentation (${changes.length} changes)...`,
    );

    const fileName = outputFileName || "edited-presentation.pptx";
    const code = generatePresentationEditCode(
      fileUrl,
      changes,
      fileName,
      paletteName,
    );

    this.emitProgress(
      "executing",
      `Parsing and recreating presentation with changes...`,
    );

    const result = await this.executeCode(code, "javascript", fileName);

    if (!result.success) {
      this.emitProgress(
        "error",
        `Failed to edit presentation: ${result.error}`,
      );
      return {
        success: false,
        documentType: "presentation",
        title: fileName,
        fileName,
        error: result.error,
        palette: paletteName,
      };
    }

    this.emitProgress(
      "complete",
      `Presentation edited successfully: ${fileName}`,
    );
    return {
      success: true,
      documentType: "presentation",
      title: fileName,
      fileName: result.fileName || fileName,
      fileUrl: result.fileUrl,
      fileBase64: result.fileBase64,
      palette: paletteName,
    };
  }

  /**
   * Edit an existing Word document with surgical changes
   * Uses mammoth.js for reading and docx library for recreation
   */
  async editDocument(
    fileUrl: string,
    changes: DocumentChange[],
    outputFileName?: string,
    paletteName?: string,
  ): Promise<DocumentResult> {
    this.emitProgress(
      "editing",
      `Downloading and editing document (${changes.length} changes)...`,
    );

    const fileName = outputFileName || "edited-document.docx";
    const code = generateDocumentEditCode(
      fileUrl,
      changes,
      fileName,
      paletteName,
    );

    this.emitProgress(
      "executing",
      `Parsing and recreating document with changes...`,
    );

    const result = await this.executeCode(code, "javascript", fileName);

    if (!result.success) {
      this.emitProgress("error", `Failed to edit document: ${result.error}`);
      return {
        success: false,
        documentType: "document",
        title: fileName,
        fileName,
        error: result.error,
        palette: paletteName,
      };
    }

    this.emitProgress("complete", `Document edited successfully: ${fileName}`);
    return {
      success: true,
      documentType: "document",
      title: fileName,
      fileName: result.fileName || fileName,
      fileUrl: result.fileUrl,
      fileBase64: result.fileBase64,
      palette: paletteName,
    };
  }
}

// ============================================================================
// Tool Schemas
// ============================================================================

const slideContentSchema = z.object({
  type: z
    .enum([
      "title",
      "section",
      "content",
      "two-column",
      "three-column",
      "stats",
      "big-number",
      "quote",
      "timeline",
      "comparison",
      "image-left",
      "image-right",
      "image-full",
      "bullets",
      "numbered",
      "chart",
      "table",
      "blank",
    ])
    .describe("Slide layout type"),
  title: z.string().optional().describe("Slide title"),
  subtitle: z.string().optional().describe("Slide subtitle"),
  content: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .describe("Main content (string or array of bullet points)"),
  leftContent: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .describe("Left column content for two-column layouts"),
  rightContent: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .describe("Right column content for two-column layouts"),
  quote: z.string().optional().describe("Quote text for quote slides"),
  author: z.string().optional().describe("Quote author for quote slides"),
  number: z
    .union([z.string(), z.number()])
    .optional()
    .describe("Big number for stats slides"),
  label: z.string().optional().describe("Label for stats slides"),
  notes: z.string().optional().describe("Speaker notes"),
});

// Branding configuration schema for presentations
const brandingSchema = z.object({
  companyName: z.string().optional().describe("Company name for branding"),
  logoUrl: z.string().optional().describe("URL to company logo image"),
  logoPosition: z
    .enum(["top-left", "top-right", "bottom-left", "bottom-right"])
    .optional()
    .describe("Position of logo on slides"),
  logoSize: z
    .object({
      width: z.number().describe("Logo width in inches"),
      height: z.number().describe("Logo height in inches"),
    })
    .optional()
    .describe("Logo dimensions"),
  tagline: z.string().optional().describe("Company tagline"),
  website: z.string().optional().describe("Company website"),
  showSlideNumbers: z
    .boolean()
    .optional()
    .describe("Show slide numbers (default: true)"),
  footerText: z.string().optional().describe("Custom footer text"),
  showFooter: z.boolean().optional().describe("Show footer (default: true)"),
  showDate: z.boolean().optional().describe("Show date in footer"),
  customDateText: z.string().optional().describe("Custom date text"),
  watermark: z
    .object({
      text: z.string().describe("Watermark text"),
      opacity: z.number().min(0).max(1).describe("Watermark opacity (0-1)"),
      position: z
        .enum(["center", "bottom-right"])
        .describe("Watermark position"),
    })
    .optional()
    .describe("Watermark configuration"),
});

const presentationOptionsSchema = z.object({
  paletteName: z
    .string()
    .optional()
    .describe(
      "Color palette name (gamma-dark, gamma-light, vibrant-purple, corporate-blue, etc.)",
    ),
  transition: z
    .enum([
      "fade",
      "push",
      "wipe",
      "zoom",
      "cover",
      "pull",
      "random",
      "dissolve",
      "clock",
      "split",
      "none",
    ])
    .optional()
    .describe("Slide transition effect"),
  author: z.string().optional().describe("Presentation author"),
  branding: brandingSchema
    .optional()
    .describe("Branding configuration for consistent corporate identity"),
  useMasterSlides: z
    .boolean()
    .optional()
    .describe("Use master slides for consistent styling (default: true)"),
});

// Advanced table cell configuration
const tableCellConfigSchema = z.object({
  content: z.string().describe("Cell content"),
  colspan: z.number().optional().describe("Column span"),
  rowspan: z.number().optional().describe("Row span"),
  bold: z.boolean().optional().describe("Bold text"),
  italic: z.boolean().optional().describe("Italic text"),
  align: z
    .enum(["left", "center", "right"])
    .optional()
    .describe("Cell alignment"),
  bgColor: z.string().optional().describe("Background color (hex without #)"),
  textColor: z.string().optional().describe("Text color (hex without #)"),
});

// Advanced table data schema
const advancedTableSchema = z.object({
  headers: z
    .array(z.union([z.string(), tableCellConfigSchema]))
    .describe("Table headers (strings or cell configs)"),
  rows: z
    .array(z.array(z.union([z.string(), tableCellConfigSchema])))
    .describe("Table rows (strings or cell configs)"),
  style: z
    .enum(["default", "striped", "bordered", "minimal", "colored"])
    .optional()
    .describe("Table style"),
  headerStyle: z
    .enum(["primary", "dark", "light", "accent"])
    .optional()
    .describe("Header style"),
  columnWidths: z
    .array(z.number())
    .optional()
    .describe("Column widths as percentages"),
  caption: z.string().optional().describe("Table caption"),
  totalRow: z.boolean().optional().describe("Mark last row as totals row"),
});

const documentSectionSchema = z.object({
  type: z
    .enum([
      "heading1",
      "heading2",
      "heading3",
      "paragraph",
      "bullet-list",
      "numbered-list",
      "table",
      "image",
      "image-text",
      "quote",
      "code",
      "callout",
      "divider",
      "page-break",
    ])
    .describe("Section type"),
  content: z.string().optional().describe("Section content"),
  items: z.array(z.string()).optional().describe("List items"),
  tableData: z
    .object({
      headers: z.array(z.string()),
      rows: z.array(z.array(z.string())),
    })
    .optional()
    .describe("Simple table data"),
  advancedTable: advancedTableSchema
    .optional()
    .describe("Advanced table with merged cells, styling, and more options"),
  imageUrl: z.string().optional().describe("Image URL for image sections"),
  imageCaption: z.string().optional().describe("Image caption"),
  imageWidth: z.number().optional().describe("Image width in pixels"),
  imageHeight: z.number().optional().describe("Image height in pixels"),
  imagePosition: z
    .enum(["left", "center", "right", "inline"])
    .optional()
    .describe("Image position"),
  calloutType: z
    .enum(["info", "warning", "success", "error"])
    .optional()
    .describe("Callout type"),
});

const documentOptionsSchema = z.object({
  template: z
    .enum(["report", "proposal", "academic", "memo", "letter", "minimal"])
    .optional()
    .describe("Document template type"),
  subtitle: z.string().optional().describe("Document subtitle"),
  author: z.string().optional().describe("Document author"),
  company: z.string().optional().describe("Company name"),
  date: z.string().optional().describe("Document date"),
  includeToc: z.boolean().optional().describe("Include table of contents"),
  includeCoverPage: z.boolean().optional().describe("Include cover page"),
  includeHeaderFooter: z
    .boolean()
    .optional()
    .describe("Include header and footer"),
  paletteName: z.string().optional().describe("Color palette name"),
});

const columnConfigSchema = z.object({
  header: z.string().describe("Column header"),
  key: z.string().describe("Data key"),
  width: z.number().optional().describe("Column width"),
  style: z
    .object({
      numFmt: z.string().optional().describe("Number format"),
      alignment: z
        .enum(["left", "center", "right"])
        .optional()
        .describe("Alignment"),
    })
    .optional(),
});

const conditionalFormatRuleSchema = z.object({
  type: z
    .enum([
      "data-bar",
      "color-scale",
      "icon-set",
      "highlight-cells",
      "top-bottom",
    ])
    .describe("Conditional format type"),
  range: z.string().describe('Cell range (e.g., "B2:B10")'),
  options: z
    .object({
      color: z.string().optional(),
      minColor: z.string().optional(),
      midColor: z.string().optional(),
      maxColor: z.string().optional(),
      iconStyle: z.enum(["arrows", "flags", "ratings", "symbols"]).optional(),
      operator: z
        .enum(["greaterThan", "lessThan", "between", "equal"])
        .optional(),
      value: z.union([z.number(), z.string()]).optional(),
      topPercent: z.number().optional(),
    })
    .optional(),
});

const chartConfigSchema = z.object({
  type: z
    .enum(["bar", "column", "line", "area", "pie", "doughnut", "scatter"])
    .describe("Chart type"),
  title: z.string().describe("Chart title"),
  dataRange: z.string().describe("Data cell range"),
  labelsRange: z.string().describe("Labels cell range"),
  position: z.object({
    row: z.number().describe("Row position"),
    col: z.number().describe("Column position"),
  }),
  size: z
    .object({
      width: z.number().optional(),
      height: z.number().optional(),
    })
    .optional(),
});

const spreadsheetSheetSchema = z.object({
  name: z.string().describe("Sheet name"),
  columns: z.array(columnConfigSchema).describe("Column configurations"),
  data: z
    .array(z.record(z.string(), z.unknown()))
    .describe("Row data as array of objects"),
  conditionalFormatting: z
    .array(conditionalFormatRuleSchema)
    .optional()
    .describe("Conditional formatting rules"),
  charts: z.array(chartConfigSchema).optional().describe("Charts to add"),
  freezePane: z
    .object({
      row: z.number().optional(),
      col: z.number().optional(),
    })
    .optional()
    .describe("Freeze pane settings"),
  autoFilter: z.boolean().optional().describe("Enable auto filter"),
});

const spreadsheetOptionsSchema = z.object({
  template: z
    .enum(["dashboard", "data-table", "report", "budget", "tracker", "minimal"])
    .optional()
    .describe("Spreadsheet template type"),
  paletteName: z.string().optional().describe("Color palette name"),
});

// PDF tool schemas
const pdfSectionSchema = z.object({
  type: z
    .enum([
      "cover",
      "heading1",
      "heading2",
      "heading3",
      "paragraph",
      "bullet-list",
      "numbered-list",
      "table",
      "image",
      "image-text",
      "quote",
      "code",
      "callout",
      "divider",
      "two-column",
      "three-column",
      "stats",
      "timeline",
      "page-break",
    ])
    .describe("Section type"),
  content: z.string().optional().describe("Section content"),
  items: z.array(z.string()).optional().describe("List items"),
  tableData: z
    .object({
      headers: z.array(z.string()),
      rows: z.array(z.array(z.string())),
    })
    .optional()
    .describe("Table data"),
  imageUrl: z.string().optional().describe("Image URL"),
  imageCaption: z.string().optional().describe("Image caption"),
  imageWidth: z
    .string()
    .optional()
    .describe("Image width (CSS value, e.g., '300px', '50%')"),
  imageHeight: z.string().optional().describe("Image height (CSS value)"),
  imagePosition: z
    .enum(["left", "center", "right", "inline"])
    .optional()
    .describe("Image position"),
  calloutType: z
    .enum(["info", "warning", "success", "error"])
    .optional()
    .describe("Callout type"),
  leftContent: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .describe("Left column content"),
  rightContent: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .describe("Right column content"),
  centerContent: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .describe("Center column content"),
  stats: z
    .array(
      z.object({
        value: z.union([z.string(), z.number()]).describe("Stat value"),
        label: z.string().describe("Stat label"),
        icon: z.string().optional().describe("Optional icon/emoji"),
      }),
    )
    .optional()
    .describe("Statistics for stats section"),
  timelineItems: z
    .array(
      z.object({
        date: z.string().describe("Timeline date"),
        title: z.string().describe("Timeline item title"),
        description: z
          .string()
          .optional()
          .describe("Timeline item description"),
      }),
    )
    .optional()
    .describe("Timeline items"),
});

const pdfOptionsSchema = z.object({
  template: z
    .enum([
      "report",
      "invoice",
      "brochure",
      "certificate",
      "proposal",
      "resume",
      "letter",
      "minimal",
    ])
    .optional()
    .describe("PDF template type"),
  subtitle: z.string().optional().describe("Document subtitle"),
  author: z.string().optional().describe("Document author"),
  company: z.string().optional().describe("Company name"),
  date: z.string().optional().describe("Document date"),
  logoUrl: z.string().optional().describe("Company logo URL"),
  paletteName: z.string().optional().describe("Color palette name"),
  pageSize: z.enum(["A4", "Letter", "Legal"]).optional().describe("Page size"),
  orientation: z
    .enum(["portrait", "landscape"])
    .optional()
    .describe("Page orientation"),
  margins: z
    .object({
      top: z.string().optional(),
      right: z.string().optional(),
      bottom: z.string().optional(),
      left: z.string().optional(),
    })
    .optional()
    .describe("Page margins (CSS values)"),
  headerHtml: z.string().optional().describe("Custom header HTML"),
  footerHtml: z.string().optional().describe("Custom footer HTML"),
  includePageNumbers: z
    .boolean()
    .optional()
    .describe("Include page numbers in footer"),
});

// ============================================================================
// Edit Tool Schemas - For surgical editing of existing documents
// ============================================================================

const spreadsheetChangeSchema = z.object({
  type: z
    .enum([
      "updateCell",
      "updateCells",
      "addRow",
      "deleteRow",
      "insertRow",
      "updateColumn",
      "addColumn",
      "deleteColumn",
      "addSheet",
      "deleteSheet",
      "renameSheet",
      "updateStyle",
      "addChart",
      "addConditionalFormatting",
    ])
    .describe("Type of change to apply"),
  sheetName: z.string().optional().describe("Target sheet name"),
  cell: z
    .object({
      row: z.number().describe("Row number (1-based)"),
      col: z.number().describe("Column number (1-based)"),
    })
    .optional()
    .describe("Target cell for single cell operations"),
  cells: z
    .array(
      z.object({
        row: z.number(),
        col: z.number(),
        value: z.unknown(),
      }),
    )
    .optional()
    .describe("Multiple cells to update"),
  value: z.unknown().optional().describe("New value for the cell"),
  row: z
    .record(z.string(), z.unknown())
    .optional()
    .describe("Row data as object"),
  rowIndex: z.number().optional().describe("Row index for row operations"),
  columnKey: z.string().optional().describe("Column key for column operations"),
  columnConfig: columnConfigSchema.optional().describe("Column configuration"),
  newSheetName: z.string().optional().describe("New sheet name"),
  style: z
    .object({
      fill: z.string().optional(),
      font: z
        .object({
          bold: z.boolean().optional(),
          color: z.string().optional(),
          size: z.number().optional(),
        })
        .optional(),
      border: z.boolean().optional(),
      alignment: z.enum(["left", "center", "right"]).optional(),
    })
    .optional()
    .describe("Cell styling options"),
  range: z.string().optional().describe("Cell range for bulk operations"),
  chart: chartConfigSchema.optional().describe("Chart configuration"),
  conditionalFormat: conditionalFormatRuleSchema
    .optional()
    .describe("Conditional formatting rule"),
});

const presentationChangeSchema = z.object({
  type: z
    .enum([
      "updateSlide",
      "addSlide",
      "deleteSlide",
      "reorderSlides",
      "updateNotes",
      "updateTransition",
    ])
    .describe("Type of change to apply"),
  slideIndex: z.number().optional().describe("Target slide index (0-based)"),
  updates: z
    .object({
      title: z.string().optional(),
      subtitle: z.string().optional(),
      content: z.union([z.string(), z.array(z.string())]).optional(),
      notes: z.string().optional(),
      background: z.string().optional(),
    })
    .optional()
    .describe("Updates to apply to the slide"),
  newSlide: slideContentSchema.optional().describe("New slide to add"),
  newOrder: z
    .array(z.number())
    .optional()
    .describe("New order of slide indices"),
  transition: z
    .enum([
      "fade",
      "push",
      "wipe",
      "zoom",
      "cover",
      "pull",
      "random",
      "dissolve",
      "clock",
      "split",
      "none",
    ])
    .optional()
    .describe("Slide transition effect"),
});

const documentChangeSchema = z.object({
  type: z
    .enum([
      "updateSection",
      "addSection",
      "deleteSection",
      "replaceText",
      "updateStyle",
    ])
    .describe("Type of change to apply"),
  sectionIndex: z
    .number()
    .optional()
    .describe("Target section index (0-based)"),
  updates: z
    .object({
      content: z.string().optional(),
      items: z.array(z.string()).optional(),
    })
    .optional()
    .describe("Updates to apply to the section"),
  newSection: documentSectionSchema.optional().describe("New section to add"),
  insertAt: z.number().optional().describe("Position to insert new section"),
  searchText: z.string().optional().describe("Text to search for replacement"),
  replaceWith: z.string().optional().describe("Replacement text"),
  replaceAll: z
    .boolean()
    .optional()
    .describe("Replace all occurrences or just first"),
});

// ============================================================================
// Tool Functions
// ============================================================================

/**
 * Create Gamma-style Presentation Tool
 */
export function createPresentationTool(
  dataStream?: UIMessageStreamWriter,
  threadId?: string,
  userId?: string,
) {
  return tool({
    description: `Create a stunning Gamma-style PowerPoint presentation with professional templates, modern color palettes, master slides, and branding support.

Available color palettes:
- gamma-dark: Modern dark theme with vibrant purple accents (default)
- gamma-light: Clean light theme with professional purple accents
- vibrant-purple: Bold, energetic purple theme
- corporate-blue: Professional blue theme for business
- midnight-blue: Deep, sophisticated blue
- forest-green: Natural, calming green theme
- sunset-orange: Warm, energetic orange theme
- minimal-white: Ultra-clean white with subtle gray
- minimal-dark: Sleek dark theme with maximum contrast
- rose-pink: Elegant pink theme
- ocean-teal: Fresh, aquatic theme
- slate-professional: Sophisticated slate gray

Available slide layouts:
- title: Title slide with centered title and subtitle
- section: Section header slide
- content/bullets: Bullet point content slide
- two-column/comparison: Side-by-side comparison
- three-column: Three-column layout
- stats/big-number: Large statistic with label
- quote: Quote with author attribution
- image-left/image-right: Image with text
- image-full/image-grid: Full image slides
- timeline: Timeline visualization
- process: Step-by-step process flow
- team: Team member profiles
- dashboard: KPIs and mini-charts
- agenda: Meeting agenda
- thank-you/contact: Closing slides

Available transitions:
- fade, push, wipe, zoom, cover, pull, dissolve, clock, split, none

Branding options (in options.branding):
- companyName: Company name shown in footer
- logoUrl: URL to company logo (auto-embedded on all slides)
- logoPosition: top-left, top-right, bottom-left, bottom-right
- logoSize: { width, height } in inches
- tagline: Company tagline
- showSlideNumbers: true/false
- footerText: Custom footer text
- showDate: Show date in footer
- watermark: { text, opacity, position } for watermark

Master slides are automatically created for consistent branding across:
- MASTER_TITLE: Opening/title slides
- MASTER_CONTENT: Regular content slides
- MASTER_SECTION: Section dividers
- MASTER_DARK: High-impact slides
- MASTER_IMAGE: Image-focused slides
- MASTER_BLANK: Minimal branding`,
    inputSchema: z.object({
      title: z.string().describe("Presentation title"),
      slides: z.array(slideContentSchema).describe("Array of slides"),
      options: presentationOptionsSchema
        .optional()
        .describe("Presentation options including branding"),
    }),
    execute: async ({ title, slides, options }) => {
      const agent = new DocumentAgent(dataStream, threadId, userId);
      return agent.createPresentation(title, slides as SlideContent[], options);
    },
  });
}

/**
 * Create Professional Document Tool
 */
export function createDocumentTool(
  dataStream?: UIMessageStreamWriter,
  threadId?: string,
  userId?: string,
) {
  return tool({
    description: `Create a professional Word document with Table of Contents, cover page, headers/footers, images, and styled sections.

Available templates:
- report: Business report format
- proposal: Project proposal format
- academic: Academic paper format
- memo: Internal memo format
- letter: Business letter format
- minimal: Clean minimal format

Section types:
- heading1/heading2/heading3: Section headings
- paragraph: Text paragraphs
- bullet-list/numbered-list: Lists
- table: Data tables (simple or advanced)
- image: Standalone images
- image-text: Image with text side by side
- quote: Block quotes
- code: Code blocks
- callout: Info/warning/success/error callouts
- divider: Visual separator
- page-break: Force page break

Features:
- Automatic Table of Contents with hyperlinks
- Professional cover page with title and author
- Headers with document title
- Footers with page numbers
- Professional typography hierarchy
- Images with captions and positioning
- Quote callouts with accent borders

Advanced Table Features:
- Multiple styles: default, striped, bordered, minimal, colored
- Header styles: primary, dark, light, accent
- Merged cells (colspan, rowspan)
- Custom cell formatting (bold, italic, colors, alignment)
- Column width control
- Table captions
- Total rows with bold styling`,
    inputSchema: z.object({
      title: z.string().describe("Document title"),
      sections: z.array(documentSectionSchema).describe("Document sections"),
      options: documentOptionsSchema.optional().describe("Document options"),
    }),
    execute: async ({ title, sections, options }) => {
      const agent = new DocumentAgent(dataStream, threadId, userId);
      return agent.createDocument(
        title,
        sections as DocumentSection[],
        options,
      );
    },
  });
}

/**
 * Create Excel Spreadsheet Tool
 */
export function createSpreadsheetTool(
  dataStream?: UIMessageStreamWriter,
  threadId?: string,
  userId?: string,
) {
  return tool({
    description: `Create a professional Excel spreadsheet with conditional formatting, charts, and modern styling.

Available templates:
- dashboard: Executive dashboard with KPIs
- data-table: Clean data table format
- report: Styled report format
- budget: Budget tracking format
- tracker: Project tracker format
- minimal: Simple clean format

Features:
- Professional header styling with theme colors
- Alternating row colors
- Conditional formatting:
  - Data bars for visual comparison
  - Color scales (red-yellow-green)
  - Icon sets (arrows, flags, ratings)
  - Highlight cells (above/below thresholds)
- Charts (bar, line, pie, area, scatter)
- Freeze panes for navigation
- Auto-filters for data exploration`,
    inputSchema: z.object({
      title: z.string().describe("Spreadsheet title"),
      sheets: z.array(spreadsheetSheetSchema).describe("Sheet definitions"),
      options: spreadsheetOptionsSchema
        .optional()
        .describe("Spreadsheet options"),
    }),
    execute: async ({ title, sheets, options }) => {
      const agent = new DocumentAgent(dataStream, threadId, userId);
      return agent.createSpreadsheet(
        title,
        sheets as SpreadsheetSheet[],
        options,
      );
    },
  });
}

// Formula schema for multi-sheet workbooks
const formulaSchema = z.object({
  type: z
    .enum([
      "SUM",
      "AVERAGE",
      "COUNT",
      "MAX",
      "MIN",
      "IF",
      "VLOOKUP",
      "SUMIF",
      "COUNTIF",
      "CUSTOM",
    ])
    .describe("Formula type"),
  range: z
    .string()
    .optional()
    .describe("Cell range for the formula (e.g., B2:B10)"),
  resultCell: z
    .string()
    .describe("Cell where result will be placed (e.g., B11)"),
  label: z.string().optional().describe("Label for the formula cell"),
  customFormula: z
    .string()
    .optional()
    .describe("Custom Excel formula for CUSTOM type"),
  conditions: z
    .object({
      criteriaRange: z.string().optional(),
      criteria: z.union([z.string(), z.number()]).optional(),
      valueIfTrue: z.union([z.string(), z.number()]).optional(),
      valueIfFalse: z.union([z.string(), z.number()]).optional(),
      lookupValue: z.string().optional(),
      lookupRange: z.string().optional(),
      resultRange: z.string().optional(),
    })
    .optional()
    .describe("Conditions for IF, VLOOKUP, SUMIF, COUNTIF formulas"),
});

// Multi-sheet schema
const multiSheetSchema = z.object({
  name: z.string().describe("Sheet name"),
  columns: z.array(columnConfigSchema).describe("Column definitions"),
  data: z.array(z.record(z.string(), z.unknown())).describe("Row data"),
  formulas: z
    .array(formulaSchema)
    .optional()
    .describe("Formulas to add to the sheet"),
  freezePane: z
    .object({
      row: z.number().optional(),
      col: z.number().optional(),
    })
    .optional()
    .describe("Freeze pane settings"),
  autoFilter: z.boolean().optional().describe("Enable auto-filter"),
  paletteName: z.string().optional().describe("Color palette for this sheet"),
});

/**
 * Create Multi-Sheet Workbook Tool
 */
export function createMultiSheetWorkbookTool(
  dataStream?: UIMessageStreamWriter,
  threadId?: string,
  userId?: string,
) {
  return tool({
    description: `Create a multi-sheet Excel workbook with formulas, multiple data sheets, and professional styling.

This tool is ideal for:
- Financial reports with multiple tabs (Summary, Revenue, Expenses, etc.)
- Data analysis workbooks with raw data and calculated summaries
- Project management with separate sheets for different projects/teams
- Any scenario requiring related data across multiple sheets

Features:
- Multiple sheets in a single workbook
- Excel formulas: SUM, AVERAGE, COUNT, MAX, MIN, IF, VLOOKUP, SUMIF, COUNTIF
- Custom formulas for complex calculations
- Individual sheet styling with different color palettes
- Freeze panes and auto-filters per sheet
- Professional header styling
- Alternating row colors

Formula examples:
- SUM: Total up a column of numbers
- AVERAGE: Calculate average of a range
- IF: Conditional logic (e.g., "Pass" if score > 70)
- VLOOKUP: Look up values from another range
- SUMIF/COUNTIF: Conditional sum or count

Available palettes: gamma-light, gamma-dark, business-light, business-dark, nature-light, nature-dark, ocean-light, ocean-dark, sunset-light, sunset-dark, berry-light, berry-dark, monochrome`,
    inputSchema: z.object({
      title: z.string().describe("Workbook title"),
      sheets: z
        .array(multiSheetSchema)
        .describe("Sheet definitions with data and formulas"),
      paletteName: z
        .string()
        .optional()
        .describe("Default color palette for all sheets"),
    }),
    execute: async ({ title, sheets, paletteName }) => {
      const agent = new DocumentAgent(dataStream, threadId, userId);
      return agent.createMultiSheetWorkbook(title, sheets, paletteName);
    },
  });
}

/**
 * Create Professional PDF Tool
 */
export function createPDFTool(
  dataStream?: UIMessageStreamWriter,
  threadId?: string,
  userId?: string,
) {
  return tool({
    description: `Create a professional PDF document using Puppeteer with modern styling, images, and advanced layouts.

Available templates:
- report: Business report with cover page
- invoice: Professional invoice format
- brochure: Marketing brochure format
- certificate: Award/certificate format
- proposal: Project proposal format
- resume: Professional resume format
- letter: Business letter format
- minimal: Clean minimal format

Available section types:
- heading1/heading2/heading3: Section headings
- paragraph: Text paragraphs
- bullet-list/numbered-list: Lists
- table: Data tables with headers
- image: Standalone images
- image-text: Image with text side by side
- quote: Block quotes
- code: Code blocks
- callout: Info/warning/success/error callouts
- divider: Visual separator
- two-column/three-column: Multi-column layouts
- stats: Statistics display with values and labels
- timeline: Chronological timeline
- page-break: Force page break

Features:
- Professional cover pages with logo support
- Page numbers and custom headers/footers
- Images with captions
- Tables with alternating row colors
- Multiple color palettes
- A4, Letter, and Legal page sizes
- Portrait and landscape orientations`,
    inputSchema: z.object({
      title: z.string().describe("PDF title"),
      sections: z.array(pdfSectionSchema).describe("PDF sections"),
      options: pdfOptionsSchema.optional().describe("PDF options"),
    }),
    execute: async ({ title, sections, options }) => {
      const agent = new DocumentAgent(dataStream, threadId, userId);
      return agent.createPDF(title, sections as PDFSection[], options);
    },
  });
}

/**
 * List Available Palettes Tool
 */
export function createListPalettesTool() {
  return tool({
    description:
      "List all available color palettes for document generation with their descriptions",
    inputSchema: z.object({}),
    execute: async () => {
      const palettes = getPaletteNames();
      const details = palettes.map((name) => getPalette(name));
      return {
        success: true,
        palettes: details,
      };
    },
  });
}

// ============================================================================
// Edit Tool Functions - For surgical editing of existing documents
// ============================================================================

/**
 * Edit Spreadsheet Tool - Surgical editing of existing Excel files
 * Uses ExcelJS which has full read/write support
 */
export function createEditSpreadsheetTool(
  dataStream?: UIMessageStreamWriter,
  threadId?: string,
  userId?: string,
) {
  return tool({
    description: `Edit an existing Excel spreadsheet with surgical precision. Downloads the file, applies changes, and uploads the modified version.

This tool uses ExcelJS which supports TRUE surgical editing - it reads the existing file, modifies only the specified parts, and saves the result.

Supported change types:
- updateCell: Update a single cell value
- updateCells: Update multiple cells at once
- addRow: Add a new row at the end
- insertRow: Insert a row at a specific position
- deleteRow: Delete a row
- updateColumn: Update column configuration
- addColumn: Add a new column
- deleteColumn: Delete a column
- addSheet: Add a new worksheet
- deleteSheet: Delete a worksheet
- renameSheet: Rename a worksheet
- updateStyle: Update cell/range styling
- addChart: Add a chart to the spreadsheet
- addConditionalFormatting: Add conditional formatting rules

Example: To update cell B3 to "New Value":
{
  fileUrl: "https://storage.example.com/file.xlsx",
  changes: [{ type: "updateCell", cell: { row: 3, col: 2 }, value: "New Value" }]
}`,
    inputSchema: z.object({
      fileUrl: z
        .string()
        .url()
        .describe("URL of the existing XLSX file to edit"),
      changes: z
        .array(spreadsheetChangeSchema)
        .describe("Array of changes to apply"),
      outputFileName: z
        .string()
        .optional()
        .describe("Output file name (default: edited-spreadsheet.xlsx)"),
    }),
    execute: async ({ fileUrl, changes, outputFileName }) => {
      const agent = new DocumentAgent(dataStream, threadId, userId);
      return agent.editSpreadsheet(
        fileUrl,
        changes as SpreadsheetChange[],
        outputFileName,
      );
    },
  });
}

/**
 * Edit Presentation Tool - Editing of existing PowerPoint files
 * Uses JSZip for parsing and PptxGenJS for recreation
 */
export function createEditPresentationTool(
  dataStream?: UIMessageStreamWriter,
  threadId?: string,
  userId?: string,
) {
  return tool({
    description: `Edit an existing PowerPoint presentation. Downloads the file, parses it, applies changes, and recreates the presentation.

Note: Due to library limitations, PPTX editing works by parsing the existing content and recreating the presentation with modifications. Complex formatting may be simplified.

Supported change types:
- updateSlide: Update slide content (title, subtitle, content, notes)
- addSlide: Add a new slide at a specific position
- deleteSlide: Delete a slide by index
- reorderSlides: Reorder slides with a new index array
- updateNotes: Update speaker notes for a slide
- updateTransition: Change slide transition effect

Example: To update slide 2's title:
{
  fileUrl: "https://storage.example.com/presentation.pptx",
  changes: [{ type: "updateSlide", slideIndex: 1, updates: { title: "New Title" } }]
}`,
    inputSchema: z.object({
      fileUrl: z
        .string()
        .url()
        .describe("URL of the existing PPTX file to edit"),
      changes: z
        .array(presentationChangeSchema)
        .describe("Array of changes to apply"),
      outputFileName: z
        .string()
        .optional()
        .describe("Output file name (default: edited-presentation.pptx)"),
      paletteName: z
        .string()
        .optional()
        .describe("Color palette to use for recreated slides"),
    }),
    execute: async ({ fileUrl, changes, outputFileName, paletteName }) => {
      const agent = new DocumentAgent(dataStream, threadId, userId);
      return agent.editPresentation(
        fileUrl,
        changes as PresentationChange[],
        outputFileName,
        paletteName,
      );
    },
  });
}

/**
 * Edit Document Tool - Editing of existing Word documents
 * Uses mammoth.js for reading and docx library for recreation
 */
export function createEditDocumentTool(
  dataStream?: UIMessageStreamWriter,
  threadId?: string,
  userId?: string,
) {
  return tool({
    description: `Edit an existing Word document. Downloads the file, parses it, applies changes, and recreates the document.

Note: Due to library limitations, DOCX editing works by parsing the content and recreating the document with modifications. Complex formatting may be simplified.

Supported change types:
- updateSection: Update a section's content
- addSection: Add a new section at a specific position
- deleteSection: Delete a section by index
- replaceText: Find and replace text throughout the document
- updateStyle: Update section styling

Example: To replace all occurrences of "old text" with "new text":
{
  fileUrl: "https://storage.example.com/document.docx",
  changes: [{ type: "replaceText", searchText: "old text", replaceWith: "new text", replaceAll: true }]
}`,
    inputSchema: z.object({
      fileUrl: z
        .string()
        .url()
        .describe("URL of the existing DOCX file to edit"),
      changes: z
        .array(documentChangeSchema)
        .describe("Array of changes to apply"),
      outputFileName: z
        .string()
        .optional()
        .describe("Output file name (default: edited-document.docx)"),
      paletteName: z
        .string()
        .optional()
        .describe("Color palette to use for styling"),
    }),
    execute: async ({ fileUrl, changes, outputFileName, paletteName }) => {
      const agent = new DocumentAgent(dataStream, threadId, userId);
      return agent.editDocument(
        fileUrl,
        changes as DocumentChange[],
        outputFileName,
        paletteName,
      );
    },
  });
}

/**
 * Get all document tools for registration
 */
export function createDocumentTools(
  dataStream?: UIMessageStreamWriter,
  threadId?: string,
  userId?: string,
) {
  return {
    create_presentation: createPresentationTool(dataStream, threadId, userId),
    create_document: createDocumentTool(dataStream, threadId, userId),
    create_spreadsheet: createSpreadsheetTool(dataStream, threadId, userId),
    create_multi_sheet_workbook: createMultiSheetWorkbookTool(
      dataStream,
      threadId,
      userId,
    ),
    create_pdf: createPDFTool(dataStream, threadId, userId),
    list_document_palettes: createListPalettesTool(),
    // Edit tools for surgical document editing
    edit_spreadsheet: createEditSpreadsheetTool(dataStream, threadId, userId),
    edit_presentation: createEditPresentationTool(dataStream, threadId, userId),
    edit_document: createEditDocumentTool(dataStream, threadId, userId),
  };
}
