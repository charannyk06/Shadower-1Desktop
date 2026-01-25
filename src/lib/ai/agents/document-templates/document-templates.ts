/**
 * Professional Word document templates using docx npm package
 * Creates stunning documents with TOC, headers/footers, images, and professional styling
 * Enhanced with real image support and advanced formatting
 */

import { ColorPalette, getPalette } from "./color-palettes";

// Document template types
export type DocumentTemplateType =
  | "report"
  | "proposal"
  | "academic"
  | "memo"
  | "letter"
  | "minimal";

// Document section types
export type SectionType =
  | "cover"
  | "toc"
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
  | "columns"
  | "page-break";

// Advanced table configuration
export interface TableCellConfig {
  content: string;
  colspan?: number;
  rowspan?: number;
  bold?: boolean;
  italic?: boolean;
  align?: "left" | "center" | "right";
  bgColor?: string;
  textColor?: string;
}

export interface AdvancedTableData {
  headers: string[] | TableCellConfig[];
  rows: (string | TableCellConfig)[][];
  style?: "default" | "striped" | "bordered" | "minimal" | "colored";
  headerStyle?: "primary" | "dark" | "light" | "accent";
  columnWidths?: number[]; // percentages
  caption?: string;
  totalRow?: boolean; // Add a total row with bold styling
}

// Document section interface
export interface DocumentSection {
  type: SectionType;
  content?: string;
  items?: string[];
  tableData?: {
    headers: string[];
    rows: string[][];
  };
  advancedTable?: AdvancedTableData; // New advanced table option
  imageUrl?: string;
  imageCaption?: string;
  imageWidth?: number; // in pixels (default 400)
  imageHeight?: number; // in pixels (default 300)
  imagePosition?: "left" | "center" | "right" | "inline";
  level?: number;
  calloutType?: "info" | "warning" | "success" | "error";
  columns?: Array<{
    content: string;
    width?: number; // percentage
  }>;
}

// Document options
export interface DocumentOptions {
  template: DocumentTemplateType;
  title: string;
  subtitle?: string;
  author?: string;
  company?: string;
  date?: string;
  includeToc?: boolean;
  includeCoverPage?: boolean;
  includeHeaderFooter?: boolean;
  paletteName?: string;
  logoUrl?: string;
}

// Font configurations for document templates
export const DOCUMENT_FONTS = {
  report: {
    heading: "Arial",
    body: "Times New Roman",
    mono: "Courier New",
  },
  proposal: {
    heading: "Calibri",
    body: "Calibri",
    mono: "Consolas",
  },
  academic: {
    heading: "Times New Roman",
    body: "Times New Roman",
    mono: "Courier New",
  },
  memo: {
    heading: "Arial",
    body: "Arial",
    mono: "Courier New",
  },
  letter: {
    heading: "Georgia",
    body: "Georgia",
    mono: "Courier New",
  },
  minimal: {
    heading: "Helvetica",
    body: "Helvetica",
    mono: "Monaco",
  },
};

// Spacing configurations (in twips: 1 inch = 1440 twips)
export const SPACING = {
  paragraph: {
    before: 120, // 0.08 inches
    after: 200, // 0.14 inches
    line: 276, // 1.15 line spacing
  },
  heading1: {
    before: 360, // 0.25 inches
    after: 200,
    line: 240,
  },
  heading2: {
    before: 280,
    after: 160,
    line: 240,
  },
  heading3: {
    before: 200,
    after: 120,
    line: 240,
  },
};

// Callout icons and colors
export const CALLOUT_STYLES = {
  info: { icon: "ℹ️", color: "2196F3", bgColor: "E3F2FD" },
  warning: { icon: "⚠️", color: "FF9800", bgColor: "FFF3E0" },
  success: { icon: "✅", color: "4CAF50", bgColor: "E8F5E9" },
  error: { icon: "❌", color: "F44336", bgColor: "FFEBEE" },
};

/**
 * Generate code to fetch images as base64 for embedding in documents
 */
export function generateImageFetchingCode(
  sections: DocumentSection[],
  logoUrl?: string,
): { code: string; imageVarMap: Map<number, string> } {
  const imageSections = sections.filter(
    (s) => (s.type === "image" || s.type === "image-text") && s.imageUrl,
  );
  const imageVarMap = new Map<number, string>();

  if (imageSections.length === 0 && !logoUrl) {
    return { code: "", imageVarMap };
  }

  let code = `
// ============================================
// Image Fetching - Download and encode images
// ============================================

// Helper function to fetch image as base64 using fetch()
async function fetchImageAsBase64(url) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    const response = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'image/*,*/*'
      }
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error('HTTP ' + response.status);
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const contentType = response.headers.get('content-type') || 'image/png';

    return {
      base64: buffer.toString('base64'),
      buffer: buffer,
      contentType: contentType,
      width: null,
      height: null
    };
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error('Request timeout');
    }
    throw err;
  }
}

// Fetch all images concurrently
const imageResults = {};

async function fetchAllImages() {
  const imageFetches = [];
`;

  // Add logo fetch if provided
  if (logoUrl) {
    code += `
  // Fetch logo
  imageFetches.push(
    fetchImageAsBase64(${JSON.stringify(logoUrl)})
      .then(result => { imageResults.logo = result; })
      .catch(err => {
        console.warn('Failed to fetch logo:', err.message);
        imageResults.logo = null;
      })
  );
`;
  }

  // Add image fetches for each section
  sections.forEach((section, index) => {
    if (
      (section.type === "image" || section.type === "image-text") &&
      section.imageUrl
    ) {
      const varName = `image_${index}`;
      imageVarMap.set(index, varName);
      code += `
  // Fetch image for section ${index}
  imageFetches.push(
    fetchImageAsBase64(${JSON.stringify(section.imageUrl)})
      .then(result => { imageResults.${varName} = result; })
      .catch(err => {
        console.warn('Failed to fetch image ${index}:', err.message);
        imageResults.${varName} = null;
      })
  );
`;
    }
  });

  code += `
  await Promise.all(imageFetches);
  console.log('Fetched', Object.keys(imageResults).filter(k => imageResults[k]).length, 'images successfully');
}

`;

  return { code, imageVarMap };
}

/**
 * Generate image paragraph code with proper embedding
 */
export function generateImageCode(
  section: DocumentSection,
  imageVarName: string,
  template: DocumentTemplateType,
  palette: ColorPalette,
): string {
  const width = section.imageWidth || 400;
  const height = section.imageHeight || 300;
  const position = section.imagePosition || "center";
  const caption = section.imageCaption;

  const alignment = (() => {
    if (position === "left") return "AlignmentType.LEFT";
    if (position === "right") return "AlignmentType.RIGHT";
    return "AlignmentType.CENTER";
  })();

  let code = `
// Image section
(() => {
  const imgData = imageResults.${imageVarName};
  if (imgData && imgData.buffer) {
    // Add the image
    documentChildren.push(
      new Paragraph({
        children: [
          new ImageRun({
            data: imgData.buffer,
            transformation: {
              width: ${width},
              height: ${height},
            },
            type: 'png',
          }),
        ],
        alignment: ${alignment},
        spacing: { before: 200, after: ${caption ? "100" : "200"} },
      })
    );
`;

  if (caption) {
    code += `
    // Image caption
    documentChildren.push(
      new Paragraph({
        children: [
          new TextRun({
            text: ${JSON.stringify(caption)},
            font: '${DOCUMENT_FONTS[template].body}',
            size: 20,
            italics: true,
            color: '${palette.textMuted}',
          }),
        ],
        alignment: ${alignment},
        spacing: { after: 200 },
      })
    );
`;
  }

  code += `
  } else {
    // Fallback placeholder if image failed to load
    documentChildren.push(
      new Paragraph({
        children: [
          new TextRun({
            text: '[Image: ${caption || "Image could not be loaded"}]',
            font: '${DOCUMENT_FONTS[template].body}',
            size: 22,
            italics: true,
            color: '${palette.textMuted}',
          }),
        ],
        alignment: ${alignment},
        spacing: { before: 200, after: 200 },
        shading: { fill: '${palette.surface}', type: ShadingType.SOLID },
      })
    );
  }
})();
`;

  return code;
}

/**
 * Generate image with text side by side
 */
export function generateImageTextCode(
  section: DocumentSection,
  imageVarName: string,
  template: DocumentTemplateType,
  palette: ColorPalette,
): string {
  const width = section.imageWidth || 250;
  const height = section.imageHeight || 200;
  const content = section.content || "";
  const position = section.imagePosition || "left";
  const caption = section.imageCaption;

  // Use a table for side-by-side layout
  const imageFirst = position === "left";

  const code = `
// Image with text section
(() => {
  const imgData = imageResults.${imageVarName};

  const imageCell = imgData && imgData.buffer ?
    new TableCell({
      children: [
        new Paragraph({
          children: [
            new ImageRun({
              data: imgData.buffer,
              transformation: { width: ${width}, height: ${height} },
              type: 'png',
            }),
          ],
          alignment: AlignmentType.CENTER,
        }),
        ${
          caption
            ? `
        new Paragraph({
          children: [
            new TextRun({
              text: ${JSON.stringify(caption)},
              font: '${DOCUMENT_FONTS[template].body}',
              size: 18,
              italics: true,
              color: '${palette.textMuted}',
            }),
          ],
          alignment: AlignmentType.CENTER,
        }),`
            : ""
        }
      ],
      width: { size: 40, type: WidthType.PERCENTAGE },
      verticalAlign: VerticalAlign.CENTER,
      borders: {
        top: { style: BorderStyle.NONE },
        bottom: { style: BorderStyle.NONE },
        left: { style: BorderStyle.NONE },
        right: { style: BorderStyle.NONE },
      },
    }) :
    new TableCell({
      children: [
        new Paragraph({
          children: [
            new TextRun({
              text: '[Image placeholder]',
              italics: true,
              color: '${palette.textMuted}',
            }),
          ],
          alignment: AlignmentType.CENTER,
        }),
      ],
      width: { size: 40, type: WidthType.PERCENTAGE },
      verticalAlign: VerticalAlign.CENTER,
      shading: { fill: '${palette.surface}', type: ShadingType.SOLID },
      borders: {
        top: { style: BorderStyle.NONE },
        bottom: { style: BorderStyle.NONE },
        left: { style: BorderStyle.NONE },
        right: { style: BorderStyle.NONE },
      },
    });

  const textCell = new TableCell({
    children: [
      new Paragraph({
        children: [
          new TextRun({
            text: ${JSON.stringify(content)},
            font: '${DOCUMENT_FONTS[template].body}',
            size: 24,
            color: '${palette.text}',
          }),
        ],
        spacing: { line: 276 },
      }),
    ],
    width: { size: 60, type: WidthType.PERCENTAGE },
    verticalAlign: VerticalAlign.CENTER,
    borders: {
      top: { style: BorderStyle.NONE },
      bottom: { style: BorderStyle.NONE },
      left: { style: BorderStyle.NONE },
      right: { style: BorderStyle.NONE },
    },
  });

  documentChildren.push(
    new Table({
      rows: [
        new TableRow({
          children: ${imageFirst ? "[imageCell, textCell]" : "[textCell, imageCell]"},
        }),
      ],
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: {
        top: { style: BorderStyle.NONE },
        bottom: { style: BorderStyle.NONE },
        left: { style: BorderStyle.NONE },
        right: { style: BorderStyle.NONE },
        insideHorizontal: { style: BorderStyle.NONE },
        insideVertical: { style: BorderStyle.NONE },
      },
    })
  );
  documentChildren.push(new Paragraph({ spacing: { after: 200 } }));
})();
`;

  return code;
}

// Generate cover page code
export function generateCoverPageCode(
  options: DocumentOptions,
  palette: ColorPalette,
  hasLogo: boolean,
): string {
  const safeCompany = options.company ? JSON.stringify(options.company) : null;
  const safeTitle = JSON.stringify(options.title);
  const safeSubtitle = options.subtitle
    ? JSON.stringify(options.subtitle)
    : null;
  const safeAuthor = options.author
    ? JSON.stringify(`Prepared by: ${options.author}`)
    : null;
  const safeDate = JSON.stringify(
    options.date || new Date().toLocaleDateString(),
  );

  let code = `
// Cover Page
const coverPageChildren = [];

// Add spacing at top
coverPageChildren.push(
  new Paragraph({ spacing: { before: 2000 } })
);
`;

  // Add logo if available
  if (hasLogo) {
    code += `
// Company logo
if (imageResults.logo && imageResults.logo.buffer) {
  coverPageChildren.push(
    new Paragraph({
      children: [
        new ImageRun({
          data: imageResults.logo.buffer,
          transformation: { width: 150, height: 60 },
          type: 'png',
        }),
      ],
      alignment: AlignmentType.CENTER,
      spacing: { after: 600 },
    })
  );
}
`;
  }

  code += `
// Company name (if provided)
${
  safeCompany
    ? `
coverPageChildren.push(
  new Paragraph({
    children: [
      new TextRun({
        text: ${safeCompany},
        font: '${DOCUMENT_FONTS[options.template].heading}',
        size: 24,
        color: '${palette.textMuted}',
      }),
    ],
    alignment: AlignmentType.CENTER,
    spacing: { after: 400 },
  })
);`
    : ""
}

// Main title
coverPageChildren.push(
  new Paragraph({
    children: [
      new TextRun({
        text: ${safeTitle},
        font: '${DOCUMENT_FONTS[options.template].heading}',
        size: 72,
        bold: true,
        color: '${palette.primary}',
      }),
    ],
    alignment: AlignmentType.CENTER,
    spacing: { after: 200 },
  })
);

// Subtitle
${
  safeSubtitle
    ? `
coverPageChildren.push(
  new Paragraph({
    children: [
      new TextRun({
        text: ${safeSubtitle},
        font: '${DOCUMENT_FONTS[options.template].body}',
        size: 32,
        color: '${palette.textMuted}',
      }),
    ],
    alignment: AlignmentType.CENTER,
    spacing: { after: 800 },
  })
);`
    : ""
}

// Decorative line
coverPageChildren.push(
  new Paragraph({
    children: [
      new TextRun({
        text: '━━━━━━━━━━━━━━━━━━━━',
        font: '${DOCUMENT_FONTS[options.template].heading}',
        size: 28,
        color: '${palette.accent}',
      }),
    ],
    alignment: AlignmentType.CENTER,
    spacing: { after: 800 },
  })
);

// Author
${
  safeAuthor
    ? `
coverPageChildren.push(
  new Paragraph({
    children: [
      new TextRun({
        text: ${safeAuthor},
        font: '${DOCUMENT_FONTS[options.template].body}',
        size: 24,
        color: '${palette.text}',
      }),
    ],
    alignment: AlignmentType.CENTER,
    spacing: { after: 100 },
  })
);`
    : ""
}

// Date
coverPageChildren.push(
  new Paragraph({
    children: [
      new TextRun({
        text: ${safeDate},
        font: '${DOCUMENT_FONTS[options.template].body}',
        size: 22,
        color: '${palette.textMuted}',
      }),
    ],
    alignment: AlignmentType.CENTER,
  })
);

// Page break after cover
coverPageChildren.push(new Paragraph({ children: [new PageBreak()] }));
`;

  return code;
}

// Generate Table of Contents code
export function generateTocCode(palette: ColorPalette): string {
  return `
// Table of Contents
const tocChildren = [];

tocChildren.push(
  new Paragraph({
    children: [
      new TextRun({
        text: 'Table of Contents',
        bold: true,
        size: 36,
        color: '${palette.primary}',
      }),
    ],
    heading: HeadingLevel.HEADING_1,
    spacing: { after: 400 },
  })
);

// TOC field - automatically generates from headings
tocChildren.push(
  new TableOfContents('Table of Contents', {
    hyperlink: true,
    headingStyleRange: '1-3',
    stylesWithLevels: [
      { styleName: 'Heading 1', level: 1 },
      { styleName: 'Heading 2', level: 2 },
      { styleName: 'Heading 3', level: 3 },
    ],
  })
);

tocChildren.push(new Paragraph({ children: [new PageBreak()] }));
`;
}

// Generate heading code
export function generateHeadingCode(
  content: string,
  level: 1 | 2 | 3,
  palette: ColorPalette,
  template: DocumentTemplateType,
): string {
  const sizes = { 1: 32, 2: 26, 3: 22 };
  const headingLevels = {
    1: "HeadingLevel.HEADING_1",
    2: "HeadingLevel.HEADING_2",
    3: "HeadingLevel.HEADING_3",
  };
  const spacing =
    level === 1
      ? SPACING.heading1
      : level === 2
        ? SPACING.heading2
        : SPACING.heading3;
  const safeContent = JSON.stringify(content);

  return `
new Paragraph({
  children: [
    new TextRun({
      text: ${safeContent},
      font: '${DOCUMENT_FONTS[template].heading}',
      size: ${sizes[level]},
      bold: true,
      color: '${level === 1 ? palette.primary : palette.text}',
    }),
  ],
  heading: ${headingLevels[level]},
  spacing: { before: ${spacing.before}, after: ${spacing.after} },
}),`;
}

// Generate paragraph code
export function generateParagraphCode(
  content: string,
  template: DocumentTemplateType,
  palette: ColorPalette,
): string {
  const safeContent = JSON.stringify(content);

  return `
new Paragraph({
  children: [
    new TextRun({
      text: ${safeContent},
      font: '${DOCUMENT_FONTS[template].body}',
      size: 24,
      color: '${palette.text}',
    }),
  ],
  spacing: { before: ${SPACING.paragraph.before}, after: ${SPACING.paragraph.after}, line: ${SPACING.paragraph.line} },
}),`;
}

// Generate bullet list code
export function generateBulletListCode(
  items: string[],
  template: DocumentTemplateType,
  palette: ColorPalette,
): string {
  return items
    .map(
      (item) => `
new Paragraph({
  children: [
    new TextRun({
      text: ${JSON.stringify(item)},
      font: '${DOCUMENT_FONTS[template].body}',
      size: 24,
      color: '${palette.text}',
    }),
  ],
  bullet: { level: 0 },
  spacing: { before: 60, after: 60 },
}),`,
    )
    .join("");
}

// Generate numbered list code
export function generateNumberedListCode(
  items: string[],
  template: DocumentTemplateType,
  palette: ColorPalette,
): string {
  return items
    .map(
      (item) => `
new Paragraph({
  children: [
    new TextRun({
      text: ${JSON.stringify(item)},
      font: '${DOCUMENT_FONTS[template].body}',
      size: 24,
      color: '${palette.text}',
    }),
  ],
  numbering: { reference: 'default-numbering', level: 0 },
  spacing: { before: 60, after: 60 },
}),`,
    )
    .join("");
}

// Generate table code with advanced styling
export function generateTableCode(
  headers: string[],
  rows: string[][],
  palette: ColorPalette,
  template: DocumentTemplateType,
): string {
  const headerCells = headers
    .map(
      (h) => `
        new TableCell({
          children: [
            new Paragraph({
              children: [
                new TextRun({
                  text: ${JSON.stringify(h)},
                  bold: true,
                  font: '${DOCUMENT_FONTS[template].heading}',
                  size: 22,
                  color: '${palette.textInverse}',
                }),
              ],
              alignment: AlignmentType.CENTER,
            }),
          ],
          shading: { fill: '${palette.primary}', type: ShadingType.SOLID },
          verticalAlign: VerticalAlign.CENTER,
          margins: { top: 80, bottom: 80, left: 120, right: 120 },
        })`,
    )
    .join(",");

  const dataRows = rows
    .map(
      (row, rowIndex) => `
      new TableRow({
        children: [${row
          .map(
            (cell) => `
          new TableCell({
            children: [
              new Paragraph({
                children: [
                  new TextRun({
                    text: ${JSON.stringify(cell)},
                    font: '${DOCUMENT_FONTS[template].body}',
                    size: 20,
                    color: '${palette.text}',
                  }),
                ],
              }),
            ],
            shading: { fill: '${rowIndex % 2 === 0 ? palette.surface : palette.background}', type: ShadingType.SOLID },
            margins: { top: 60, bottom: 60, left: 120, right: 120 },
          })`,
          )
          .join(",")}
        ],
      })`,
    )
    .join(",");

  return `
new Table({
  rows: [
    new TableRow({
      children: [${headerCells}
      ],
      tableHeader: true,
    }),${dataRows}
  ],
  width: { size: 100, type: WidthType.PERCENTAGE },
  borders: {
    top: { style: BorderStyle.SINGLE, size: 1, color: '${palette.textMuted}' },
    bottom: { style: BorderStyle.SINGLE, size: 1, color: '${palette.textMuted}' },
    left: { style: BorderStyle.SINGLE, size: 1, color: '${palette.textMuted}' },
    right: { style: BorderStyle.SINGLE, size: 1, color: '${palette.textMuted}' },
    insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: '${palette.textMuted}' },
    insideVertical: { style: BorderStyle.SINGLE, size: 1, color: '${palette.textMuted}' },
  },
}),
new Paragraph({ spacing: { after: 200 } }),`;
}

// Generate advanced table with merged cells, custom styling, and more options
export function generateAdvancedTableCode(
  tableData: AdvancedTableData,
  palette: ColorPalette,
  template: DocumentTemplateType,
): string {
  const {
    headers,
    rows,
    style = "default",
    headerStyle = "primary",
    columnWidths,
    caption,
    totalRow,
  } = tableData;

  // Determine header colors based on style
  const headerColors: Record<string, { bg: string; text: string }> = {
    primary: { bg: palette.primary, text: palette.textInverse },
    dark: { bg: palette.text, text: palette.background },
    light: { bg: palette.surface, text: palette.text },
    accent: { bg: palette.accent, text: palette.textInverse },
  };
  const headerColor = headerColors[headerStyle] || headerColors.primary;

  // Determine border style based on table style
  const borderStyles: Record<string, string> = {
    default: `
    top: { style: BorderStyle.SINGLE, size: 1, color: '${palette.textMuted}' },
    bottom: { style: BorderStyle.SINGLE, size: 1, color: '${palette.textMuted}' },
    left: { style: BorderStyle.SINGLE, size: 1, color: '${palette.textMuted}' },
    right: { style: BorderStyle.SINGLE, size: 1, color: '${palette.textMuted}' },
    insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: '${palette.textMuted}' },
    insideVertical: { style: BorderStyle.SINGLE, size: 1, color: '${palette.textMuted}' },`,
    striped: `
    top: { style: BorderStyle.SINGLE, size: 1, color: '${palette.textMuted}' },
    bottom: { style: BorderStyle.SINGLE, size: 1, color: '${palette.textMuted}' },
    left: { style: BorderStyle.NONE },
    right: { style: BorderStyle.NONE },
    insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: '${palette.surface}' },
    insideVertical: { style: BorderStyle.NONE },`,
    bordered: `
    top: { style: BorderStyle.SINGLE, size: 2, color: '${palette.text}' },
    bottom: { style: BorderStyle.SINGLE, size: 2, color: '${palette.text}' },
    left: { style: BorderStyle.SINGLE, size: 2, color: '${palette.text}' },
    right: { style: BorderStyle.SINGLE, size: 2, color: '${palette.text}' },
    insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: '${palette.text}' },
    insideVertical: { style: BorderStyle.SINGLE, size: 1, color: '${palette.text}' },`,
    minimal: `
    top: { style: BorderStyle.NONE },
    bottom: { style: BorderStyle.SINGLE, size: 1, color: '${palette.textMuted}' },
    left: { style: BorderStyle.NONE },
    right: { style: BorderStyle.NONE },
    insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: '${palette.surface}' },
    insideVertical: { style: BorderStyle.NONE },`,
    colored: `
    top: { style: BorderStyle.SINGLE, size: 2, color: '${palette.primary}' },
    bottom: { style: BorderStyle.SINGLE, size: 2, color: '${palette.primary}' },
    left: { style: BorderStyle.SINGLE, size: 2, color: '${palette.primary}' },
    right: { style: BorderStyle.SINGLE, size: 2, color: '${palette.primary}' },
    insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: '${palette.primary}' },
    insideVertical: { style: BorderStyle.SINGLE, size: 1, color: '${palette.primary}' },`,
  };

  // Helper to process cell (string or TableCellConfig)
  const processCellToCode = (
    cell: string | TableCellConfig,
    isHeader: boolean,
    rowIndex: number,
  ): string => {
    const cellConfig = typeof cell === "string" ? { content: cell } : cell;

    let bgColor: string;
    if (cellConfig.bgColor) {
      bgColor = cellConfig.bgColor;
    } else if (isHeader) {
      bgColor = headerColor.bg;
    } else if (style === "striped") {
      bgColor = rowIndex % 2 === 0 ? palette.surface : palette.background;
    } else {
      bgColor = palette.background;
    }

    const textColor = (() => {
      if (cellConfig.textColor) return cellConfig.textColor;
      if (isHeader) return headerColor.text;
      return palette.text;
    })();

    const alignment = (() => {
      if (cellConfig.align)
        return `AlignmentType.${cellConfig.align.toUpperCase()}`;
      if (isHeader) return "AlignmentType.CENTER";
      return "AlignmentType.LEFT";
    })();

    const colspan = cellConfig.colspan
      ? `columnSpan: ${cellConfig.colspan},`
      : "";
    const rowspan = cellConfig.rowspan ? `rowSpan: ${cellConfig.rowspan},` : "";

    return `
        new TableCell({
          children: [
            new Paragraph({
              children: [
                new TextRun({
                  text: ${JSON.stringify(cellConfig.content)},
                  bold: ${isHeader || cellConfig.bold || false},
                  italics: ${cellConfig.italic || false},
                  font: '${isHeader ? DOCUMENT_FONTS[template].heading : DOCUMENT_FONTS[template].body}',
                  size: ${isHeader ? 22 : 20},
                  color: '${textColor}',
                }),
              ],
              alignment: ${alignment},
            }),
          ],
          shading: { fill: '${bgColor}', type: ShadingType.SOLID },
          verticalAlign: VerticalAlign.CENTER,
          margins: { top: 80, bottom: 80, left: 120, right: 120 },
          ${colspan}
          ${rowspan}
        })`;
  };

  // Generate header cells
  const headerCells = headers
    .map((h) => processCellToCode(h, true, -1))
    .join(",");

  // Generate data rows
  const dataRows = rows
    .map((row, rowIndex) => {
      const isTotal = totalRow && rowIndex === rows.length - 1;
      const processedCells = row
        .map((cell) => {
          if (isTotal && typeof cell === "string") {
            return processCellToCode(
              { content: cell, bold: true },
              false,
              rowIndex,
            );
          }
          return processCellToCode(cell, false, rowIndex);
        })
        .join(",");

      return `
      new TableRow({
        children: [${processedCells}
        ],
      })`;
    })
    .join(",");

  // Generate column widths if specified
  const columnWidthsCode = columnWidths
    ? `columnWidths: [${columnWidths.map((w) => Math.round(w * 100)).join(", ")}],`
    : "";

  // Generate caption if specified
  const captionCode = caption
    ? `
new Paragraph({
  children: [
    new TextRun({
      text: ${JSON.stringify(caption)},
      font: '${DOCUMENT_FONTS[template].body}',
      size: 18,
      italics: true,
      color: '${palette.textMuted}',
    }),
  ],
  alignment: AlignmentType.CENTER,
  spacing: { before: 100, after: 200 },
}),`
    : "";

  return `
new Table({
  rows: [
    new TableRow({
      children: [${headerCells}
      ],
      tableHeader: true,
    }),${dataRows}
  ],
  width: { size: 100, type: WidthType.PERCENTAGE },
  ${columnWidthsCode}
  borders: {${borderStyles[style] || borderStyles.default}
  },
}),
${captionCode}
new Paragraph({ spacing: { after: 200 } }),`;
}

// Generate quote/callout code
export function generateQuoteCode(
  content: string,
  template: DocumentTemplateType,
  palette: ColorPalette,
): string {
  const safeContent = JSON.stringify(content);

  return `
new Paragraph({
  children: [
    new TextRun({
      text: ${safeContent},
      font: '${DOCUMENT_FONTS[template].body}',
      size: 24,
      italics: true,
      color: '${palette.textMuted}',
    }),
  ],
  indent: { left: 720, right: 720 },
  border: {
    left: { style: BorderStyle.SINGLE, size: 24, color: '${palette.primary}' },
  },
  spacing: { before: 200, after: 200 },
}),`;
}

// Generate callout box code
export function generateCalloutCode(
  content: string,
  calloutType: "info" | "warning" | "success" | "error",
  template: DocumentTemplateType,
  _palette: ColorPalette,
): string {
  const style = CALLOUT_STYLES[calloutType];
  const safeContent = JSON.stringify(`${style.icon}  ${content}`);

  return `
new Paragraph({
  children: [
    new TextRun({
      text: ${safeContent},
      font: '${DOCUMENT_FONTS[template].body}',
      size: 22,
      color: '${style.color}',
    }),
  ],
  shading: { fill: '${style.bgColor}', type: ShadingType.SOLID },
  border: {
    left: { style: BorderStyle.SINGLE, size: 24, color: '${style.color}' },
  },
  indent: { left: 360, right: 360 },
  spacing: { before: 200, after: 200 },
}),`;
}

// Generate divider code
export function generateDividerCode(palette: ColorPalette): string {
  return `
new Paragraph({
  children: [
    new TextRun({
      text: '─────────────────────────────────────────────────',
      size: 20,
      color: '${palette.textMuted}',
    }),
  ],
  alignment: AlignmentType.CENTER,
  spacing: { before: 300, after: 300 },
}),`;
}

// Generate code block code
export function generateCodeBlockCode(
  content: string,
  template: DocumentTemplateType,
  palette: ColorPalette,
): string {
  const safeContent = JSON.stringify(content);

  return `
new Paragraph({
  children: [
    new TextRun({
      text: ${safeContent},
      font: '${DOCUMENT_FONTS[template].mono}',
      size: 20,
      color: '${palette.text}',
    }),
  ],
  shading: { fill: '${palette.surface}', type: ShadingType.SOLID },
  spacing: { before: 200, after: 200 },
  indent: { left: 360, right: 360 },
}),`;
}

// Generate header/footer code
export function generateHeaderFooterCode(
  options: DocumentOptions,
  palette: ColorPalette,
): string {
  const safeTitle = JSON.stringify(options.title);
  const safeFooterPrefix = JSON.stringify(
    `${options.company || options.author || ""} | Page `,
  );

  return `
// Header
const header = new Header({
  children: [
    new Paragraph({
      children: [
        new TextRun({
          text: ${safeTitle},
          font: '${DOCUMENT_FONTS[options.template].body}',
          size: 18,
          color: '${palette.textMuted}',
        }),
      ],
      alignment: AlignmentType.RIGHT,
    }),
  ],
});

// Footer with page numbers
const footer = new Footer({
  children: [
    new Paragraph({
      children: [
        new TextRun({
          text: ${safeFooterPrefix},
          font: '${DOCUMENT_FONTS[options.template].body}',
          size: 18,
          color: '${palette.textMuted}',
        }),
        new TextRun({
          children: [PageNumber.CURRENT],
          font: '${DOCUMENT_FONTS[options.template].body}',
          size: 18,
          color: '${palette.textMuted}',
        }),
        new TextRun({
          text: ' of ',
          font: '${DOCUMENT_FONTS[options.template].body}',
          size: 18,
          color: '${palette.textMuted}',
        }),
        new TextRun({
          children: [PageNumber.TOTAL_PAGES],
          font: '${DOCUMENT_FONTS[options.template].body}',
          size: 18,
          color: '${palette.textMuted}',
        }),
      ],
      alignment: AlignmentType.CENTER,
    }),
  ],
});
`;
}

// Main document generator
export function generateDocumentTemplate(
  sections: DocumentSection[],
  options: DocumentOptions,
): string {
  const palette = getPalette(options.paletteName || "gamma-light");
  const hasLogo = !!options.logoUrl;

  // Generate image fetching code
  const { code: imageFetchCode, imageVarMap } = generateImageFetchingCode(
    sections,
    options.logoUrl,
  );
  const hasImages = imageFetchCode.length > 0;

  let code = `
// Install docx if not available
const { execSync } = require('child_process');
try {
  require.resolve('docx');
} catch (e) {
  console.log('Installing docx...');
  execSync('npm install docx --no-save --silent 2>/dev/null || npm install docx --no-save', {
    stdio: 'pipe',
    cwd: '/home/user'
  });
  console.log('docx installed successfully');
}

const {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  Table,
  TableRow,
  TableCell,
  WidthType,
  ShadingType,
  BorderStyle,
  VerticalAlign,
  Header,
  Footer,
  PageNumber,
  PageBreak,
  TableOfContents,
  ImageRun,
} = require('docx');
const fs = require('fs');

`;

  // Add image fetching code if needed
  if (hasImages) {
    code += imageFetchCode;
  }

  // Generate header/footer if enabled
  if (options.includeHeaderFooter) {
    code += generateHeaderFooterCode(options, palette);
  }

  // Wrap main execution in async function if we have images
  if (hasImages) {
    code += `
// Main async execution
(async () => {
  // Fetch all images first
  await fetchAllImages();

`;
  }

  // Start document children array
  code += `
const documentChildren = [];
`;

  // Add cover page if enabled
  if (options.includeCoverPage) {
    code += generateCoverPageCode(options, palette, hasLogo);
    code += `
documentChildren.push(...coverPageChildren);
`;
  }

  // Add TOC if enabled
  if (options.includeToc) {
    code += generateTocCode(palette);
    code += `
documentChildren.push(...tocChildren);
`;
  }

  // Process sections
  code += `
// Document Content
`;

  sections.forEach((section, index) => {
    switch (section.type) {
      case "heading1":
        code += `documentChildren.push(${generateHeadingCode(section.content || "", 1, palette, options.template)});\n`;
        break;
      case "heading2":
        code += `documentChildren.push(${generateHeadingCode(section.content || "", 2, palette, options.template)});\n`;
        break;
      case "heading3":
        code += `documentChildren.push(${generateHeadingCode(section.content || "", 3, palette, options.template)});\n`;
        break;
      case "paragraph":
        code += `documentChildren.push(${generateParagraphCode(section.content || "", options.template, palette)});\n`;
        break;
      case "bullet-list":
        code += `documentChildren.push(${generateBulletListCode(section.items || [], options.template, palette)});\n`;
        break;
      case "numbered-list":
        code += `documentChildren.push(${generateNumberedListCode(section.items || [], options.template, palette)});\n`;
        break;
      case "table":
        if (section.advancedTable) {
          // Use advanced table with merged cells, custom styling, etc.
          code += `documentChildren.push(${generateAdvancedTableCode(section.advancedTable, palette, options.template)});\n`;
        } else if (section.tableData) {
          code += `documentChildren.push(${generateTableCode(section.tableData.headers, section.tableData.rows, palette, options.template)});\n`;
        }
        break;
      case "image":
        if (section.imageUrl && imageVarMap.has(index)) {
          code += generateImageCode(
            section,
            imageVarMap.get(index)!,
            options.template,
            palette,
          );
        }
        break;
      case "image-text":
        if (section.imageUrl && imageVarMap.has(index)) {
          code += generateImageTextCode(
            section,
            imageVarMap.get(index)!,
            options.template,
            palette,
          );
        }
        break;
      case "quote":
        code += `documentChildren.push(${generateQuoteCode(section.content || "", options.template, palette)});\n`;
        break;
      case "callout":
        code += `documentChildren.push(${generateCalloutCode(section.content || "", section.calloutType || "info", options.template, palette)});\n`;
        break;
      case "divider":
        code += `documentChildren.push(${generateDividerCode(palette)});\n`;
        break;
      case "code":
        code += `documentChildren.push(${generateCodeBlockCode(section.content || "", options.template, palette)});\n`;
        break;
      case "page-break":
        code += `documentChildren.push(new Paragraph({ children: [new PageBreak()] }));\n`;
        break;
    }
  });

  // Create and save document
  const safeCreator = JSON.stringify(options.author || "Shadower AI");
  const safeDocTitle = JSON.stringify(options.title);
  const safeFileName = JSON.stringify(
    options.title.replace(/[^a-zA-Z0-9]/g, "_") + ".docx",
  );

  code += `
// Create the document
const doc = new Document({
  creator: ${safeCreator},
  title: ${safeDocTitle},
  description: 'Generated by Shadower AI',
  ${
    options.includeHeaderFooter
      ? `
  sections: [
    {
      headers: { default: header },
      footers: { default: footer },
      children: documentChildren,
    },
  ],`
      : `
  sections: [
    {
      children: documentChildren,
    },
  ],`
  }
  numbering: {
    config: [
      {
        reference: 'default-numbering',
        levels: [
          {
            level: 0,
            format: 'decimal',
            text: '%1.',
            alignment: AlignmentType.START,
            style: { paragraph: { indent: { left: 720, hanging: 360 } } },
          },
        ],
      },
    ],
  },
});

// Save the document
const fileName = ${safeFileName};
Packer.toBuffer(doc).then((buffer) => {
  fs.writeFileSync(fileName, buffer);
  console.log('Document saved to: ' + fileName);
}).catch((err) => {
  console.error('Error saving document:', err);
});
`;

  // Close async function if we have images
  if (hasImages) {
    code += `
})();
`;
  }

  return code;
}
