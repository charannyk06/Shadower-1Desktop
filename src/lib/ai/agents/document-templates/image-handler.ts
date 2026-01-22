/**
 * Image Handler - Utilities for fetching, processing, and embedding images
 * in document generation (PowerPoint, Word, Excel, PDF)
 */

/**
 * Image source types supported
 */
export type ImageSource =
  | { type: "url"; url: string }
  | { type: "base64"; data: string; mimeType: string }
  | { type: "path"; path: string };

/**
 * Image sizing options
 */
export interface ImageSizing {
  width?: number;
  height?: number;
  fit?: "contain" | "cover" | "fill" | "none";
  position?: "center" | "top" | "bottom" | "left" | "right";
}

/**
 * Image processing options
 */
export interface ImageProcessingOptions {
  resize?: ImageSizing;
  quality?: number; // 1-100 for JPEG
  format?: "png" | "jpeg" | "webp";
  grayscale?: boolean;
  blur?: number;
  brightness?: number; // -1 to 1
  contrast?: number; // -1 to 1
}

/**
 * Generate code to fetch an image from URL and convert to base64
 * This code runs locally via desktop_command
 */
export function generateImageFetchCode(
  imageUrl: string,
  variableName: string = "imageData",
): string {
  const safeUrl = JSON.stringify(imageUrl);

  return `
// Fetch image from URL and convert to base64
async function fetchImageAsBase64_${variableName}() {
  try {
    const response = await fetch(${safeUrl});
    if (!response.ok) {
      console.warn('Failed to fetch image: ' + ${safeUrl});
      return null;
    }
    const buffer = await response.arrayBuffer();
    const base64 = Buffer.from(buffer).toString('base64');
    const contentType = response.headers.get('content-type') || 'image/png';
    return { data: base64, mimeType: contentType };
  } catch (error) {
    console.warn('Error fetching image:', error.message);
    return null;
  }
}
const ${variableName} = await fetchImageAsBase64_${variableName}();
`;
}

/**
 * Generate code to fetch multiple images in parallel
 */
export function generateBatchImageFetchCode(
  images: Array<{ url: string; name: string }>,
): string {
  const imageList = JSON.stringify(images);

  return `
// Batch fetch images in parallel
async function fetchAllImages(imageList) {
  const results = {};
  await Promise.all(
    imageList.map(async ({ url, name }) => {
      try {
        const response = await fetch(url);
        if (!response.ok) {
          console.warn('Failed to fetch image: ' + name);
          results[name] = null;
          return;
        }
        const buffer = await response.arrayBuffer();
        const base64 = Buffer.from(buffer).toString('base64');
        const contentType = response.headers.get('content-type') || 'image/png';
        results[name] = { data: base64, mimeType: contentType };
      } catch (error) {
        console.warn('Error fetching image ' + name + ':', error.message);
        results[name] = null;
      }
    })
  );
  return results;
}
const fetchedImages = await fetchAllImages(${imageList});
`;
}

/**
 * Generate code to resize an image using sharp (if available) or canvas
 */
export function generateImageResizeCode(
  inputVar: string,
  outputVar: string,
  width: number,
  height: number,
): string {
  return `
// Resize image
async function resizeImage_${outputVar}(imageData, targetWidth, targetHeight) {
  if (!imageData) return null;

  try {
    // Try using sharp for better quality
    let sharp;
    try {
      sharp = require('sharp');
    } catch (e) {
      // Sharp not available, return original
      console.log('Sharp not available, using original image');
      return imageData;
    }

    const buffer = Buffer.from(imageData.data, 'base64');
    const resized = await sharp(buffer)
      .resize(targetWidth, targetHeight, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } })
      .toBuffer();

    return {
      data: resized.toString('base64'),
      mimeType: imageData.mimeType
    };
  } catch (error) {
    console.warn('Error resizing image:', error.message);
    return imageData; // Return original on error
  }
}
const ${outputVar} = await resizeImage_${outputVar}(${inputVar}, ${width}, ${height});
`;
}

/**
 * Generate PptxGenJS code to add an image to a slide
 */
export function generatePptxImageCode(
  slideVar: string,
  imageDataVar: string,
  options: {
    x: number;
    y: number;
    w: number;
    h: number;
    sizing?: "contain" | "cover" | "crop";
    rounding?: boolean;
    shadow?: boolean;
    hyperlink?: string;
  },
): string {
  const {
    x,
    y,
    w,
    h,
    sizing = "contain",
    rounding = false,
    shadow = false,
    hyperlink,
  } = options;

  return `
// Add image to slide
if (${imageDataVar} && ${imageDataVar}.data) {
  ${slideVar}.addImage({
    data: 'data:' + ${imageDataVar}.mimeType + ';base64,' + ${imageDataVar}.data,
    x: ${x},
    y: ${y},
    w: ${w},
    h: ${h},
    sizing: { type: '${sizing}', w: ${w}, h: ${h} },
    ${rounding ? "rounding: true," : ""}
    ${shadow ? "shadow: { type: 'outer', blur: 4, offset: 2, angle: 45, opacity: 0.3 }," : ""}
    ${hyperlink ? `hyperlink: { url: ${JSON.stringify(hyperlink)} },` : ""}
  });
} else {
  // Fallback placeholder if image failed to load
  ${slideVar}.addShape('rect', {
    x: ${x}, y: ${y}, w: ${w}, h: ${h},
    fill: { color: 'F0F0F0' },
    line: { color: 'CCCCCC', width: 1 }
  });
  ${slideVar}.addText('Image not available', {
    x: ${x}, y: ${y + h / 2 - 0.2}, w: ${w}, h: 0.4,
    fontSize: 12,
    color: '999999',
    align: 'center',
    valign: 'middle'
  });
}
`;
}

/**
 * Generate docx code to add an image to a Word document
 */
export function generateDocxImageCode(
  imageDataVar: string,
  options: {
    width: number;
    height: number;
    floating?: boolean;
    alignment?: "left" | "center" | "right";
    wrap?: "square" | "tight" | "none";
  },
): string {
  const { width, height, floating = false, alignment = "center" } = options;

  if (floating) {
    return `
// Add floating image
${imageDataVar} && ${imageDataVar}.data ? new ImageRun({
  data: Buffer.from(${imageDataVar}.data, 'base64'),
  transformation: {
    width: ${width},
    height: ${height},
  },
  floating: {
    horizontalPosition: {
      relative: HorizontalPositionRelativeFrom.PAGE,
      align: HorizontalPositionAlign.${alignment.toUpperCase()},
    },
    verticalPosition: {
      relative: VerticalPositionRelativeFrom.PARAGRAPH,
      offset: 0,
    },
  },
}) : new TextRun({ text: '[Image not available]', italics: true, color: '999999' })
`;
  }

  return `
// Add inline image
${imageDataVar} && ${imageDataVar}.data ? new ImageRun({
  data: Buffer.from(${imageDataVar}.data, 'base64'),
  transformation: {
    width: ${width},
    height: ${height},
  },
}) : new TextRun({ text: '[Image not available]', italics: true, color: '999999' })
`;
}

/**
 * Generate ExcelJS code to add an image to a worksheet
 */
export function generateExcelImageCode(
  worksheetVar: string,
  workbookVar: string,
  imageDataVar: string,
  options: {
    row: number;
    col: number;
    width?: number;
    height?: number;
  },
): string {
  const { row, col, width = 200, height = 150 } = options;

  return `
// Add image to worksheet
if (${imageDataVar} && ${imageDataVar}.data) {
  const imageId = ${workbookVar}.addImage({
    base64: ${imageDataVar}.data,
    extension: ${imageDataVar}.mimeType.split('/')[1] || 'png',
  });

  ${worksheetVar}.addImage(imageId, {
    tl: { col: ${col}, row: ${row} },
    ext: { width: ${width}, height: ${height} },
  });
}
`;
}

/**
 * Generate code to create a placeholder image with text
 */
export function generatePlaceholderImageCode(
  text: string,
  width: number,
  height: number,
  bgColor: string = "#F0F0F0",
  textColor: string = "#666666",
): string {
  const safeText = JSON.stringify(text);

  return `
// Generate placeholder image
function createPlaceholderImage(text, width, height, bgColor, textColor) {
  // Create a simple SVG placeholder
  const svg = \`
    <svg width="\${width}" height="\${height}" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="\${bgColor}"/>
      <text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle"
            fill="\${textColor}" font-family="Arial" font-size="14">
        \${text}
      </text>
    </svg>
  \`;
  return {
    data: Buffer.from(svg).toString('base64'),
    mimeType: 'image/svg+xml'
  };
}
const placeholderImage = createPlaceholderImage(${safeText}, ${width}, ${height}, '${bgColor}', '${textColor}');
`;
}

/**
 * Generate code to validate image URL
 */
export function generateImageValidationCode(imageUrl: string): string {
  const safeUrl = JSON.stringify(imageUrl);

  return `
// Validate image URL
async function validateImageUrl(url) {
  try {
    const response = await fetch(url, { method: 'HEAD' });
    if (!response.ok) return false;
    const contentType = response.headers.get('content-type');
    return contentType && contentType.startsWith('image/');
  } catch {
    return false;
  }
}
const isValidImage = await validateImageUrl(${safeUrl});
`;
}

/**
 * Extract images from slide content and generate fetch code
 */
export function extractAndGenerateImageCode(
  slides: Array<{ imageUrl?: string; images?: string[] }>,
): { fetchCode: string; imageMap: Map<string, string> } {
  const imageMap = new Map<string, string>();
  const images: Array<{ url: string; name: string }> = [];

  slides.forEach((slide, slideIndex) => {
    if (slide.imageUrl) {
      const varName = `slide${slideIndex}_image`;
      imageMap.set(slide.imageUrl, varName);
      images.push({ url: slide.imageUrl, name: varName });
    }
    if (slide.images) {
      slide.images.forEach((imgUrl, imgIndex) => {
        const varName = `slide${slideIndex}_image${imgIndex}`;
        imageMap.set(imgUrl, varName);
        images.push({ url: imgUrl, name: varName });
      });
    }
  });

  if (images.length === 0) {
    return { fetchCode: "", imageMap };
  }

  const fetchCode = generateBatchImageFetchCode(images);
  return { fetchCode, imageMap };
}

/**
 * Get image extension from MIME type
 */
export function getImageExtension(mimeType: string): string {
  const mimeToExt: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/gif": "gif",
    "image/webp": "webp",
    "image/svg+xml": "svg",
    "image/bmp": "bmp",
    "image/tiff": "tiff",
  };
  return mimeToExt[mimeType.toLowerCase()] || "png";
}

/**
 * Check if URL is a valid image URL
 */
export function isImageUrl(url: string): boolean {
  const imageExtensions = [
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".webp",
    ".svg",
    ".bmp",
    ".tiff",
  ];
  const urlLower = url.toLowerCase();
  return (
    imageExtensions.some((ext) => urlLower.includes(ext)) ||
    urlLower.includes("image")
  );
}

/**
 * Generate async wrapper for image operations
 */
export function generateAsyncImageWrapper(innerCode: string): string {
  return `
(async () => {
${innerCode}
})().catch(err => console.error('Image processing error:', err));
`;
}
