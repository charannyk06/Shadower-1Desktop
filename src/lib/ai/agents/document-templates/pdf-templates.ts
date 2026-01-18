/**
 * Professional PDF generation templates using Puppeteer
 * Creates stunning PDFs by generating HTML and converting to PDF via Puppeteer
 * Supports images, charts, tables, and professional styling
 */

import { ColorPalette, getPalette } from "./color-palettes";

// PDF template types
export type PDFTemplateType =
  | "report"
  | "invoice"
  | "brochure"
  | "certificate"
  | "proposal"
  | "resume"
  | "letter"
  | "minimal";

// PDF section types
export type PDFSectionType =
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

// PDF section interface
export interface PDFSection {
  type: PDFSectionType;
  content?: string;
  items?: string[];
  tableData?: {
    headers: string[];
    rows: string[][];
  };
  imageUrl?: string;
  imageCaption?: string;
  imageWidth?: string; // CSS width (e.g., "300px", "50%")
  imageHeight?: string; // CSS height
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

// PDF options
export interface PDFOptions {
  template: PDFTemplateType;
  title: string;
  subtitle?: string;
  author?: string;
  company?: string;
  date?: string;
  logoUrl?: string;
  paletteName?: string;
  pageSize?: "A4" | "Letter" | "Legal";
  orientation?: "portrait" | "landscape";
  margins?: {
    top?: string;
    right?: string;
    bottom?: string;
    left?: string;
  };
  headerHtml?: string;
  footerHtml?: string;
  includePageNumbers?: boolean;
}

// Font configurations for PDF templates
const PDF_FONTS = {
  report: {
    heading: "'Segoe UI', Arial, sans-serif",
    body: "'Georgia', 'Times New Roman', serif",
    mono: "'Consolas', 'Courier New', monospace",
  },
  invoice: {
    heading: "'Arial', 'Helvetica', sans-serif",
    body: "'Arial', 'Helvetica', sans-serif",
    mono: "'Consolas', monospace",
  },
  brochure: {
    heading: "'Playfair Display', 'Georgia', serif",
    body: "'Open Sans', 'Segoe UI', sans-serif",
    mono: "'Consolas', monospace",
  },
  certificate: {
    heading: "'Playfair Display', 'Times New Roman', serif",
    body: "'Georgia', serif",
    mono: "'Courier New', monospace",
  },
  proposal: {
    heading: "'Segoe UI', 'Calibri', sans-serif",
    body: "'Segoe UI', 'Calibri', sans-serif",
    mono: "'Consolas', monospace",
  },
  resume: {
    heading: "'Helvetica', 'Arial', sans-serif",
    body: "'Helvetica', 'Arial', sans-serif",
    mono: "'Monaco', monospace",
  },
  letter: {
    heading: "'Georgia', serif",
    body: "'Georgia', serif",
    mono: "'Courier New', monospace",
  },
  minimal: {
    heading: "'Helvetica', 'Arial', sans-serif",
    body: "'Helvetica', 'Arial', sans-serif",
    mono: "'Monaco', monospace",
  },
};

// Callout styles
const CALLOUT_STYLES = {
  info: { icon: "ℹ️", color: "#2196F3", bgColor: "#E3F2FD" },
  warning: { icon: "⚠️", color: "#FF9800", bgColor: "#FFF3E0" },
  success: { icon: "✅", color: "#4CAF50", bgColor: "#E8F5E9" },
  error: { icon: "❌", color: "#F44336", bgColor: "#FFEBEE" },
};

/**
 * Generate CSS styles for the PDF
 */
function generatePDFStyles(
  template: PDFTemplateType,
  palette: ColorPalette,
): string {
  const fonts = PDF_FONTS[template];

  return `
    @import url('https://fonts.googleapis.com/css2?family=Open+Sans:wght@400;600;700&family=Playfair+Display:wght@400;700&display=swap');

    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: ${fonts.body};
      font-size: 12pt;
      line-height: 1.6;
      color: #${palette.text};
      background-color: #${palette.background};
    }

    .page {
      padding: 40px 50px;
      min-height: 100vh;
    }

    /* Typography */
    h1 {
      font-family: ${fonts.heading};
      font-size: 28pt;
      font-weight: 700;
      color: #${palette.primary};
      margin-bottom: 16px;
      line-height: 1.2;
    }

    h2 {
      font-family: ${fonts.heading};
      font-size: 20pt;
      font-weight: 600;
      color: #${palette.text};
      margin-top: 24px;
      margin-bottom: 12px;
      border-bottom: 2px solid #${palette.accent};
      padding-bottom: 8px;
    }

    h3 {
      font-family: ${fonts.heading};
      font-size: 14pt;
      font-weight: 600;
      color: #${palette.text};
      margin-top: 20px;
      margin-bottom: 10px;
    }

    p {
      margin-bottom: 12px;
      text-align: justify;
    }

    /* Lists */
    ul, ol {
      margin-left: 24px;
      margin-bottom: 12px;
    }

    li {
      margin-bottom: 6px;
    }

    ul li::marker {
      color: #${palette.primary};
    }

    /* Tables */
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 16px 0;
      font-size: 11pt;
    }

    th {
      background-color: #${palette.primary};
      color: #${palette.textInverse};
      font-weight: 600;
      padding: 12px 16px;
      text-align: left;
      border: 1px solid #${palette.primary};
    }

    td {
      padding: 10px 16px;
      border: 1px solid #${palette.textMuted}40;
    }

    tr:nth-child(even) {
      background-color: #${palette.surface};
    }

    tr:hover {
      background-color: #${palette.accent}20;
    }

    /* Images */
    .image-container {
      margin: 20px 0;
      text-align: center;
    }

    .image-container.left {
      text-align: left;
    }

    .image-container.right {
      text-align: right;
    }

    .image-container img {
      max-width: 100%;
      height: auto;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.1);
    }

    .image-caption {
      font-size: 10pt;
      color: #${palette.textMuted};
      font-style: italic;
      margin-top: 8px;
    }

    /* Image with text */
    .image-text-container {
      display: flex;
      gap: 24px;
      margin: 20px 0;
      align-items: flex-start;
    }

    .image-text-container.image-right {
      flex-direction: row-reverse;
    }

    .image-text-container .image-side {
      flex: 0 0 40%;
    }

    .image-text-container .text-side {
      flex: 1;
    }

    .image-text-container img {
      width: 100%;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.1);
    }

    /* Quote */
    blockquote {
      border-left: 4px solid #${palette.primary};
      padding: 16px 24px;
      margin: 20px 0;
      background-color: #${palette.surface};
      font-style: italic;
      color: #${palette.textMuted};
      font-size: 14pt;
      border-radius: 0 8px 8px 0;
    }

    /* Code block */
    pre, code {
      font-family: ${fonts.mono};
      background-color: #${palette.surface};
      border-radius: 4px;
    }

    pre {
      padding: 16px;
      margin: 16px 0;
      overflow-x: auto;
      font-size: 10pt;
      border: 1px solid #${palette.textMuted}40;
    }

    code {
      padding: 2px 6px;
      font-size: 10pt;
    }

    /* Callout */
    .callout {
      padding: 16px 20px;
      margin: 16px 0;
      border-radius: 8px;
      display: flex;
      gap: 12px;
      align-items: flex-start;
    }

    .callout-icon {
      font-size: 18pt;
      flex-shrink: 0;
    }

    .callout-content {
      flex: 1;
    }

    .callout.info {
      background-color: #E3F2FD;
      border-left: 4px solid #2196F3;
    }

    .callout.warning {
      background-color: #FFF3E0;
      border-left: 4px solid #FF9800;
    }

    .callout.success {
      background-color: #E8F5E9;
      border-left: 4px solid #4CAF50;
    }

    .callout.error {
      background-color: #FFEBEE;
      border-left: 4px solid #F44336;
    }

    /* Divider */
    .divider {
      border: none;
      height: 2px;
      background: linear-gradient(to right, transparent, #${palette.textMuted}60, transparent);
      margin: 32px 0;
    }

    /* Columns */
    .two-column {
      display: flex;
      gap: 32px;
      margin: 20px 0;
    }

    .two-column > div {
      flex: 1;
    }

    .three-column {
      display: flex;
      gap: 24px;
      margin: 20px 0;
    }

    .three-column > div {
      flex: 1;
    }

    /* Stats */
    .stats-container {
      display: flex;
      gap: 24px;
      margin: 24px 0;
      justify-content: center;
    }

    .stat-item {
      text-align: center;
      padding: 24px;
      background: linear-gradient(135deg, #${palette.primary}10, #${palette.accent}10);
      border-radius: 12px;
      min-width: 140px;
      border: 1px solid #${palette.primary}20;
    }

    .stat-icon {
      font-size: 24pt;
      margin-bottom: 8px;
    }

    .stat-value {
      font-family: ${fonts.heading};
      font-size: 32pt;
      font-weight: 700;
      color: #${palette.primary};
      line-height: 1;
    }

    .stat-label {
      font-size: 10pt;
      color: #${palette.textMuted};
      margin-top: 8px;
      text-transform: uppercase;
      letter-spacing: 1px;
    }

    /* Timeline */
    .timeline {
      position: relative;
      padding-left: 40px;
      margin: 24px 0;
    }

    .timeline::before {
      content: '';
      position: absolute;
      left: 12px;
      top: 0;
      bottom: 0;
      width: 3px;
      background: linear-gradient(to bottom, #${palette.primary}, #${palette.accent});
      border-radius: 2px;
    }

    .timeline-item {
      position: relative;
      padding-bottom: 24px;
    }

    .timeline-item::before {
      content: '';
      position: absolute;
      left: -33px;
      top: 4px;
      width: 14px;
      height: 14px;
      background-color: #${palette.primary};
      border: 3px solid #${palette.background};
      border-radius: 50%;
      box-shadow: 0 0 0 3px #${palette.primary}40;
    }

    .timeline-date {
      font-size: 10pt;
      color: #${palette.textMuted};
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 1px;
    }

    .timeline-title {
      font-family: ${fonts.heading};
      font-size: 14pt;
      font-weight: 600;
      color: #${palette.text};
      margin: 4px 0;
    }

    .timeline-description {
      font-size: 11pt;
      color: #${palette.textMuted};
    }

    /* Cover page */
    .cover-page {
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      text-align: center;
      background: linear-gradient(135deg, #${palette.background} 0%, #${palette.surface} 100%);
      padding: 60px;
    }

    .cover-logo {
      max-width: 150px;
      margin-bottom: 40px;
    }

    .cover-title {
      font-family: ${fonts.heading};
      font-size: 42pt;
      font-weight: 700;
      color: #${palette.primary};
      margin-bottom: 16px;
      line-height: 1.1;
    }

    .cover-subtitle {
      font-size: 18pt;
      color: #${palette.textMuted};
      margin-bottom: 40px;
    }

    .cover-divider {
      width: 150px;
      height: 4px;
      background: linear-gradient(to right, #${palette.primary}, #${palette.accent});
      border-radius: 2px;
      margin: 40px 0;
    }

    .cover-meta {
      font-size: 12pt;
      color: #${palette.textMuted};
    }

    .cover-author {
      margin-bottom: 8px;
    }

    /* Page break */
    .page-break {
      page-break-after: always;
    }

    /* Print styles */
    @media print {
      body {
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
      }

      .page-break {
        page-break-after: always;
      }
    }
  `;
}

/**
 * Generate cover page HTML
 */
function generateCoverPageHtml(
  options: PDFOptions,
  palette: ColorPalette,
): string {
  let html = `<div class="cover-page">`;

  if (options.logoUrl) {
    html += `<img class="cover-logo" src="${escapeHtml(options.logoUrl)}" alt="Logo" />`;
  }

  if (options.company) {
    html += `<div style="font-size: 14pt; color: #${palette.textMuted}; margin-bottom: 20px;">${escapeHtml(options.company)}</div>`;
  }

  html += `<h1 class="cover-title">${escapeHtml(options.title)}</h1>`;

  if (options.subtitle) {
    html += `<div class="cover-subtitle">${escapeHtml(options.subtitle)}</div>`;
  }

  html += `<div class="cover-divider"></div>`;

  html += `<div class="cover-meta">`;
  if (options.author) {
    html += `<div class="cover-author">Prepared by: ${escapeHtml(options.author)}</div>`;
  }
  html += `<div>${escapeHtml(options.date || new Date().toLocaleDateString())}</div>`;
  html += `</div>`;

  html += `</div><div class="page-break"></div>`;

  return html;
}

/**
 * Escape HTML special characters
 */
function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// Helper functions to reduce cognitive complexity
function formatColumnContent(content: string | string[] | undefined): string {
  if (Array.isArray(content)) {
    return content.map((item) => `<p>${escapeHtml(item)}</p>`).join("");
  }
  return `<p>${escapeHtml(content || "")}</p>`;
}

function generateImageHtml(section: PDFSection): string {
  const imgPosition = section.imagePosition || "center";
  const imgWidth = section.imageWidth || "auto";
  const imgHeight = section.imageHeight || "auto";
  const imageUrl = escapeHtml(section.imageUrl || "");
  const imageAlt = escapeHtml(section.imageCaption || "Image");
  let imgHtml = `<div class="image-container ${imgPosition}">`;
  imgHtml += `<img src="${imageUrl}" style="width: ${imgWidth}; height: ${imgHeight};" alt="${imageAlt}" />`;
  if (section.imageCaption) {
    imgHtml += `<div class="image-caption">${escapeHtml(section.imageCaption)}</div>`;
  }
  imgHtml += `</div>`;
  return imgHtml;
}

function generateImageTextHtml(section: PDFSection): string {
  const itPosition = section.imagePosition === "right" ? "image-right" : "";
  let itHtml = `<div class="image-text-container ${itPosition}">`;
  itHtml += `<div class="image-side">`;
  itHtml += `<img src="${escapeHtml(section.imageUrl || "")}" alt="${escapeHtml(section.imageCaption || "Image")}" />`;
  if (section.imageCaption) {
    itHtml += `<div class="image-caption">${escapeHtml(section.imageCaption)}</div>`;
  }
  itHtml += `</div>`;
  itHtml += `<div class="text-side"><p>${escapeHtml(section.content || "")}</p></div>`;
  itHtml += `</div>`;
  return itHtml;
}

function generateStatsHtml(section: PDFSection): string {
  if (!section.stats) return "";
  const statsHtml = section.stats
    .map(
      (stat) => `
        <div class="stat-item">
          ${stat.icon ? `<div class="stat-icon">${stat.icon}</div>` : ""}
          <div class="stat-value">${escapeHtml(String(stat.value))}</div>
          <div class="stat-label">${escapeHtml(stat.label)}</div>
        </div>
      `,
    )
    .join("");
  return `<div class="stats-container">${statsHtml}</div>`;
}

function generateTimelineHtml(section: PDFSection): string {
  if (!section.timelineItems) return "";
  const timelineHtml = section.timelineItems
    .map(
      (item) => `
        <div class="timeline-item">
          <div class="timeline-date">${escapeHtml(item.date)}</div>
          <div class="timeline-title">${escapeHtml(item.title)}</div>
          ${item.description ? `<div class="timeline-description">${escapeHtml(item.description)}</div>` : ""}
        </div>
      `,
    )
    .join("");
  return `<div class="timeline">${timelineHtml}</div>`;
}

/**
 * Generate section HTML
 */
function generateSectionHtml(
  section: PDFSection,
  _template: PDFTemplateType,
  _palette: ColorPalette,
): string {
  switch (section.type) {
    case "heading1":
      return `<h1>${escapeHtml(section.content || "")}</h1>`;

    case "heading2":
      return `<h2>${escapeHtml(section.content || "")}</h2>`;

    case "heading3":
      return `<h3>${escapeHtml(section.content || "")}</h3>`;

    case "paragraph":
      return `<p>${escapeHtml(section.content || "")}</p>`;

    case "bullet-list": {
      const listItems = (section.items || [])
        .map((item) => `<li>${escapeHtml(item)}</li>`)
        .join("");
      return `<ul>${listItems}</ul>`;
    }

    case "numbered-list": {
      const listItems = (section.items || [])
        .map((item) => `<li>${escapeHtml(item)}</li>`)
        .join("");
      return `<ol>${listItems}</ol>`;
    }

    case "table": {
      if (!section.tableData) return "";
      const headers = section.tableData.headers
        .map((h) => `<th>${escapeHtml(h)}</th>`)
        .join("");
      const rows = section.tableData.rows
        .map((row) => {
          const cells = row
            .map((cell) => `<td>${escapeHtml(cell)}</td>`)
            .join("");
          return `<tr>${cells}</tr>`;
        })
        .join("");
      return `<table><thead><tr>${headers}</tr></thead><tbody>${rows}</tbody></table>`;
    }

    case "image":
      return generateImageHtml(section);

    case "image-text":
      return generateImageTextHtml(section);

    case "quote":
      return `<blockquote>${escapeHtml(section.content || "")}</blockquote>`;

    case "code":
      return `<pre><code>${escapeHtml(section.content || "")}</code></pre>`;

    case "callout": {
      const calloutType = section.calloutType || "info";
      const calloutStyle = CALLOUT_STYLES[calloutType];
      return `
        <div class="callout ${calloutType}">
          <span class="callout-icon">${calloutStyle.icon}</span>
          <div class="callout-content">${escapeHtml(section.content || "")}</div>
        </div>
      `;
    }

    case "divider":
      return `<hr class="divider" />`;

    case "two-column": {
      const leftContent = formatColumnContent(section.leftContent);
      const rightContent = formatColumnContent(section.rightContent);
      return `
        <div class="two-column">
          <div>${leftContent}</div>
          <div>${rightContent}</div>
        </div>
      `;
    }

    case "three-column": {
      const col1 = formatColumnContent(section.leftContent);
      const col2 = formatColumnContent(section.centerContent);
      const col3 = formatColumnContent(section.rightContent);
      return `
        <div class="three-column">
          <div>${col1}</div>
          <div>${col2}</div>
          <div>${col3}</div>
        </div>
      `;
    }

    case "stats":
      return generateStatsHtml(section);

    case "timeline":
      return generateTimelineHtml(section);

    case "page-break":
      return `<div class="page-break"></div>`;

    default:
      return "";
  }
}

/**
 * Generate the full HTML document
 */
function generateHtmlDocument(
  sections: PDFSection[],
  options: PDFOptions,
  palette: ColorPalette,
): string {
  const styles = generatePDFStyles(options.template, palette);

  let bodyContent = "";

  // Add cover page if template supports it and title is provided
  if (["report", "proposal", "brochure"].includes(options.template)) {
    bodyContent += generateCoverPageHtml(options, palette);
  }

  // Add content
  bodyContent += `<div class="page">`;
  sections.forEach((section) => {
    bodyContent += generateSectionHtml(section, options.template, palette);
  });
  bodyContent += `</div>`;

  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${escapeHtml(options.title)}</title>
      <style>${styles}</style>
    </head>
    <body>
      ${bodyContent}
    </body>
    </html>
  `;
}

/**
 * Generate Puppeteer code for creating a PDF
 */
export function generatePDFTemplate(
  sections: PDFSection[],
  options: PDFOptions,
): string {
  const palette = getPalette(options.paletteName || "gamma-light");
  const htmlContent = generateHtmlDocument(sections, options, palette);

  // Escape the HTML for JavaScript string
  const escapedHtml = JSON.stringify(htmlContent);

  const pageSize = options.pageSize || "A4";
  const margins = options.margins || {
    top: "1in",
    right: "0.75in",
    bottom: "1in",
    left: "0.75in",
  };
  const orientation = options.orientation || "portrait";

  // Replace all non-alphanumeric characters with underscores
  // SonarQube: regex pattern [^a-zA-Z0-9] requires replace() instead of replaceAll()
  // NOSONAR: replaceAll() does not support regex patterns
  const safeFileName = JSON.stringify(
    options.title.replace(/[^a-zA-Z0-9]/g, "_") + ".pdf", // NOSONAR
  );

  // Build header/footer templates if page numbers are requested
  let headerTemplate = "null";
  let footerTemplate = "null";

  if (options.includePageNumbers) {
    footerTemplate = JSON.stringify(`
      <div style="width: 100%; font-size: 10px; padding: 5px 20px; color: #666; display: flex; justify-content: space-between;">
        <span>${options.company || options.author || ""}</span>
        <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
      </div>
    `);
  }

  if (options.headerHtml) {
    headerTemplate = JSON.stringify(options.headerHtml);
  }

  if (options.footerHtml) {
    footerTemplate = JSON.stringify(options.footerHtml);
  }

  return `
// ============================================
// PDF Generation with Puppeteer
// ============================================

const { execSync } = require('child_process');
const fs = require('fs');

// Install puppeteer if not available
try {
  require.resolve('puppeteer');
} catch (e) {
  console.log('Installing puppeteer...');
  execSync('npm install puppeteer --no-save --silent 2>/dev/null || npm install puppeteer --no-save', {
    stdio: 'pipe',
    cwd: '/home/user'
  });
  console.log('Puppeteer installed successfully');
}

const puppeteer = require('puppeteer');

// HTML content to convert to PDF
const htmlContent = ${escapedHtml};

// PDF options
const pdfOptions = {
  format: '${pageSize}',
  landscape: ${orientation === "landscape"},
  margin: {
    top: '${margins.top || "1in"}',
    right: '${margins.right || "0.75in"}',
    bottom: '${margins.bottom || "1in"}',
    left: '${margins.left || "0.75in"}'
  },
  printBackground: true,
  preferCSSPageSize: false
};

// Add header/footer if specified
${headerTemplate === "null" ? "" : `pdfOptions.headerTemplate = ${headerTemplate};`}
${footerTemplate === "null" ? "" : `pdfOptions.footerTemplate = ${footerTemplate};`}
${options.includePageNumbers || options.headerHtml || options.footerHtml ? `pdfOptions.displayHeaderFooter = true;` : ""}

async function generatePDF() {
  console.log('Launching browser...');

  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--disable-gpu',
      '--font-render-hinting=none'
    ]
  });

  try {
    const page = await browser.newPage();

    // Set viewport for consistent rendering
    await page.setViewport({
      width: 1200,
      height: 800,
      deviceScaleFactor: 2
    });

    console.log('Loading content...');

    // Set the HTML content
    await page.setContent(htmlContent, {
      waitUntil: ['load', 'networkidle0'],
      timeout: 60000
    });

    // Wait for all images to load
    await page.evaluate(async () => {
      const images = Array.from(document.querySelectorAll('img'));
      await Promise.all(images.map(img => {
        if (img.complete) return Promise.resolve();
        return new Promise((resolve, reject) => {
          img.addEventListener('load', resolve);
          img.addEventListener('error', resolve); // Continue even if image fails
          setTimeout(resolve, 10000); // 10s timeout per image
        });
      }));
    });

    // Wait for fonts to load
    await page.evaluateHandle('document.fonts.ready');

    // Additional wait for rendering
    await new Promise(resolve => setTimeout(resolve, 1000));

    console.log('Generating PDF...');

    // Generate PDF
    const fileName = ${safeFileName};
    await page.pdf({
      ...pdfOptions,
      path: fileName
    });

    console.log('PDF saved to:', fileName);

  } finally {
    await browser.close();
  }
}

// Run the PDF generation
generatePDF().catch(err => {
  console.error('Error generating PDF:', err);
  process.exit(1);
});
`;
}
