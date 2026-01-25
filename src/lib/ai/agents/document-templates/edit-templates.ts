/**
 * Document Edit Templates - Surgical document editing using local execution
 *
 * This module provides code generators for editing existing documents
 * (PPTX, DOCX, XLSX) locally. It leverages the local file system's
 * read/write capabilities to download, modify, and save documents.
 *
 * Library capabilities:
 * - ExcelJS: Full read/write support for XLSX
 * - PptxGenJS: Limited read, full write for PPTX (uses JSZip for parsing)
 * - docx: Write-only (uses mammoth.js to read, recreate with docx)
 */

import { getPalette } from "./color-palettes";

// ============================================================================
// Types for Document Editing
// ============================================================================

/**
 * Spreadsheet edit change types
 */
export interface SpreadsheetChange {
  type:
    | "updateCell"
    | "updateCells"
    | "addRow"
    | "deleteRow"
    | "insertRow"
    | "updateColumn"
    | "addColumn"
    | "deleteColumn"
    | "addSheet"
    | "deleteSheet"
    | "renameSheet"
    | "updateStyle"
    | "addChart"
    | "addConditionalFormatting";
  sheetName?: string;
  cell?: { row: number; col: number };
  cells?: Array<{ row: number; col: number; value: unknown }>;
  value?: unknown;
  row?: Record<string, unknown>;
  rowIndex?: number;
  columnKey?: string;
  columnHeader?: string;
  newSheetName?: string;
  style?: {
    font?: { bold?: boolean; color?: string; size?: number };
    fill?: { color?: string };
    alignment?: { horizontal?: "left" | "center" | "right" };
    border?: boolean;
  };
  range?: string;
  chart?: {
    type: "bar" | "line" | "pie" | "column";
    title: string;
    dataRange: string;
    position: { row: number; col: number };
  };
  conditionalFormat?: {
    type: "dataBar" | "colorScale" | "iconSet";
    range: string;
    options?: Record<string, unknown>;
  };
}

/**
 * Presentation edit change types
 */
export interface PresentationChange {
  type:
    | "updateSlide"
    | "addSlide"
    | "deleteSlide"
    | "reorderSlides"
    | "updateTitle"
    | "updateContent"
    | "updateNotes"
    | "updateBackground"
    | "duplicateSlide";
  slideIndex?: number;
  newIndex?: number;
  updates?: {
    title?: string;
    subtitle?: string;
    content?: string | string[];
    notes?: string;
    background?: string;
  };
  newSlide?: {
    type: string;
    title?: string;
    content?: string | string[];
  };
}

/**
 * Document edit change types
 */
export interface DocumentChange {
  type:
    | "replaceText"
    | "replaceAllText"
    | "updateSection"
    | "addSection"
    | "deleteSection"
    | "insertSection"
    | "updateStyles";
  searchText?: string;
  replaceWith?: string;
  sectionIndex?: number;
  newSection?: {
    type: "heading1" | "heading2" | "heading3" | "paragraph" | "bullet-list";
    content?: string;
    items?: string[];
  };
  styles?: {
    fontFamily?: string;
    fontSize?: number;
    primaryColor?: string;
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Generate download file helper code using fetch()
 */
function generateDownloadHelperCode(): string {
  return `
// Download file from URL helper using fetch()
async function downloadFile(url, dest) {
  const fs = require('fs');
  const path = require('path');

  // Ensure directory exists
  const dir = path.dirname(dest);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'follow'
    });

    if (!response.ok) {
      throw new Error(\`Failed to download: HTTP \${response.status}\`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    fs.writeFileSync(dest, buffer);
  } catch (err) {
    // Clean up partial file if it exists
    if (fs.existsSync(dest)) {
      fs.unlinkSync(dest);
    }
    throw err;
  }
}
`;
}

// ============================================================================
// Spreadsheet Edit Code Generator (ExcelJS - Full Support)
// ============================================================================

/**
 * Generate code for a single spreadsheet change
 */
function generateSpreadsheetChangeCode(
  change: SpreadsheetChange,
  index: number,
): string {
  const sheetAccess = change.sheetName
    ? `workbook.getWorksheet(${JSON.stringify(change.sheetName)})`
    : "workbook.worksheets[0]";

  switch (change.type) {
    case "updateCell":
      return `
// Change ${index + 1}: Update cell
(() => {
  const ws = ${sheetAccess};
  if (ws) {
    ws.getCell(${change.cell?.row || 1}, ${change.cell?.col || 1}).value = ${JSON.stringify(change.value)};
    console.log('Updated cell (${change.cell?.row},${change.cell?.col}) to:', ${JSON.stringify(change.value)});
  }
})();
`;

    case "updateCells":
      if (!change.cells || change.cells.length === 0) return "";
      return `
// Change ${index + 1}: Update multiple cells
(() => {
  const ws = ${sheetAccess};
  if (ws) {
    const cellUpdates = ${JSON.stringify(change.cells)};
    cellUpdates.forEach(({ row, col, value }) => {
      ws.getCell(row, col).value = value;
    });
    console.log('Updated', cellUpdates.length, 'cells');
  }
})();
`;

    case "addRow":
      return `
// Change ${index + 1}: Add row
(() => {
  const ws = ${sheetAccess};
  if (ws) {
    const newRow = ws.addRow(${JSON.stringify(change.row || {})});
    console.log('Added row at position:', newRow.number);
  }
})();
`;

    case "insertRow":
      return `
// Change ${index + 1}: Insert row at index
(() => {
  const ws = ${sheetAccess};
  if (ws) {
    ws.insertRow(${change.rowIndex || 1}, ${JSON.stringify(change.row || {})});
    console.log('Inserted row at index:', ${change.rowIndex || 1});
  }
})();
`;

    case "deleteRow":
      return `
// Change ${index + 1}: Delete row
(() => {
  const ws = ${sheetAccess};
  if (ws && ${change.rowIndex}) {
    ws.spliceRows(${change.rowIndex}, 1);
    console.log('Deleted row at index:', ${change.rowIndex});
  }
})();
`;

    case "updateColumn":
      return `
// Change ${index + 1}: Update column values
(() => {
  const ws = ${sheetAccess};
  if (ws) {
    const col = ws.getColumn(${JSON.stringify(change.columnKey || "A")});
    col.eachCell((cell, rowNumber) => {
      if (rowNumber > 1) { // Skip header
        cell.value = ${JSON.stringify(change.value)};
      }
    });
    console.log('Updated column:', ${JSON.stringify(change.columnKey)});
  }
})();
`;

    case "addSheet":
      return `
// Change ${index + 1}: Add new sheet
(() => {
  const ws = workbook.addWorksheet(${JSON.stringify(change.newSheetName || "New Sheet")});
  console.log('Added new sheet:', ${JSON.stringify(change.newSheetName)});
})();
`;

    case "deleteSheet":
      return `
// Change ${index + 1}: Delete sheet
(() => {
  const ws = ${sheetAccess};
  if (ws) {
    workbook.removeWorksheet(ws.id);
    console.log('Deleted sheet:', ${JSON.stringify(change.sheetName)});
  }
})();
`;

    case "renameSheet":
      return `
// Change ${index + 1}: Rename sheet
(() => {
  const ws = ${sheetAccess};
  if (ws) {
    ws.name = ${JSON.stringify(change.newSheetName || "Renamed Sheet")};
    console.log('Renamed sheet to:', ${JSON.stringify(change.newSheetName)});
  }
})();
`;

    case "updateStyle":
      const styleCode: string[] = [];
      if (change.style?.font) {
        styleCode.push(`font: ${JSON.stringify(change.style.font)}`);
      }
      if (change.style?.fill) {
        styleCode.push(
          `fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF${change.style.fill.color?.replaceAll("#", "") || "FFFFFF"}' } }`,
        );
      }
      if (change.style?.alignment) {
        styleCode.push(`alignment: ${JSON.stringify(change.style.alignment)}`);
      }
      return `
// Change ${index + 1}: Update cell style
(() => {
  const ws = ${sheetAccess};
  if (ws && ${JSON.stringify(change.range)}) {
    const range = ${JSON.stringify(change.range)};
    // Parse range and apply styles
    const cell = ws.getCell(${change.cell?.row || 1}, ${change.cell?.col || 1});
    Object.assign(cell, { ${styleCode.join(", ")} });
    console.log('Updated style for range:', range);
  }
})();
`;

    case "addConditionalFormatting":
      if (!change.conditionalFormat) return "";
      return `
// Change ${index + 1}: Add conditional formatting
(() => {
  const ws = ${sheetAccess};
  if (ws) {
    ws.addConditionalFormatting({
      ref: ${JSON.stringify(change.conditionalFormat.range)},
      rules: [{
        type: ${JSON.stringify(change.conditionalFormat.type)},
        priority: 1,
        ${change.conditionalFormat.type === "dataBar" ? `dataBar: { color: { argb: 'FF4F46E5' }, showValue: true }` : ""}
        ${change.conditionalFormat.type === "colorScale" ? `colorScale: { cfvo: [{ type: 'min' }, { type: 'max' }], color: [{ argb: 'FFF87171' }, { argb: 'FF4ADE80' }] }` : ""}
      }]
    });
    console.log('Added conditional formatting to:', ${JSON.stringify(change.conditionalFormat.range)});
  }
})();
`;

    default:
      return `// Unknown change type: ${change.type}`;
  }
}

/**
 * Generate complete spreadsheet edit code
 */
export function generateSpreadsheetEditCode(
  fileUrl: string,
  changes: SpreadsheetChange[],
  outputFileName?: string,
): string {
  const safeOutputName = outputFileName || "edited_spreadsheet.xlsx";

  return `
// Install exceljs if not available
const { execSync } = require('child_process');
try {
  require.resolve('exceljs');
} catch (e) {
  console.log('Installing exceljs...');
  execSync('npm install exceljs --no-save --silent 2>/dev/null || npm install exceljs --no-save', { 
    stdio: 'pipe',
    cwd: '/home/user'
  });
  console.log('exceljs installed successfully');
}

const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');

${generateDownloadHelperCode()}

async function editSpreadsheet() {
  console.log('Starting spreadsheet edit...');
  console.log('Downloading from:', ${JSON.stringify(fileUrl)});

  const inputPath = '/home/user/input.xlsx';
  const outputPath = '/home/user/${safeOutputName}';

  try {
    // Download the existing file
    await downloadFile(${JSON.stringify(fileUrl)}, inputPath);
    console.log('Downloaded file successfully');

    // Load workbook
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(inputPath);
    console.log('Loaded workbook with', workbook.worksheets.length, 'sheets');

    // Apply changes
    ${changes.map((c, i) => generateSpreadsheetChangeCode(c, i)).join("\n")}

    // Save modified workbook
    await workbook.xlsx.writeFile(outputPath);
    console.log('Spreadsheet edited successfully');
    console.log('Saved to:', outputPath);

  } catch (error) {
    console.error('Error editing spreadsheet:', error.message);
    throw error;
  }
}

editSpreadsheet();
`;
}

// ============================================================================
// Presentation Edit Code Generator (JSZip + PptxGenJS)
// ============================================================================

/**
 * Generate code for presentation changes
 * Note: PptxGenJS has limited read support, so we use JSZip to parse
 * and then recreate slides with modifications
 */
function generatePresentationChangeCode(
  change: PresentationChange,
  index: number,
): string {
  switch (change.type) {
    case "updateSlide":
      return `
// Change ${index + 1}: Update slide ${change.slideIndex}
(() => {
  if (slides[${change.slideIndex || 0}]) {
    ${change.updates?.title ? `slides[${change.slideIndex || 0}].title = ${JSON.stringify(change.updates.title)};` : ""}
    ${change.updates?.content ? `slides[${change.slideIndex || 0}].content = ${JSON.stringify(change.updates.content)};` : ""}
    ${change.updates?.notes ? `slides[${change.slideIndex || 0}].notes = ${JSON.stringify(change.updates.notes)};` : ""}
    console.log('Updated slide ${change.slideIndex}');
  }
})();
`;

    case "addSlide":
      return `
// Change ${index + 1}: Add new slide
(() => {
  slides.push(${JSON.stringify(change.newSlide || { type: "content", title: "New Slide" })});
  console.log('Added new slide');
})();
`;

    case "deleteSlide":
      return `
// Change ${index + 1}: Delete slide ${change.slideIndex}
(() => {
  if (${change.slideIndex !== undefined} && slides[${change.slideIndex}]) {
    slides.splice(${change.slideIndex}, 1);
    console.log('Deleted slide ${change.slideIndex}');
  }
})();
`;

    case "reorderSlides":
      return `
// Change ${index + 1}: Reorder slides
(() => {
  if (${change.slideIndex !== undefined} && ${change.newIndex !== undefined}) {
    const [slide] = slides.splice(${change.slideIndex}, 1);
    slides.splice(${change.newIndex}, 0, slide);
    console.log('Moved slide from ${change.slideIndex} to ${change.newIndex}');
  }
})();
`;

    case "duplicateSlide":
      return `
// Change ${index + 1}: Duplicate slide ${change.slideIndex}
(() => {
  if (slides[${change.slideIndex || 0}]) {
    const copy = JSON.parse(JSON.stringify(slides[${change.slideIndex || 0}]));
    slides.splice(${(change.slideIndex || 0) + 1}, 0, copy);
    console.log('Duplicated slide ${change.slideIndex}');
  }
})();
`;

    default:
      return `// Unknown change type: ${change.type}`;
  }
}

/**
 * Generate complete presentation edit code
 * This parses the existing PPTX, extracts content, applies changes,
 * and recreates the presentation with PptxGenJS
 */
export function generatePresentationEditCode(
  fileUrl: string,
  changes: PresentationChange[],
  outputFileName?: string,
  paletteName?: string,
): string {
  const safeOutputName = outputFileName || "edited_presentation.pptx";
  const palette = getPalette(paletteName || "gamma-dark");

  return `
// Install required packages if not available
const { execSync } = require('child_process');
const packagesToInstall = [];

try { require.resolve('pptxgenjs'); } catch (e) { packagesToInstall.push('pptxgenjs'); }
try { require.resolve('jszip'); } catch (e) { packagesToInstall.push('jszip'); }
try { require.resolve('xmldom'); } catch (e) { packagesToInstall.push('@xmldom/xmldom'); }

if (packagesToInstall.length > 0) {
  console.log('Installing packages:', packagesToInstall.join(', '));
  execSync('npm install ' + packagesToInstall.join(' ') + ' --no-save --silent 2>/dev/null || npm install ' + packagesToInstall.join(' ') + ' --no-save', { 
    stdio: 'pipe',
    cwd: '/home/user'
  });
  console.log('Packages installed successfully');
}

const PptxGenJS = require('pptxgenjs');
const JSZip = require('jszip');
const fs = require('fs');
const path = require('path');
const { DOMParser } = require('@xmldom/xmldom');

${generateDownloadHelperCode()}

// Parse PPTX and extract slide content
async function parsePptx(filePath) {
  const data = fs.readFileSync(filePath);
  const zip = await JSZip.loadAsync(data);

  const slides = [];

  // Find all slide XML files
  const slideFiles = Object.keys(zip.files)
    .filter(name => name.match(/ppt\/slides\/slide\d+\.xml$/))
    .sort((a, b) => {
      const numA = Number.parseInt(a.match(/slide(\d+)/)?.[1] || '0');
      const numB = Number.parseInt(b.match(/slide(\d+)/)?.[1] || '0');
      return numA - numB;
    });

  for (const slideFile of slideFiles) {
    const xmlContent = await zip.file(slideFile).async('string');
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlContent, 'application/xml');

    // Extract text content from slide
    const textElements = doc.getElementsByTagName('a:t');
    const texts = [];
    for (let i = 0; i < textElements.length; i++) {
      const text = textElements[i].textContent?.trim();
      if (text) texts.push(text);
    }

    slides.push({
      type: 'content',
      title: texts[0] || '',
      content: texts.slice(1),
      originalTexts: texts
    });
  }

  return slides;
}

// Recreate presentation with modifications
function createPresentation(slides, palette) {
  const pptx = new PptxGenJS();
  pptx.author = 'Shadower AI';
  pptx.title = 'Edited Presentation';

  // Define master slide
  pptx.defineSlideMaster({
    title: 'MAIN',
    background: { color: '${palette.background}' },
  });

  // Create slides
  slides.forEach((slideData, index) => {
    const slide = pptx.addSlide({ masterName: 'MAIN' });

    // Add title
    if (slideData.title) {
      slide.addText(slideData.title, {
        x: 0.5,
        y: 0.5,
        w: '90%',
        h: 1,
        fontSize: 36,
        bold: true,
        color: '${palette.text}',
        fontFace: 'Arial',
      });
    }

    // Add content
    if (slideData.content) {
      const content = Array.isArray(slideData.content)
        ? slideData.content.join('\n• ')
        : slideData.content;

      slide.addText(content.startsWith('• ') ? content : '• ' + content, {
        x: 0.5,
        y: 1.8,
        w: '90%',
        h: 3.5,
        fontSize: 18,
        color: '${palette.textMuted}',
        fontFace: 'Arial',
        bullet: false,
        valign: 'top',
      });
    }

    // Add notes if present
    if (slideData.notes) {
      slide.addNotes(slideData.notes);
    }
  });

  return pptx;
}

async function editPresentation() {
  console.log('Starting presentation edit...');
  console.log('Downloading from:', ${JSON.stringify(fileUrl)});

  const inputPath = '/home/user/input.pptx';
  const outputPath = '/home/user/${safeOutputName}';

  try {
    // Download the existing file
    await downloadFile(${JSON.stringify(fileUrl)}, inputPath);
    console.log('Downloaded file successfully');

    // Parse existing presentation
    let slides = await parsePptx(inputPath);
    console.log('Parsed', slides.length, 'slides');

    // Apply changes
    ${changes.map((c, i) => generatePresentationChangeCode(c, i)).join("\n")}

    // Recreate presentation with modifications
    const palette = ${JSON.stringify(palette)};
    const pptx = createPresentation(slides, palette);

    // Save modified presentation
    await pptx.writeFile({ fileName: outputPath });
    console.log('Presentation edited successfully');
    console.log('Saved to:', outputPath);

  } catch (error) {
    console.error('Error editing presentation:', error.message);
    throw error;
  }
}

editPresentation();
`;
}

// ============================================================================
// Document Edit Code Generator (mammoth + docx)
// ============================================================================

/**
 * Generate code for document changes
 */
function generateDocumentChangeCode(
  change: DocumentChange,
  index: number,
): string {
  switch (change.type) {
    case "replaceText":
      return `
// Change ${index + 1}: Replace text
(() => {
  const searchText = ${JSON.stringify(change.searchText || "")};
  const replaceWith = ${JSON.stringify(change.replaceWith || "")};

  documentContent = documentContent.replace(searchText, replaceWith);
  console.log('Replaced:', searchText, 'with:', replaceWith);
})();
`;

    case "replaceAllText": {
      // Use String.raw to avoid escaping backslashes in regex pattern
      // Pattern matches: . * + ? ^ $ { } ( ) | [ ] \
      const escapePattern = String.raw`[.*+?^$\{\}()|[\]\\]`;
      const escapeReplacement = String.raw`\$&`;
      return `
// Change ${index + 1}: Replace all occurrences
(() => {
  const searchText = ${JSON.stringify(change.searchText || "")};
  const replaceWith = ${JSON.stringify(change.replaceWith || "")};
  const escapeRegex = new RegExp(${JSON.stringify(escapePattern)}, 'g');
  const regex = new RegExp(searchText.replace(escapeRegex, ${JSON.stringify(escapeReplacement)}), 'g');

  documentContent = documentContent.replace(regex, replaceWith);
  console.log('Replaced all occurrences of:', searchText);
})();
`;
    }

    case "addSection":
      return `
// Change ${index + 1}: Add section
(() => {
  const newSection = ${JSON.stringify(change.newSection || { type: "paragraph", content: "" })};
  sections.push(newSection);
  console.log('Added section:', newSection.type);
})();
`;

    case "deleteSection":
      return `
// Change ${index + 1}: Delete section
(() => {
  if (${change.sectionIndex !== undefined} && sections[${change.sectionIndex}]) {
    sections.splice(${change.sectionIndex}, 1);
    console.log('Deleted section at index:', ${change.sectionIndex});
  }
})();
`;

    case "updateSection":
      return `
// Change ${index + 1}: Update section
(() => {
  if (sections[${change.sectionIndex || 0}]) {
    sections[${change.sectionIndex || 0}] = {
      ...sections[${change.sectionIndex || 0}],
      ...${JSON.stringify(change.newSection || {})}
    };
    console.log('Updated section at index:', ${change.sectionIndex});
  }
})();
`;

    case "insertSection":
      return `
// Change ${index + 1}: Insert section at index
(() => {
  const newSection = ${JSON.stringify(change.newSection || { type: "paragraph", content: "" })};
  sections.splice(${change.sectionIndex || 0}, 0, newSection);
  console.log('Inserted section at index:', ${change.sectionIndex});
})();
`;

    default:
      return `// Unknown change type: ${change.type}`;
  }
}

/**
 * Generate complete document edit code
 * Uses mammoth.js to read DOCX and extract content,
 * then recreates with docx library
 */
export function generateDocumentEditCode(
  fileUrl: string,
  changes: DocumentChange[],
  outputFileName?: string,
  paletteName?: string,
): string {
  const safeOutputName = outputFileName || "edited_document.docx";
  const palette = getPalette(paletteName || "gamma-light");

  return `
// Install required packages if not available
const { execSync } = require('child_process');
const packagesToInstall = [];

try { require.resolve('mammoth'); } catch (e) { packagesToInstall.push('mammoth'); }
try { require.resolve('docx'); } catch (e) { packagesToInstall.push('docx'); }

if (packagesToInstall.length > 0) {
  console.log('Installing packages:', packagesToInstall.join(', '));
  execSync('npm install ' + packagesToInstall.join(' ') + ' --no-save --silent 2>/dev/null || npm install ' + packagesToInstall.join(' ') + ' --no-save', { 
    stdio: 'pipe',
    cwd: '/home/user'
  });
  console.log('Packages installed successfully');
}

const mammoth = require('mammoth');
const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } = require('docx');
const fs = require('fs');
const path = require('path');

${generateDownloadHelperCode()}

// Parse DOCX and extract content
async function parseDocx(filePath) {
  const result = await mammoth.extractRawText({ path: filePath });
  const text = result.value;

  // Split into sections based on common patterns
  const lines = text.split('\n').filter(line => line.trim());

  const sections = lines.map(line => {
    // Detect headings (usually uppercase or short lines)
    if (line === line.toUpperCase() && line.length < 100) {
      return { type: 'heading1', content: line };
    } else if (line.startsWith('• ') || line.startsWith('- ')) {
      return { type: 'bullet-list', items: [line.replace(/^[•-]\s*/, '')] };
    } else {
      return { type: 'paragraph', content: line };
    }
  });

  return { sections, rawText: text };
}

// Recreate document with modifications
function createDocument(sections, title, palette) {
  const children = [];

  // Add title
  children.push(
    new Paragraph({
      text: title,
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
    })
  );

  // Add sections
  sections.forEach(section => {
    if (section.type === 'heading1') {
      children.push(
        new Paragraph({
          text: section.content,
          heading: HeadingLevel.HEADING_1,
        })
      );
    } else if (section.type === 'heading2') {
      children.push(
        new Paragraph({
          text: section.content,
          heading: HeadingLevel.HEADING_2,
        })
      );
    } else if (section.type === 'paragraph') {
      children.push(
        new Paragraph({
          children: [
            new TextRun({
              text: section.content,
              size: 24,
            }),
          ],
        })
      );
    } else if (section.type === 'bullet-list' && section.items) {
      section.items.forEach(item => {
        children.push(
          new Paragraph({
            text: item,
            bullet: { level: 0 },
          })
        );
      });
    }
  });

  return new Document({
    creator: 'Shadower AI',
    title: title,
    sections: [{
      children: children,
    }],
  });
}

async function editDocument() {
  console.log('Starting document edit...');
  console.log('Downloading from:', ${JSON.stringify(fileUrl)});

  const inputPath = '/home/user/input.docx';
  const outputPath = '/home/user/${safeOutputName}';

  try {
    // Download the existing file
    await downloadFile(${JSON.stringify(fileUrl)}, inputPath);
    console.log('Downloaded file successfully');

    // Parse existing document
    let { sections, rawText } = await parseDocx(inputPath);
    let documentContent = rawText;
    console.log('Parsed document with', sections.length, 'sections');

    // Apply changes
    ${changes.map((c, i) => generateDocumentChangeCode(c, i)).join("\n")}

    // Recreate document with modifications
    const palette = ${JSON.stringify(palette)};
    const doc = createDocument(sections, 'Edited Document', palette);

    // Save modified document
    const buffer = await Packer.toBuffer(doc);
    fs.writeFileSync(outputPath, buffer);
    console.log('Document edited successfully');
    console.log('Saved to:', outputPath);

  } catch (error) {
    console.error('Error editing document:', error.message);
    throw error;
  }
}

editDocument();
`;
}

// ============================================================================
// Exports
// ============================================================================

export {
  generateDownloadHelperCode,
  generateSpreadsheetChangeCode,
  generatePresentationChangeCode,
  generateDocumentChangeCode,
};
