/**
 * Office File Converter Utility
 *
 * Provides client-side conversion of Office files (DOCX, XLSX) to HTML
 * for preview in the browser. Handles both URL and base64 data formats.
 *
 * Features:
 * - DOCX to HTML conversion using mammoth.js
 * - XLSX to HTML conversion using SheetJS
 * - Robust error handling and fallbacks
 * - Memory-efficient processing
 * - Type-safe implementation
 */

import * as JSZipModule from "jszip";
import mammoth from "mammoth";

// Handle both ESM and CJS module formats
const JSZip = (JSZipModule as any).default || JSZipModule;

export type OfficeFileType = "docx" | "xlsx" | "pptx";

export interface ConversionResult {
  html: string;
  success: boolean;
  error?: string;
}

export interface SlideImage {
  slideNumber: number;
  imageUrl: string;
  mimeType: string;
}

export interface PptxConversionResult extends ConversionResult {
  slideImages?: SlideImage[];
  slideCount?: number;
}

export interface ConversionOptions {
  /** Maximum file size in bytes (default: 50MB) */
  maxSize?: number;
  /** Timeout in milliseconds (default: 30000) */
  timeout?: number;
}

const DEFAULT_OPTIONS: Required<ConversionOptions> = {
  maxSize: 50 * 1024 * 1024, // 50MB
  timeout: 30000, // 30 seconds
};

/**
 * Converts content (URL or base64) to ArrayBuffer
 * Handles multiple input formats safely
 */
async function contentToArrayBuffer(
  content: string,
  options: Required<ConversionOptions>,
): Promise<ArrayBuffer> {
  // Handle data URLs (data:mime/type;base64,...)
  if (content.startsWith("data:")) {
    const base64Match = /^data:[^;]+;base64,(.+)$/.exec(content);
    if (base64Match) {
      const base64Data = base64Match[1];
      return base64ToArrayBuffer(base64Data);
    }
    throw new Error("Invalid data URL format");
  }

  // Handle blob URLs
  if (content.startsWith("blob:")) {
    const response = await fetch(content);
    if (!response.ok) {
      throw new Error(`Failed to fetch blob URL: ${response.statusText}`);
    }
    return await response.arrayBuffer();
  }

  // Handle HTTP/HTTPS URLs
  if (content.startsWith("http://") || content.startsWith("https://")) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), options.timeout);

    try {
      // In desktop mode, we fetch directly - CORS is not an issue
      const response = await fetch(content, {
        signal: controller.signal,
        headers: {
          "Cache-Control": "no-cache",
        },
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const contentLength = response.headers.get("content-length");
      if (contentLength) {
        const size = Number.parseInt(contentLength, 10);
        if (size > options.maxSize) {
          throw new Error(
            `File size (${Math.round(size / 1024 / 1024)}MB) exceeds maximum allowed size (${Math.round(options.maxSize / 1024 / 1024)}MB)`,
          );
        }
      }

      return await response.arrayBuffer();
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof Error) {
        if (error.name === "AbortError") {
          throw new Error(`Request timeout after ${options.timeout}ms`);
        }
        throw error;
      }
      throw new Error("Unknown error fetching file");
    }
  }

  // Handle local file paths (workspace paths like /workspace/...)
  if (content.startsWith("/")) {
    // For local paths, we need to fetch from the server
    // This assumes there's an API endpoint or the file is accessible
    const response = await fetch(content);
    if (!response.ok) {
      throw new Error(`Failed to fetch local file: ${response.statusText}`);
    }
    return await response.arrayBuffer();
  }

  // Handle raw base64 strings
  if (/^[A-Za-z0-9+/]+=*$/.test(content.trim())) {
    return base64ToArrayBuffer(content.trim());
  }

  throw new Error("Unsupported content format");
}

/**
 * Converts base64 string to ArrayBuffer
 */
function base64ToArrayBuffer(base64: string): ArrayBuffer {
  try {
    // Remove whitespace and data URL prefix if present
    const cleanBase64 = base64
      .replaceAll(/\s/g, "")
      .replace(/^data:[^;]+;base64,/, "");

    const binaryString = atob(cleanBase64);
    const bytes = new Uint8Array(binaryString.length);

    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.codePointAt(i) ?? 0;
    }

    return bytes.buffer;
  } catch (error) {
    throw new Error(
      `Invalid base64 data: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }
}

/**
 * Converts DOCX file to HTML using mammoth.js
 */
export async function convertDocxToHtml(
  content: string,
  options: ConversionOptions = {},
): Promise<ConversionResult> {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  try {
    const arrayBuffer = await contentToArrayBuffer(content, opts);

    // Check size before processing
    if (arrayBuffer.byteLength > opts.maxSize) {
      return {
        html: "",
        success: false,
        error: `File size (${Math.round(arrayBuffer.byteLength / 1024 / 1024)}MB) exceeds maximum allowed size (${Math.round(opts.maxSize / 1024 / 1024)}MB)`,
      };
    }

    const result = await mammoth.convertToHtml(
      { arrayBuffer },
      {
        styleMap: [
          "p[style-name='Heading 1'] => h1:fresh",
          "p[style-name='Heading 2'] => h2:fresh",
          "p[style-name='Heading 3'] => h3:fresh",
        ],
      },
    );

    if (result.messages.length > 0) {
      console.warn("Mammoth conversion warnings:", result.messages);
    }

    // Wrap in theme-aware container with proper styling
    const styledHtml = `
      <div class="docx-preview-container" style="max-width: 100%;">
        <style>
          .docx-preview-container {
            color: #1f2937;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            line-height: 1.6;
          }
          .dark .docx-preview-container {
            color: #f9fafb;
          }
          .docx-preview-container h1,
          .docx-preview-container h2,
          .docx-preview-container h3,
          .docx-preview-container h4,
          .docx-preview-container h5,
          .docx-preview-container h6 {
            color: #111827;
            font-weight: 600;
            margin-top: 1.5em;
            margin-bottom: 0.5em;
          }
          .dark .docx-preview-container h1,
          .dark .docx-preview-container h2,
          .dark .docx-preview-container h3,
          .dark .docx-preview-container h4,
          .dark .docx-preview-container h5,
          .dark .docx-preview-container h6 {
            color: #f9fafb;
          }
          .docx-preview-container p {
            color: #1f2937;
            margin-bottom: 1em;
          }
          .dark .docx-preview-container p {
            color: #f9fafb;
          }
          .docx-preview-container ul,
          .docx-preview-container ol {
            color: #1f2937;
            margin-bottom: 1em;
            padding-left: 2em;
          }
          .dark .docx-preview-container ul,
          .dark .docx-preview-container ol {
            color: #f9fafb;
          }
          .docx-preview-container li {
            color: #1f2937;
            margin-bottom: 0.5em;
          }
          .dark .docx-preview-container li {
            color: #f9fafb;
          }
          .docx-preview-container table {
            border-collapse: collapse;
            width: 100%;
            margin-bottom: 1em;
          }
          .docx-preview-container table th,
          .docx-preview-container table td {
            border: 1px solid #e5e7eb;
            padding: 8px 12px;
            color: #1f2937;
          }
          .dark .docx-preview-container table th,
          .dark .docx-preview-container table td {
            border-color: #4b5563;
            color: #f9fafb;
          }
          .docx-preview-container table th {
            background-color: #f3f4f6;
            font-weight: 600;
          }
          .dark .docx-preview-container table th {
            background-color: #374151;
          }
          .docx-preview-container a {
            color: #2563eb;
            text-decoration: underline;
          }
          .dark .docx-preview-container a {
            color: #60a5fa;
          }
          .docx-preview-container img {
            max-width: 100%;
            height: auto;
          }
          .docx-preview-container code {
            background-color: #f3f4f6;
            color: #1f2937;
            padding: 2px 6px;
            border-radius: 4px;
            font-family: 'Courier New', monospace;
            font-size: 0.9em;
          }
          .dark .docx-preview-container code {
            background-color: #374151;
            color: #f9fafb;
          }
        </style>
        ${result.value}
      </div>
    `;

    return {
      html: styledHtml,
      success: true,
    };
  } catch (error) {
    console.error("DOCX conversion error:", error);
    return {
      html: "",
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to convert DOCX file",
    };
  }
}

/**
 * Loads SheetJS library dynamically (from CDN or npm)
 */
async function loadSheetJS(): Promise<any> {
  // Check if already loaded
  if (globalThis.window !== undefined && (globalThis.window as any).XLSX) {
    return (globalThis.window as any).XLSX;
  }

  // Try to import from npm if available
  try {
    const XLSX = await import("xlsx");
    return XLSX;
  } catch {
    // Fallback to CDN loading
    if (globalThis.window === undefined) {
      throw new TypeError("SheetJS can only be loaded in browser environment");
    }

    return new Promise((resolve, reject) => {
      // Check if script already exists
      const existingScript = document.querySelector(
        'script[src*="xlsx"]',
      ) as HTMLScriptElement;
      if (existingScript && (globalThis.window as any).XLSX) {
        resolve((globalThis.window as any).XLSX);
        return;
      }

      const script = document.createElement("script");
      script.src =
        "https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js";
      script.async = true;
      script.crossOrigin = "anonymous";
      script.integrity =
        "sha384-EnyY0/GSHQGSxSgMwaIPzSESbqoOLSexfnSMN2AP+39Ckmn92stwABZynq1JyzdT";

      script.onload = () => {
        if ((globalThis.window as any).XLSX) {
          resolve((globalThis.window as any).XLSX);
        } else {
          reject(new Error("Failed to load XLSX library"));
        }
      };

      script.onerror = () => {
        reject(new Error("Failed to load XLSX script"));
      };

      document.head.appendChild(script);
    });
  }
}

/**
 * Converts XLSX file to HTML table using SheetJS
 */
export async function convertXlsxToHtml(
  content: string,
  options: ConversionOptions = {},
): Promise<ConversionResult> {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  try {
    const arrayBuffer = await contentToArrayBuffer(content, opts);

    // Check size before processing
    if (arrayBuffer.byteLength > opts.maxSize) {
      return {
        html: "",
        success: false,
        error: `File size (${Math.round(arrayBuffer.byteLength / 1024 / 1024)}MB) exceeds maximum allowed size (${Math.round(opts.maxSize / 1024 / 1024)}MB)`,
      };
    }

    const XLSX = await loadSheetJS();

    // Read workbook
    const workbook = XLSX.read(arrayBuffer, {
      type: "array",
      cellDates: true,
      cellNF: false,
      cellStyles: false,
    });

    if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
      return {
        html: "",
        success: false,
        error: "Workbook contains no sheets",
      };
    }

    // Convert first sheet to HTML
    const firstSheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheetName];

    const html = XLSX.utils.sheet_to_html(worksheet, {
      id: "xlsx-table",
      editable: false,
    });

    // Wrap in a container with theme-aware styling
    const styledHtml = `
      <div class="xlsx-preview-container" style="width: 100%; overflow-x: auto;">
        <style>
          .xlsx-preview-container table {
            border-collapse: collapse;
            width: 100%;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            font-size: 14px;
            color: #1f2937;
          }
          .dark .xlsx-preview-container table {
            color: #f9fafb;
          }
          .xlsx-preview-container th {
            background-color: #f3f4f6;
            color: #111827;
            font-weight: 600;
            padding: 8px 12px;
            text-align: left;
            border: 1px solid #e5e7eb;
          }
          .dark .xlsx-preview-container th {
            background-color: #374151;
            color: #f9fafb;
            border-color: #4b5563;
          }
          .xlsx-preview-container td {
            padding: 8px 12px;
            border: 1px solid #e5e7eb;
            color: #1f2937;
          }
          .dark .xlsx-preview-container td {
            border-color: #4b5563;
            color: #f9fafb;
          }
          .xlsx-preview-container tr:nth-child(even) {
            background-color: #f9fafb;
          }
          .dark .xlsx-preview-container tr:nth-child(even) {
            background-color: #1f2937;
          }
          .xlsx-preview-container p {
            color: #6b7280;
          }
          .dark .xlsx-preview-container p {
            color: #9ca3af;
          }
        </style>
        ${html}
        ${workbook.SheetNames.length > 1 ? `<p style="margin-top: 16px; font-size: 12px;">Showing first sheet "${firstSheetName}". ${workbook.SheetNames.length - 1} more sheet(s) available.</p>` : ""}
      </div>
    `;

    return {
      html: styledHtml,
      success: true,
    };
  } catch (error) {
    console.error("XLSX conversion error:", error);
    return {
      html: "",
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to convert XLSX file",
    };
  }
}

/**
 * Detects file type from filename or content
 */
export function detectOfficeFileType(
  filename?: string,
  _content?: string,
): OfficeFileType | null {
  if (filename) {
    const ext = filename.split(".").pop()?.toLowerCase();
    if (ext === "docx" || ext === "doc") return "docx";
    if (ext === "xlsx" || ext === "xls") return "xlsx";
    if (ext === "pptx" || ext === "ppt") return "pptx";
  }

  // Could add content-based detection here if needed
  return null;
}

/**
 * Returns JSZip for PowerPoint parsing
 * JSZip is imported directly as an npm dependency
 */
function getJSZip(): typeof JSZipModule {
  return JSZip;
}

/**
 * Converts PPTX file to HTML by extracting slide content and images
 * PPTX files are ZIP archives containing XML files and media
 */
export async function convertPptxToHtml(
  content: string,
  options: ConversionOptions = {},
): Promise<PptxConversionResult> {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  try {
    // For remote URLs, use Office Online Viewer
    if (content.startsWith("http://") || content.startsWith("https://")) {
      // Check if it's localhost - if so, use direct iframe approach
      if (content.includes("localhost") || content.includes("127.0.0.1")) {
        // For localhost, we'll parse the PPTX client-side
        const arrayBuffer = await contentToArrayBuffer(content, opts);
        return await parsePptxToHtml(arrayBuffer);
      }

      // For public URLs, use Office Online Viewer
      const viewerUrl = `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(content)}`;
      const html = `
        <div class="pptx-preview-container" style="width: 100%; height: 100%;">
          <iframe
            src="${viewerUrl}"
            style="width: 100%; height: 100%; border: none;"
            title="PowerPoint Preview"
            sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-downloads"
          ></iframe>
        </div>
      `;
      return {
        html,
        success: true,
      };
    }

    // For local files (workspace paths), parse PPTX directly
    if (content.startsWith("/workspace/") || content.startsWith("/")) {
      const arrayBuffer = await contentToArrayBuffer(content, opts);
      return await parsePptxToHtml(arrayBuffer);
    }

    // For data URLs or base64, parse directly
    const arrayBuffer = await contentToArrayBuffer(content, opts);
    return await parsePptxToHtml(arrayBuffer);
  } catch (error) {
    console.error("PPTX conversion error:", error);
    return {
      html: "",
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to convert PPTX file",
    };
  }
}

/**
 * Extracts images from PPTX media folder
 * Images are stored in ppt/media/ folder
 */
async function extractPptxImages(
  zip: InstanceType<typeof JSZipModule.default>,
): Promise<Map<string, { blob: Blob; mimeType: string }>> {
  const images = new Map<string, { blob: Blob; mimeType: string }>();

  const mediaFiles: string[] = [];
  zip.forEach((relativePath: string) => {
    if (relativePath.startsWith("ppt/media/")) {
      mediaFiles.push(relativePath);
    }
  });

  for (const mediaPath of mediaFiles) {
    const file = zip.file(mediaPath);
    if (!file) continue;

    const ext = mediaPath.split(".").pop()?.toLowerCase();
    let mimeType = "image/png";
    if (ext === "jpg" || ext === "jpeg") mimeType = "image/jpeg";
    else if (ext === "gif") mimeType = "image/gif";
    else if (ext === "svg") mimeType = "image/svg+xml";
    else if (ext === "webp") mimeType = "image/webp";
    else if (ext === "emf" || ext === "wmf") continue; // Skip Windows metafiles

    try {
      const arrayBuffer = await file.async("arraybuffer");
      const blob = new Blob([arrayBuffer], { type: mimeType });
      const filename = mediaPath.split("/").pop() || mediaPath;
      images.set(filename, { blob, mimeType });
    } catch {
      // Skip files that fail to extract
    }
  }

  return images;
}

/**
 * Extracts slide background colors from slide XML
 */
function extractSlideBackground(xmlDoc: Document): string | null {
  // Try to find solid fill color
  const srgbClr = xmlDoc.getElementsByTagName("a:srgbClr")[0];
  if (srgbClr) {
    const val = srgbClr.getAttribute("val");
    if (val) return `#${val}`;
  }

  // Try scheme color
  const schemeClr = xmlDoc.getElementsByTagName("a:schemeClr")[0];
  if (schemeClr) {
    const val = schemeClr.getAttribute("val");
    // Map common scheme colors
    const schemeMap: Record<string, string> = {
      dk1: "#000000",
      lt1: "#FFFFFF",
      dk2: "#1F497D",
      lt2: "#EEECE1",
      accent1: "#4472C4",
      accent2: "#ED7D31",
      accent3: "#A5A5A5",
      accent4: "#FFC000",
      accent5: "#5B9BD5",
      accent6: "#70AD47",
    };
    if (val && schemeMap[val]) return schemeMap[val];
  }

  return null;
}

/**
 * Parses PPTX file (ZIP archive) and extracts slide content and images to HTML
 */
async function parsePptxToHtml(
  arrayBuffer: ArrayBuffer,
): Promise<PptxConversionResult> {
  try {
    const zip = await getJSZip().loadAsync(arrayBuffer);

    // Extract media images
    const mediaImages = await extractPptxImages(zip);

    // PPTX structure: ppt/slides/slide1.xml, slide2.xml, etc.
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

    // Extract slide relationships to find embedded images
    const slideImageRefs: Map<number, string[]> = new Map();

    for (let i = 0; i < slideFiles.length; i++) {
      const slidePath = slideFiles[i];
      const slideNum = i + 1;
      const relsPath = slidePath
        .replace("ppt/slides/slide", "ppt/slides/_rels/slide")
        .replace(".xml", ".xml.rels");

      const relsFile = zip.file(relsPath);
      if (relsFile) {
        const relsXml = await relsFile.async("string");
        const parser = new DOMParser();
        const relsDoc = parser.parseFromString(relsXml, "text/xml");
        const relationships = relsDoc.getElementsByTagName("Relationship");

        const imageRefs: string[] = [];
        for (const rel of Array.from(relationships)) {
          const type = rel.getAttribute("Type") || "";
          const target = rel.getAttribute("Target") || "";
          if (type.includes("image") && target.includes("media/")) {
            const filename = target.split("/").pop();
            if (filename) imageRefs.push(filename);
          }
        }
        slideImageRefs.set(slideNum, imageRefs);
      }
    }

    // Create blob URLs for images
    const slideImages: SlideImage[] = [];
    const imageBlobUrls: Map<string, string> = new Map();

    for (const [filename, { blob }] of mediaImages) {
      const url = URL.createObjectURL(blob);
      imageBlobUrls.set(filename, url);
    }

    // Extract text and images from each slide
    interface SlideData {
      slideNumber: number;
      texts: string[];
      images: string[];
      backgroundColor: string | null;
    }

    const slidesData: SlideData[] = [];

    for (let i = 0; i < slideFiles.length; i++) {
      const slidePath = slideFiles[i];
      const slideNum = i + 1;
      const slideXml = await zip.file(slidePath)?.async("string");
      if (!slideXml) continue;

      // Parse XML to extract text content
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(slideXml, "text/xml");

      // Extract background color
      const backgroundColor = extractSlideBackground(xmlDoc);

      // Extract text from <a:t> elements (text runs in PowerPoint)
      const textElements = xmlDoc.getElementsByTagName("a:t");
      const slideTexts: string[] = [];
      for (const element of Array.from(textElements)) {
        const text = element.textContent?.trim();
        if (text) slideTexts.push(text);
      }

      // Get images for this slide
      const imageRefs = slideImageRefs.get(slideNum) || [];
      const slideImageUrls: string[] = [];
      for (const ref of imageRefs) {
        const url = imageBlobUrls.get(ref);
        if (url) {
          slideImageUrls.push(url);
          const imageData = mediaImages.get(ref);
          slideImages.push({
            slideNumber: slideNum,
            imageUrl: url,
            mimeType: imageData?.mimeType || "image/png",
          });
        }
      }

      slidesData.push({
        slideNumber: slideNum,
        texts: slideTexts,
        images: slideImageUrls,
        backgroundColor,
      });
    }

    // Build HTML with visual slide previews
    const slidesHtml = slidesData.map((slide, _index) => {
      const bgStyle = slide.backgroundColor
        ? `background: ${slide.backgroundColor};`
        : "background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);";

      const hasImages = slide.images.length > 0;
      const hasText = slide.texts.length > 0;

      // Create slide thumbnail with visual content
      const thumbnailContent = hasImages
        ? `<img src="${slide.images[0]}" alt="Slide ${slide.slideNumber}" style="width: 100%; height: 100%; object-fit: contain;" />`
        : `<div style="padding: 1rem; display: flex; flex-direction: column; justify-content: center; height: 100%;">
            ${slide.texts
              .slice(0, 3)
              .map(
                (text, i) =>
                  `<p style="margin: 0.25rem 0; font-size: ${i === 0 ? "1rem" : "0.75rem"}; font-weight: ${i === 0 ? "600" : "400"}; color: white; text-shadow: 0 1px 2px rgba(0,0,0,0.5); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(text)}</p>`,
              )
              .join("")}
           </div>`;

      return `
        <div class="pptx-slide" data-slide="${slide.slideNumber}" style="scroll-margin-top: 1rem;">
          <!-- Slide Header -->
          <div style="display: flex; align-items: center; gap: 0.75rem; margin-bottom: 1rem;">
            <span style="background: #6366f1; color: white; padding: 0.25rem 0.75rem; border-radius: 9999px; font-size: 0.75rem; font-weight: 600;">
              Slide ${slide.slideNumber}
            </span>
            ${hasImages ? '<span style="background: #10b981; color: white; padding: 0.25rem 0.5rem; border-radius: 4px; font-size: 0.625rem;">HAS IMAGES</span>' : ""}
          </div>

          <!-- Slide Visual Preview -->
          <div style="aspect-ratio: 16/9; border-radius: 8px; overflow: hidden; ${bgStyle} box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06); margin-bottom: 1rem;">
            ${thumbnailContent}
          </div>

          <!-- Additional Images Grid -->
          ${
            slide.images.length > 1
              ? `
            <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(100px, 1fr)); gap: 0.5rem; margin-bottom: 1rem;">
              ${slide.images
                .slice(1, 5)
                .map(
                  (img) => `
                <div style="aspect-ratio: 1; border-radius: 4px; overflow: hidden; border: 1px solid #e5e7eb;">
                  <img src="${img}" alt="Slide image" style="width: 100%; height: 100%; object-fit: cover;" />
                </div>
              `,
                )
                .join("")}
              ${slide.images.length > 5 ? `<div style="aspect-ratio: 1; border-radius: 4px; background: #f3f4f6; display: flex; align-items: center; justify-content: center; color: #6b7280; font-size: 0.875rem;">+${slide.images.length - 5} more</div>` : ""}
            </div>
          `
              : ""
          }

          <!-- Text Content -->
          ${
            hasText
              ? `
            <div style="background: #f9fafb; border-radius: 6px; padding: 1rem; border: 1px solid #e5e7eb;">
              ${slide.texts
                .slice(0, 5)
                .map(
                  (text, i) => `
                <p style="margin: ${i === 0 ? "0" : "0.5rem 0 0 0"}; font-size: ${i === 0 ? "1rem" : "0.875rem"}; font-weight: ${i === 0 ? "600" : "400"}; color: #1f2937; line-height: 1.4;">
                  ${escapeHtml(text)}
                </p>
              `,
                )
                .join("")}
              ${slide.texts.length > 5 ? `<p style="margin-top: 0.5rem; font-size: 0.75rem; color: #9ca3af;">... and ${slide.texts.length - 5} more text elements</p>` : ""}
            </div>
          `
              : ""
          }
        </div>
      `;
    });

    // Build thumbnail navigation
    const thumbnailNav = slidesData.map((slide) => {
      const bgStyle = slide.backgroundColor
        ? `background: ${slide.backgroundColor};`
        : "background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);";

      const hasImage = slide.images.length > 0;

      return `
        <button
          onclick="document.querySelector('[data-slide=&quot;${slide.slideNumber}&quot;]').scrollIntoView({ behavior: 'smooth', block: 'start' })"
          style="flex-shrink: 0; width: 80px; border: 2px solid transparent; border-radius: 4px; overflow: hidden; cursor: pointer; transition: border-color 0.2s; padding: 0;"
          onmouseover="this.style.borderColor='#6366f1'"
          onmouseout="this.style.borderColor='transparent'"
        >
          <div style="aspect-ratio: 16/9; ${bgStyle}">
            ${hasImage ? `<img src="${slide.images[0]}" style="width: 100%; height: 100%; object-fit: contain;" />` : `<div style="display: flex; align-items: center; justify-content: center; height: 100%; color: white; font-weight: 600; font-size: 0.75rem;">${slide.slideNumber}</div>`}
          </div>
        </button>
      `;
    });

    const html = `
      <div class="pptx-preview-container" style="width: 100%; max-width: 900px; margin: 0 auto;">
        <style>
          .pptx-preview-container {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          }
          .dark .pptx-preview-container {
            background: #111827;
          }
          .dark .pptx-slide {
            background: #1f2937;
            border-color: #374151;
          }
          .dark .pptx-slide h3 {
            color: #f9fafb;
          }
          .dark .pptx-slide div {
            color: #e5e7eb;
          }
          .dark .pptx-slide > div:last-child {
            background: #1f2937 !important;
            border-color: #374151 !important;
          }
          .dark .pptx-slide > div:last-child p {
            color: #e5e7eb !important;
          }
          .pptx-slide {
            margin-bottom: 2rem;
            padding: 1.5rem;
            border: 1px solid #e5e7eb;
            border-radius: 12px;
            background: white;
          }
          .pptx-thumbnail-nav {
            display: flex;
            gap: 0.5rem;
            overflow-x: auto;
            padding: 0.5rem;
            background: #1f2937;
            border-radius: 8px;
            margin-bottom: 1.5rem;
          }
          .pptx-thumbnail-nav::-webkit-scrollbar {
            height: 6px;
          }
          .pptx-thumbnail-nav::-webkit-scrollbar-track {
            background: #374151;
            border-radius: 3px;
          }
          .pptx-thumbnail-nav::-webkit-scrollbar-thumb {
            background: #6b7280;
            border-radius: 3px;
          }
        </style>

        <!-- Header -->
        <div style="margin-bottom: 1.5rem; padding-bottom: 1rem; border-bottom: 2px solid #e5e7eb;">
          <h2 style="color: #111827; font-size: 1.5em; font-weight: 700; margin: 0; display: flex; align-items: center; gap: 0.5rem;">
            <span style="font-size: 1.5rem;">📊</span> PowerPoint Presentation
          </h2>
          <p style="color: #6b7280; font-size: 0.875em; margin-top: 0.5em;">
            ${slidesData.length} slide${slidesData.length === 1 ? "" : "s"}
            ${mediaImages.size > 0 ? `• ${mediaImages.size} embedded image${mediaImages.size === 1 ? "" : "s"}` : ""}
          </p>
        </div>

        <!-- Thumbnail Navigation -->
        <div class="pptx-thumbnail-nav">
          ${thumbnailNav.join("")}
        </div>

        <!-- Slides -->
        ${slidesHtml.join("")}

        <!-- Footer Note -->
        <div style="margin-top: 1rem; padding: 1rem; background: linear-gradient(135deg, #eff6ff 0%, #f0fdf4 100%); border-radius: 8px; border: 1px solid #bfdbfe;">
          <p style="color: #1e40af; font-size: 0.875em; margin: 0; display: flex; align-items: center; gap: 0.5rem;">
            <span>✨</span>
            <span><strong>Enhanced Preview:</strong> Images and text extracted from your presentation. Download the file to view animations and full formatting.</span>
          </p>
        </div>
      </div>
    `;

    return {
      html,
      success: true,
      slideImages,
      slideCount: slidesData.length,
    };
  } catch (error) {
    console.error("PPTX parsing error:", error);
    return {
      html: "",
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to parse PPTX file",
    };
  }
}

/**
 * Escapes HTML to prevent XSS
 */
function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Main conversion function that routes to appropriate converter
 */
export async function convertOfficeFileToHtml(
  content: string,
  fileType: OfficeFileType,
  options: ConversionOptions = {},
): Promise<ConversionResult> {
  switch (fileType) {
    case "docx":
      return convertDocxToHtml(content, options);
    case "xlsx":
      return convertXlsxToHtml(content, options);
    case "pptx":
      return convertPptxToHtml(content, options);
    default:
      return {
        html: "",
        success: false,
        error: `Unsupported file type: ${fileType}`,
      };
  }
}
