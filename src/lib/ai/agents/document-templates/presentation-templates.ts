/**
 * Manus/Gamma-quality presentation templates for PptxGenJS
 * Professional slides with gradient effects, visual hierarchy, modern design
 *
 * FEATURES:
 * - Gradient background effects (simulated with layered shapes)
 * - Call-out boxes and highlight cards
 * - Modern typography with visual hierarchy
 * - Icon placeholders and decorative elements
 * - Split layouts with imagery (Manus-style)
 * - Shadow effects and depth
 * - Professional color schemes
 */

import { ColorPalette, getPalette } from "./color-palettes";

// ============================================================================
// GRADIENT & VISUAL EFFECT HELPERS
// ============================================================================

/**
 * Generate gradient background effect code using layered transparent shapes
 * PptxGenJS doesn't support native gradients, so we simulate with overlays
 */
export function generateGradientBackgroundCode(
  slideVar: string,
  palette: ColorPalette,
  direction: "vertical" | "horizontal" | "diagonal" | "radial" = "vertical",
): string {
  const baseColor = palette.background;
  const accentColor = palette.primary;
  const surfaceColor = palette.surface;

  switch (direction) {
    case "vertical":
      return `
// Gradient effect: vertical (top to bottom)
${slideVar}.addShape('rect', { x: 0, y: 0, w: 13.33, h: 2.5, fill: { color: '${surfaceColor}', transparency: 95 } });
${slideVar}.addShape('rect', { x: 0, y: 2.5, w: 13.33, h: 2.5, fill: { color: '${surfaceColor}', transparency: 85 } });
${slideVar}.addShape('rect', { x: 0, y: 5.0, w: 13.33, h: 2.5, fill: { color: '${surfaceColor}', transparency: 70 } });
`;

    case "horizontal":
      return `
// Gradient effect: horizontal (left to right)
${slideVar}.addShape('rect', { x: 0, y: 0, w: 4.44, h: 7.5, fill: { color: '${accentColor}', transparency: 90 } });
${slideVar}.addShape('rect', { x: 4.44, y: 0, w: 4.44, h: 7.5, fill: { color: '${accentColor}', transparency: 95 } });
${slideVar}.addShape('rect', { x: 8.88, y: 0, w: 4.45, h: 7.5, fill: { color: '${accentColor}', transparency: 98 } });
`;

    case "diagonal":
      return `
// Gradient effect: diagonal with accent shapes
${slideVar}.addShape('rect', { x: 0, y: 0, w: 5, h: 7.5, fill: { color: '${accentColor}', transparency: 85 } });
${slideVar}.addShape('rect', { x: 0, y: 5, w: 13.33, h: 2.5, fill: { color: '${surfaceColor}', transparency: 60 } });
// Decorative diagonal accent
${slideVar}.addShape('rtTriangle', { x: 0, y: 0, w: 8, h: 7.5, fill: { color: '${accentColor}', transparency: 92 }, rotate: 0 });
`;

    case "radial":
      return `
// Gradient effect: radial-like with centered highlight
${slideVar}.addShape('ellipse', { x: 3.67, y: 1.25, w: 6, h: 5, fill: { color: '${baseColor}', transparency: 0 } });
${slideVar}.addShape('ellipse', { x: 2.67, y: 0.5, w: 8, h: 6.5, fill: { color: '${surfaceColor}', transparency: 80 } });
`;

    default:
      return "";
  }
}

/**
 * Generate code for a call-out/highlight box
 */
interface CalloutColors {
  bg: string;
  text: string;
  accent: string;
}

function getCalloutColors(
  variant: "primary" | "accent" | "success" | "warning" | "info",
  palette: ColorPalette,
): CalloutColors {
  const colors: Record<string, CalloutColors> = {
    primary: {
      bg: palette.primary,
      text: palette.textInverse,
      accent: palette.primaryDark,
    },
    accent: { bg: palette.accent, text: palette.text, accent: palette.primary },
    success: { bg: "22C55E", text: "FFFFFF", accent: "16A34A" },
    warning: { bg: "F59E0B", text: "FFFFFF", accent: "D97706" },
    info: { bg: "3B82F6", text: "FFFFFF", accent: "2563EB" },
  };
  return colors[variant] || colors.primary;
}

export function generateCalloutBoxCode(
  slideVar: string,
  x: number,
  y: number,
  w: number,
  h: number,
  text: string,
  palette: ColorPalette,
  variant: "primary" | "accent" | "success" | "warning" | "info" = "primary",
): string {
  const c = getCalloutColors(variant, palette);

  return `
// Call-out box (${variant})
${slideVar}.addShape('roundRect', {
  x: ${x}, y: ${y}, w: ${w}, h: ${h},
  fill: { color: '${c.bg}' },
  rectRadius: 0.1,
  shadow: { type: 'outer', blur: 8, offset: 3, angle: 45, opacity: 0.25, color: '000000' }
});
// Left accent bar
${slideVar}.addShape('rect', {
  x: ${x}, y: ${y}, w: 0.12, h: ${h},
  fill: { color: '${c.accent}' }
});
// Call-out text
${slideVar}.addText(${JSON.stringify(text)}, {
  x: ${x + 0.3}, y: ${y + 0.15}, w: ${w - 0.5}, h: ${h - 0.3},
  fontFace: '${FONTS.body}',
  fontSize: 16,
  color: '${c.text}',
  valign: 'middle'
});
`;
}

/**
 * Generate code for a modern card with shadow
 */
interface CardConfig {
  slideVar: string;
  x: number;
  y: number;
  w: number;
  h: number;
  title: string;
  description: string;
  palette: ColorPalette;
  hasIcon: boolean;
  iconText: string;
}

function generateCardIconCode(config: CardConfig): string {
  if (!config.hasIcon) return "";
  return `
${config.slideVar}.addShape('ellipse', {
  x: ${config.x + 0.3}, y: ${config.y + 0.3}, w: 0.8, h: 0.8,
  fill: { color: '${config.palette.primary}' }
});
${config.slideVar}.addText('${config.iconText}', {
  x: ${config.x + 0.3}, y: ${config.y + 0.35}, w: 0.8, h: 0.7,
  fontSize: 20,
  color: '${config.palette.textInverse}',
  align: 'center',
  valign: 'middle'
});`;
}

function generateCardBaseCode(config: CardConfig): string {
  const titleY = config.hasIcon ? config.y + 1.3 : config.y + 0.3;
  return `
${config.slideVar}.addShape('roundRect', {
  x: ${config.x}, y: ${config.y}, w: ${config.w}, h: ${config.h},
  fill: { color: '${config.palette.surface}' },
  rectRadius: 0.15,
  shadow: { type: 'outer', blur: 12, offset: 4, angle: 45, opacity: 0.2, color: '000000' }
});

${config.slideVar}.addShape('rect', {
  x: ${config.x}, y: ${config.y}, w: ${config.w}, h: 0.08,
  fill: { color: '${config.palette.primary}' }
});

${config.slideVar}.addText(${JSON.stringify(config.title)}, {
  x: ${config.x + 0.3}, y: ${titleY}, w: ${config.w - 0.6}, h: 0.5,
  fontFace: '${FONTS.heading}',
  fontSize: 18,
  bold: true,
  color: '${config.palette.text}'
});

${config.slideVar}.addText(${JSON.stringify(config.description)}, {
  x: ${config.x + 0.3}, y: ${titleY + 0.6}, w: ${config.w - 0.6}, h: ${config.h - titleY - 0.9 + config.y},
  fontFace: '${FONTS.body}',
  fontSize: 14,
  color: '${config.palette.textMuted}',
  valign: 'top'
});`;
}

export function generateCardCode(
  slideVar: string,
  x: number,
  y: number,
  w: number,
  h: number,
  title: string,
  description: string,
  palette: ColorPalette,
  hasIcon: boolean = false,
  iconText: string = "★",
): string {
  const config: CardConfig = {
    slideVar,
    x,
    y,
    w,
    h,
    title,
    description,
    palette,
    hasIcon,
    iconText,
  };
  const iconCode = generateCardIconCode(config);
  const baseCode = generateCardBaseCode(config);
  return iconCode + baseCode;
}

/**
 * Generate decorative accent shapes for visual polish
 */
export function generateDecorativeAccentsCode(
  slideVar: string,
  palette: ColorPalette,
  style: "minimal" | "modern" | "bold" | "geometric" = "modern",
): string {
  switch (style) {
    case "minimal":
      return `
// Minimal accents
${slideVar}.addShape('rect', { x: 0, y: 0, w: 13.33, h: 0.04, fill: { color: '${palette.primary}' } });
${slideVar}.addShape('rect', { x: 0, y: 7.46, w: 13.33, h: 0.04, fill: { color: '${palette.primary}' } });
`;

    case "modern":
      return `
// Modern accents
${slideVar}.addShape('rect', { x: 0, y: 0, w: 0.25, h: 7.5, fill: { color: '${palette.primary}' } });
${slideVar}.addShape('rect', { x: 0, y: 7.35, w: 13.33, h: 0.15, fill: { color: '${palette.primary}' } });
// Corner accent
${slideVar}.addShape('rect', { x: 12.83, y: 0, w: 0.5, h: 0.5, fill: { color: '${palette.accent}' } });
`;

    case "bold":
      return `
// Bold accents
${slideVar}.addShape('rect', { x: 0, y: 0, w: 0.5, h: 7.5, fill: { color: '${palette.primary}' } });
${slideVar}.addShape('rect', { x: 0.5, y: 6.5, w: 12.83, h: 1.0, fill: { color: '${palette.surface}' } });
${slideVar}.addShape('rect', { x: 0, y: 6.5, w: 5, h: 0.08, fill: { color: '${palette.accent}' } });
// Top right decorative element
${slideVar}.addShape('ellipse', { x: 11.5, y: -0.5, w: 2.5, h: 2.5, fill: { color: '${palette.primary}', transparency: 85 } });
`;

    case "geometric":
      return `
// Geometric accents
${slideVar}.addShape('rtTriangle', { x: 0, y: 6, w: 2, h: 1.5, fill: { color: '${palette.primary}' }, rotate: 180 });
${slideVar}.addShape('rect', { x: 12.33, y: 0, w: 1, h: 0.15, fill: { color: '${palette.accent}' } });
${slideVar}.addShape('rect', { x: 13.18, y: 0.15, w: 0.15, h: 1, fill: { color: '${palette.accent}' } });
// Subtle circles
${slideVar}.addShape('ellipse', { x: 11, y: -1, w: 3, h: 3, fill: { color: '${palette.primary}', transparency: 92 } });
${slideVar}.addShape('ellipse', { x: -1, y: 5.5, w: 3, h: 3, fill: { color: '${palette.accent}', transparency: 92 } });
`;

    default:
      return "";
  }
}

// Slide transition types supported by PptxGenJS
export type SlideTransition =
  | "fade"
  | "push"
  | "wipe"
  | "zoom"
  | "cover"
  | "pull"
  | "random"
  | "dissolve"
  | "clock"
  | "split"
  | "none";

// Slide layout types - ENHANCED with more options
export type SlideLayoutType =
  | "title"
  | "section"
  | "content"
  | "two-column"
  | "three-column"
  | "stats"
  | "big-number"
  | "quote"
  | "timeline"
  | "comparison"
  | "image-left"
  | "image-right"
  | "image-full"
  | "image-grid"
  | "bullets"
  | "numbered"
  | "chart"
  | "table"
  | "blank"
  | "team"
  | "process"
  | "agenda"
  | "thank-you"
  | "contact"
  | "dashboard";

// Fonts to use (system fonts that work in PowerPoint)
export const FONTS = {
  heading: "Arial",
  body: "Arial",
  mono: "Courier New",
  // Web fonts that may be embedded
  modern: "Segoe UI",
  classic: "Georgia",
};

// Slide dimensions (16:9 widescreen)
export const SLIDE_DIMENSIONS = {
  width: 13.33,
  height: 7.5,
};

// Common positions and sizes
export const LAYOUT_POSITIONS = {
  // Full width content area
  content: {
    x: 0.5,
    y: 1.2,
    w: 12.33,
    h: 5.8,
  },
  // Title position
  title: {
    x: 0.5,
    y: 0.4,
    w: 12.33,
    h: 0.8,
  },
  // Subtitle position
  subtitle: {
    x: 0.5,
    y: 1.2,
    w: 12.33,
    h: 0.5,
  },
  // Left column (for two-column layouts)
  leftColumn: {
    x: 0.5,
    y: 1.2,
    w: 5.9,
    h: 5.8,
  },
  // Right column (for two-column layouts)
  rightColumn: {
    x: 6.9,
    y: 1.2,
    w: 5.9,
    h: 5.8,
  },
  // Center content (for title slides)
  center: {
    x: 0.5,
    y: 2.5,
    w: 12.33,
    h: 2.5,
  },
  // Footer area
  footer: {
    x: 0.5,
    y: 7.0,
    w: 12.33,
    h: 0.3,
  },
};

// Branding configuration for presentations
export interface BrandingConfig {
  companyName?: string;
  logoUrl?: string;
  logoPosition?: "top-left" | "top-right" | "bottom-left" | "bottom-right";
  logoSize?: { width: number; height: number };
  tagline?: string;
  website?: string;
  showSlideNumbers?: boolean;
  slideNumberFormat?: "number" | "number-total" | "custom";
  footerText?: string;
  showFooter?: boolean;
  showDate?: boolean;
  dateFormat?: "short" | "long" | "custom";
  customDateText?: string;
  watermark?: {
    text: string;
    opacity: number;
    position: "center" | "bottom-right";
  };
}

// Master slide configuration
export interface MasterSlideConfig {
  name: string;
  background?: "solid" | "gradient" | "dark" | "accent" | "image";
  backgroundImageUrl?: string;
  showLogo?: boolean;
  showFooter?: boolean;
  showSlideNumber?: boolean;
  accentBar?: "top" | "bottom" | "left" | "none";
  accentBarColor?: string;
}

// Interface for slide content - ENHANCED with more fields
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
    icon?: string;
    imageUrl?: string;
  }>;
  imageUrl?: string;
  images?: string[]; // Multiple images for grid layouts
  imageCaption?: string;
  chartData?: {
    type: "bar" | "line" | "pie" | "doughnut" | "area" | "scatter" | "radar";
    labels: string[];
    data: number[];
    series?: Array<{ name: string; data: number[] }>;
    title?: string;
    showLegend?: boolean;
    showValues?: boolean;
  };
  tableData?: {
    headers: string[];
    rows: string[][];
    headerStyle?: "primary" | "dark" | "light";
  };
  // Timeline specific
  timelineItems?: Array<{
    date: string;
    title: string;
    description?: string;
  }>;
  // Team specific
  teamMembers?: Array<{
    name: string;
    role: string;
    imageUrl?: string;
    email?: string;
    linkedin?: string;
  }>;
  // Process specific
  processSteps?: Array<{
    step: number;
    title: string;
    description?: string;
    icon?: string;
  }>;
  // Contact info
  contactInfo?: {
    email?: string;
    phone?: string;
    website?: string;
    address?: string;
    social?: Record<string, string>;
  };
  // Dashboard specific - KPIs, metrics, and mini-charts
  dashboardData?: {
    kpis?: Array<{
      label: string;
      value: string | number;
      change?: string; // e.g., "+15%" or "-3%"
      trend?: "up" | "down" | "neutral";
      icon?: string;
    }>;
    miniCharts?: Array<{
      title: string;
      type: "bar" | "line" | "pie";
      data: number[];
      labels?: string[];
    }>;
  };
  // Speaker notes
  notes?: string;
}

// Generate PptxGenJS-compatible text options
export function getTextStyle(
  palette: ColorPalette,
  variant: "title" | "subtitle" | "heading" | "body" | "caption" | "quote",
) {
  const styles = {
    title: {
      fontFace: FONTS.heading,
      fontSize: 44,
      bold: true,
      color: palette.text,
    },
    subtitle: {
      fontFace: FONTS.body,
      fontSize: 24,
      color: palette.textMuted,
    },
    heading: {
      fontFace: FONTS.heading,
      fontSize: 32,
      bold: true,
      color: palette.text,
    },
    body: {
      fontFace: FONTS.body,
      fontSize: 18,
      color: palette.text,
    },
    caption: {
      fontFace: FONTS.body,
      fontSize: 14,
      color: palette.textMuted,
    },
    quote: {
      fontFace: FONTS.classic,
      fontSize: 28,
      italic: true,
      color: palette.text,
    },
  };
  return styles[variant];
}

// Generate slide master definition for PptxGenJS
export function generateSlideMaster(paletteName: string) {
  const palette = getPalette(paletteName);

  return {
    title: paletteName.toUpperCase().replaceAll("-", "_"),
    background: { color: palette.background },
    objects: [
      // Gradient overlay at bottom for visual interest
      {
        rect: {
          x: 0,
          y: 6.5,
          w: "100%",
          h: 1.0,
          fill: {
            type: "solid",
            color: palette.surface,
          },
        },
      },
      // Accent line at top
      {
        rect: {
          x: 0,
          y: 0,
          w: "100%",
          h: 0.05,
          fill: {
            type: "solid",
            color: palette.primary,
          },
        },
      },
    ],
    slideNumber: {
      x: 12.0,
      y: 7.0,
      fontFace: FONTS.body,
      fontSize: 10,
      color: palette.textMuted,
    },
  };
}

// Helper functions to reduce cognitive complexity
interface InternalMasterSlideConfig {
  palette: ColorPalette;
  branding?: BrandingConfig;
  logoCoords: { x: number; y: number };
  logoW: number;
  logoH: number;
  showSlideNumbers: boolean;
  showFooter: boolean;
  footerText: string;
  showDate: boolean;
}

function generateLogoCode(config: InternalMasterSlideConfig): string {
  if (!config.branding?.logoUrl) return "";
  return `
// Logo will be fetched and added to master slides using fetch()
let logoData = null;
try {
  const logoUrl = ${JSON.stringify(config.branding.logoUrl)};

  const response = await fetch(logoUrl, {
    method: 'GET',
    redirect: 'follow'
  });

  if (response.ok) {
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    logoData = buffer.toString('base64');
    console.log('Logo fetched successfully');
  } else {
    console.warn('Could not fetch logo: HTTP', response.status);
  }
} catch (err) {
  console.warn('Could not fetch logo:', err.message);
}

`;
}

function generateMasterTitleCode(config: InternalMasterSlideConfig): string {
  const logoCode = config.branding?.logoUrl
    ? `    ...(logoData ? [{
      image: {
        data: 'image/png;base64,' + logoData,
        x: ${config.logoCoords.x}, y: ${config.logoCoords.y}, w: ${config.logoW}, h: ${config.logoH}
      }
    }] : []),`
    : "";
  const companyNameCode = config.branding?.companyName
    ? `    { text: { text: ${JSON.stringify(config.branding.companyName)}, options: {
      x: 0.5, y: 6.8, w: 5, h: 0.4,
      fontFace: '${FONTS.heading}', fontSize: 14, color: '${config.palette.textMuted}'
    }}},`
    : "";
  const taglineCode = config.branding?.tagline
    ? `    { text: { text: ${JSON.stringify(config.branding.tagline)}, options: {
      x: 0.5, y: 7.1, w: 8, h: 0.3,
      fontFace: '${FONTS.body}', fontSize: 11, italic: true, color: '${config.palette.textMuted}'
    }}},`
    : "";
  const slideNumberCode = config.showSlideNumbers
    ? `  slideNumber: { x: 12.5, y: 7.1, fontFace: '${FONTS.body}', fontSize: 10, color: '${config.palette.textMuted}' },`
    : "";

  return `
// ============ MASTER: TITLE (for opening/title slides) ============
pptx.defineSlideMaster({
  title: 'MASTER_TITLE',
  background: { color: '${config.palette.background}' },
  objects: [
    { rect: { x: 0, y: 5.5, w: '100%', h: 2.0, fill: { color: '${config.palette.surface}' } } },
    { rect: { x: 0, y: 7.3, w: '100%', h: 0.2, fill: { color: '${config.palette.primary}' } } },
    { rect: { x: 0, y: 0, w: 0.3, h: '100%', fill: { color: '${config.palette.primary}' } } },
${logoCode}
${companyNameCode}
${taglineCode}
  ],
${slideNumberCode}
});

`;
}

function generateMasterContentCode(config: InternalMasterSlideConfig): string {
  const logoCode = config.branding?.logoUrl
    ? `    ...(logoData ? [{
      image: {
        data: 'image/png;base64,' + logoData,
        x: ${13.33 - config.logoW - 0.2}, y: 0.15, w: ${config.logoW * 0.7}, h: ${config.logoH * 0.7}
      }
    }] : []),`
    : "";
  const footerCode =
    config.showFooter && config.footerText
      ? `    { text: { text: ${JSON.stringify(config.footerText)}, options: {
      x: 0.5, y: 7.1, w: 4, h: 0.3,
      fontFace: '${FONTS.body}', fontSize: 9, color: '${config.palette.textMuted}'
    }}},`
      : "";
  const dateCode = config.showDate
    ? `    { text: { text: ${JSON.stringify(config.branding?.customDateText || new Date().toLocaleDateString())}, options: {
      x: 5.5, y: 7.1, w: 3, h: 0.3,
      fontFace: '${FONTS.body}', fontSize: 9, color: '${config.palette.textMuted}', align: 'center'
    }}},`
    : "";
  const slideNumberCode = config.showSlideNumbers
    ? `  slideNumber: { x: 12.5, y: 7.1, fontFace: '${FONTS.body}', fontSize: 10, color: '${config.palette.textMuted}' },`
    : "";

  return `
// ============ MASTER: CONTENT (for regular content slides) ============
pptx.defineSlideMaster({
  title: 'MASTER_CONTENT',
  background: { color: '${config.palette.background}' },
  objects: [
    masterObjects.accentBar,
    masterObjects.footerBar,
${logoCode}
${footerCode}
${dateCode}
  ],
${slideNumberCode}
});

`;
}

function generateMasterSectionCode(config: InternalMasterSlideConfig): string {
  const logoCode = config.branding?.logoUrl
    ? `    ...(logoData ? [{
      image: {
        data: 'image/png;base64,' + logoData,
        x: 0.5, y: 6.5, w: ${config.logoW * 0.8}, h: ${config.logoH * 0.8}
      }
    }] : []),`
    : "";
  const slideNumberCode = config.showSlideNumbers
    ? `  slideNumber: { x: 12.5, y: 7.1, fontFace: '${FONTS.body}', fontSize: 10, color: '${config.palette.textMuted}' },`
    : "";

  return `
// ============ MASTER: SECTION (for section divider slides) ============
pptx.defineSlideMaster({
  title: 'MASTER_SECTION',
  background: { color: '${config.palette.primary}' },
  objects: [
    { rect: { x: 6, y: 0, w: 7.33, h: '100%', fill: { color: '${config.palette.background}' } } },
    { rect: { x: 5.9, y: 2, w: 0.1, h: 3.5, fill: { color: '${config.palette.accent}' } } },
${logoCode}
  ],
${slideNumberCode}
});

`;
}

function generateMasterBlankCode(config: InternalMasterSlideConfig): string {
  const logoCode = config.branding?.logoUrl
    ? `    ...(logoData ? [{
      image: {
        data: 'image/png;base64,' + logoData,
        x: ${13.33 - config.logoW * 0.5 - 0.2}, y: 0.15, w: ${config.logoW * 0.5}, h: ${config.logoH * 0.5}
      }
    }] : []),`
    : "";
  const slideNumberCode = config.showSlideNumbers
    ? `  slideNumber: { x: 12.5, y: 7.1, fontFace: '${FONTS.body}', fontSize: 10, color: '${config.palette.textMuted}' },`
    : "";

  return `
// ============ MASTER: BLANK (minimal branding) ============
pptx.defineSlideMaster({
  title: 'MASTER_BLANK',
  background: { color: '${config.palette.background}' },
  objects: [
    { rect: { x: 0, y: 0, w: '100%', h: 0.03, fill: { color: '${config.palette.primary}' } } },
${logoCode}
  ],
${slideNumberCode}
});

`;
}

function generateMasterDarkCode(config: InternalMasterSlideConfig): string {
  const logoCode = config.branding?.logoUrl
    ? `    ...(logoData ? [{
      image: {
        data: 'image/png;base64,' + logoData,
        x: ${13.33 - config.logoW - 0.3}, y: 0.2, w: ${config.logoW}, h: ${config.logoH}
      }
    }] : []),`
    : "";
  const slideNumberCode = config.showSlideNumbers
    ? `  slideNumber: { x: 12.5, y: 7.1, fontFace: '${FONTS.body}', fontSize: 10, color: '${config.palette.text}' },`
    : "";

  return `
// ============ MASTER: DARK (for high-impact slides) ============
pptx.defineSlideMaster({
  title: 'MASTER_DARK',
  background: { color: '${config.palette.surface}' },
  objects: [
    { rect: { x: 0, y: 7.35, w: '100%', h: 0.15, fill: { color: '${config.palette.primary}' } } },
    { rect: { x: 0, y: 0, w: 0.5, h: 0.5, fill: { color: '${config.palette.accent}' } } },
${logoCode}
  ],
${slideNumberCode}
});

`;
}

function generateMasterImageCode(config: InternalMasterSlideConfig): string {
  const slideNumberCode = config.showSlideNumbers
    ? `  slideNumber: { x: 12.5, y: 7.1, fontFace: '${FONTS.body}', fontSize: 10, color: '${config.palette.textInverse}' },`
    : "";

  return `
// ============ MASTER: IMAGE (for full-bleed image slides) ============
pptx.defineSlideMaster({
  title: 'MASTER_IMAGE',
  background: { color: '${config.palette.background}' },
  objects: [
    { rect: { x: 0, y: 7.2, w: '100%', h: 0.3, fill: { color: '${config.palette.surface}', transparency: 90 } } }
  ],
${slideNumberCode}
});

`;
}

/**
 * Generate complete master slides code with branding support
 * Creates multiple master layouts: TITLE, CONTENT, SECTION, BLANK
 */
export function generateMasterSlidesCode(
  paletteName: string,
  branding?: BrandingConfig,
): string {
  const palette = getPalette(paletteName);
  const logoPos = branding?.logoPosition || "top-right";
  const logoW = branding?.logoSize?.width || 1;
  const logoH = branding?.logoSize?.height || 0.5;
  const showSlideNumbers = branding?.showSlideNumbers !== false;
  const showFooter = branding?.showFooter !== false;
  const footerText = branding?.footerText || branding?.companyName || "";
  const showDate = branding?.showDate || false;

  // Calculate logo position coordinates
  const logoPositions = {
    "top-left": { x: 0.3, y: 0.2 },
    "top-right": { x: 13.33 - logoW - 0.3, y: 0.2 },
    "bottom-left": { x: 0.3, y: 7.5 - logoH - 0.2 },
    "bottom-right": { x: 13.33 - logoW - 0.3, y: 7.5 - logoH - 0.2 },
  };
  const logoCoords = logoPositions[logoPos];

  const config: InternalMasterSlideConfig = {
    palette,
    branding,
    logoCoords,
    logoW,
    logoH,
    showSlideNumbers,
    showFooter,
    footerText,
    showDate,
  };

  let code = `
// ============================================================================
// MASTER SLIDES DEFINITION - Professional branding and consistent styling
// ============================================================================

// Define master slide objects (shared elements)
const masterObjects = {
  // Top accent bar
  accentBar: {
    rect: { x: 0, y: 0, w: '100%', h: 0.06, fill: { color: '${palette.primary}' } }
  },
  // Bottom surface bar
  footerBar: {
    rect: { x: 0, y: 7.0, w: '100%', h: 0.5, fill: { color: '${palette.surface}' } }
  },
  // Left accent bar (for section slides)
  leftAccent: {
    rect: { x: 0, y: 0, w: 0.15, h: '100%', fill: { color: '${palette.primary}' } }
  }
};

`;

  code += generateLogoCode(config);
  code += generateMasterTitleCode(config);
  code += generateMasterContentCode(config);
  code += generateMasterSectionCode(config);
  code += generateMasterBlankCode(config);
  code += generateMasterDarkCode(config);
  code += generateMasterImageCode(config);

  // Add watermark if configured
  if (branding?.watermark) {
    const wmPos =
      branding.watermark.position === "center"
        ? { x: 4, y: 3 }
        : { x: 9, y: 6 };
    code += `
// Apply watermark to all slides after creation
const applyWatermark = (slide) => {
  slide.addText(${JSON.stringify(branding.watermark.text)}, {
    x: ${wmPos.x}, y: ${wmPos.y}, w: 5, h: 1,
    fontFace: '${FONTS.heading}',
    fontSize: 36,
    color: '${palette.textMuted}',
    transparency: ${Math.round((1 - branding.watermark.opacity) * 100)},
    rotate: -30
  });
};

`;
  }

  return code;
}

/**
 * Get the appropriate master slide name for a slide type
 */
export function getMasterForSlideType(slideType: SlideLayoutType): string {
  switch (slideType) {
    case "title":
    case "thank-you":
      return "MASTER_TITLE";
    case "section":
      return "MASTER_SECTION";
    case "image-full":
    case "image-grid":
      return "MASTER_IMAGE";
    case "quote":
    case "big-number":
    case "stats":
      return "MASTER_DARK";
    case "blank":
      return "MASTER_BLANK";
    default:
      return "MASTER_CONTENT";
  }
}

// Generate slide background options
export function getSlideBackground(
  palette: ColorPalette,
  variant: "solid" | "gradient" | "dark" | "accent" = "solid",
) {
  switch (variant) {
    case "gradient":
      return {
        fill: {
          type: "solid",
          color: palette.background,
        },
      };
    case "dark":
      return {
        fill: {
          type: "solid",
          color: palette.surface,
        },
      };
    case "accent":
      return {
        fill: {
          type: "solid",
          color: palette.primary,
        },
      };
    default:
      return {
        fill: {
          type: "solid",
          color: palette.background,
        },
      };
  }
}

/**
 * Generate image fetching code for local execution
 * This runs before slide generation to pre-fetch all images
 */
export function generateImageFetchingCode(slides: SlideContent[]): {
  code: string;
  imageVarMap: Map<number, string>;
} {
  const imageVarMap = new Map<number, string>();
  const imagesToFetch: Array<{ url: string; varName: string }> = [];

  slides.forEach((slide, index) => {
    if (slide.imageUrl) {
      const varName = `image_slide${index}`;
      imageVarMap.set(index, varName);
      imagesToFetch.push({ url: slide.imageUrl, varName });
    }
    // Handle multiple images for grid layouts
    if (slide.images && slide.images.length > 0) {
      slide.images.forEach((imgUrl, imgIdx) => {
        const varName = `image_slide${index}_${imgIdx}`;
        imagesToFetch.push({ url: imgUrl, varName });
      });
    }
    // Handle team member images
    if (slide.teamMembers) {
      slide.teamMembers.forEach((member, memberIdx) => {
        if (member.imageUrl) {
          const varName = `image_slide${index}_member${memberIdx}`;
          imagesToFetch.push({ url: member.imageUrl, varName });
        }
      });
    }
  });

  if (imagesToFetch.length === 0) {
    return { code: "", imageVarMap };
  }

  const code = `
// ============================================================================
// IMAGE FETCHING - Pre-fetch all images before slide generation
// ============================================================================
async function fetchImageAsBase64(url) {
  try {
    console.log('Fetching image:', url);
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Shadower/1.0)',
        'Accept': 'image/*'
      }
    });
    if (!response.ok) {
      console.warn('Failed to fetch image:', url, response.status);
      return null;
    }
    const buffer = await response.arrayBuffer();
    const base64 = Buffer.from(buffer).toString('base64');
    const contentType = response.headers.get('content-type') || 'image/png';
    console.log('Successfully fetched image:', url);
    return { data: base64, mimeType: contentType };
  } catch (error) {
    console.warn('Error fetching image:', url, error.message);
    return null;
  }
}

// Fetch all images in parallel
const imagePromises = {
${imagesToFetch.map(({ url, varName }) => `  ${varName}: fetchImageAsBase64(${JSON.stringify(url)})`).join(",\n")}
};

const imageResults = {};
await Promise.all(
  Object.entries(imagePromises).map(async ([key, promise]) => {
    imageResults[key] = await promise;
  })
);

// Helper function to add image to slide with fallback
function addImageToSlide(slide, imageData, options) {
  if (imageData && imageData.data) {
    slide.addImage({
      data: 'data:' + imageData.mimeType + ';base64,' + imageData.data,
      x: options.x,
      y: options.y,
      w: options.w,
      h: options.h,
      sizing: options.sizing || { type: 'contain', w: options.w, h: options.h },
      rounding: options.rounding || false,
      shadow: options.shadow,
      hyperlink: options.hyperlink
    });
    return true;
  } else {
    // Fallback: show placeholder
    slide.addShape('rect', {
      x: options.x, y: options.y, w: options.w, h: options.h,
      fill: { color: options.placeholderColor || 'F5F5F5' },
      line: { color: 'E0E0E0', width: 1 }
    });
    slide.addText(options.placeholderText || 'Image', {
      x: options.x, y: options.y + options.h / 2 - 0.2, w: options.w, h: 0.4,
      fontSize: 14,
      color: '999999',
      align: 'center',
      valign: 'middle'
    });
    return false;
  }
}
`;

  return { code, imageVarMap };
}

// Generate code for a title slide - MANUS/GAMMA QUALITY
export function generateTitleSlideCode(
  content: SlideContent,
  palette: ColorPalette,
  transition: SlideTransition = "fade",
  slideIndex: number = 0,
  hasImage: boolean = false,
): string {
  const v = `slide${slideIndex}`;
  const safeTitle = JSON.stringify(content.title || "Presentation Title");
  const safeSubtitle = content.subtitle
    ? JSON.stringify(content.subtitle)
    : null;

  let imageCode = "";
  if (hasImage && content.imageUrl) {
    imageCode = `
// Background image for title slide (full bleed)
addImageToSlide(${v}, imageResults.image_slide${slideIndex}, {
  x: 0, y: 0, w: 13.33, h: 7.5,
  sizing: { type: 'cover', w: 13.33, h: 7.5 },
  placeholderColor: '${palette.surface}'
});

// Gradient overlay for text readability (darker at bottom)
${v}.addShape('rect', {
  x: 0, y: 0, w: 13.33, h: 3,
  fill: { color: '000000', transparency: 70 }
});
${v}.addShape('rect', {
  x: 0, y: 3, w: 13.33, h: 2.5,
  fill: { color: '000000', transparency: 50 }
});
${v}.addShape('rect', {
  x: 0, y: 5.5, w: 13.33, h: 2,
  fill: { color: '000000', transparency: 30 }
});
`;
  }

  // Choose between image-based title or gradient design
  const noImageDesign = !hasImage
    ? `
// ========== GRADIENT BACKGROUND DESIGN (Manus-style) ==========

// Large decorative circle (top-right)
${v}.addShape('ellipse', {
  x: 9, y: -2, w: 6, h: 6,
  fill: { color: '${palette.primary}', transparency: 88 }
});

// Medium decorative circle (bottom-left)
${v}.addShape('ellipse', {
  x: -2, y: 5, w: 5, h: 5,
  fill: { color: '${palette.accent}', transparency: 90 }
});

// Gradient overlay strip at bottom
${v}.addShape('rect', {
  x: 0, y: 5.5, w: 13.33, h: 2,
  fill: { color: '${palette.surface}', transparency: 50 }
});

// Left accent bar (bold)
${v}.addShape('rect', {
  x: 0, y: 0, w: 0.35, h: 7.5,
  fill: { color: '${palette.primary}' }
});

// Bottom accent bar
${v}.addShape('rect', {
  x: 0, y: 7.3, w: 13.33, h: 0.2,
  fill: { color: '${palette.primary}' }
});

// Decorative dots pattern (subtle)
${v}.addShape('ellipse', { x: 11.5, y: 1, w: 0.15, h: 0.15, fill: { color: '${palette.primary}', transparency: 60 } });
${v}.addShape('ellipse', { x: 11.9, y: 1, w: 0.15, h: 0.15, fill: { color: '${palette.primary}', transparency: 60 } });
${v}.addShape('ellipse', { x: 12.3, y: 1, w: 0.15, h: 0.15, fill: { color: '${palette.primary}', transparency: 60 } });
${v}.addShape('ellipse', { x: 11.5, y: 1.4, w: 0.15, h: 0.15, fill: { color: '${palette.primary}', transparency: 60 } });
${v}.addShape('ellipse', { x: 11.9, y: 1.4, w: 0.15, h: 0.15, fill: { color: '${palette.primary}', transparency: 60 } });
${v}.addShape('ellipse', { x: 12.3, y: 1.4, w: 0.15, h: 0.15, fill: { color: '${palette.primary}', transparency: 60 } });
`
    : "";

  return `
// ============================================================================
// TITLE SLIDE - Manus/Gamma Quality Design
// ============================================================================
const ${v} = pptx.addSlide();
${v}.background = { color: '${palette.background}' };
${transition !== "none" ? `${v}.transition = { type: '${transition}', speed: 'medium' };` : ""}

${imageCode}
${noImageDesign}

// ========== TITLE CONTENT ==========

// Main title with shadow effect
${v}.addText(${safeTitle}, {
  x: 0.8, y: 2.5, w: 11.73, h: 1.4,
  fontFace: '${FONTS.heading}',
  fontSize: 52,
  bold: true,
  color: '${hasImage ? "FFFFFF" : palette.text}',
  align: 'center',
  valign: 'middle',
  shadow: { type: 'outer', blur: 4, offset: 2, angle: 45, opacity: 0.15, color: '000000' }
});

${
  safeSubtitle
    ? `
// Subtitle with refined typography
${v}.addText(${safeSubtitle}, {
  x: 1.5, y: 4.1, w: 10.33, h: 0.7,
  fontFace: '${FONTS.body}',
  fontSize: 22,
  color: '${hasImage ? "EEEEEE" : palette.textMuted}',
  align: 'center',
  valign: 'middle'
});`
    : ""
}

// Decorative separator line
${v}.addShape('rect', {
  x: 5.17, y: 5.0, w: 3, h: 0.06,
  fill: { color: '${palette.primary}' },
  shadow: { type: 'outer', blur: 3, offset: 1, angle: 90, opacity: 0.3, color: '${palette.primary}' }
});

// Small accent shapes flanking the line
${v}.addShape('ellipse', {
  x: 4.87, y: 4.95, w: 0.16, h: 0.16,
  fill: { color: '${palette.accent}' }
});
${v}.addShape('ellipse', {
  x: 8.3, y: 4.95, w: 0.16, h: 0.16,
  fill: { color: '${palette.accent}' }
});

${content.notes ? `${v}.addNotes(${JSON.stringify(content.notes)});` : ""}
`;
}

// Generate code for a section header slide
// Generate code for a section divider slide - MANUS/GAMMA QUALITY
export function generateSectionSlideCode(
  content: SlideContent,
  palette: ColorPalette,
  transition: SlideTransition = "fade",
  slideIndex: number = 0,
): string {
  const v = `slide${slideIndex}`;
  const safeTitle = JSON.stringify(content.title || "Section Title");
  const safeSubtitle = content.subtitle
    ? JSON.stringify(content.subtitle)
    : null;

  // Calculate section number (typically based on occurrence of section slides)
  const sectionNum = String(slideIndex + 1).padStart(2, "0");

  return `
// ============================================================================
// SECTION DIVIDER SLIDE - Manus/Gamma Quality Design
// ============================================================================
const ${v} = pptx.addSlide();
${v}.background = { color: '${palette.primary}' };
${transition !== "none" ? `${v}.transition = { type: '${transition}', speed: 'medium' };` : ""}

// ========== GEOMETRIC BACKGROUND ELEMENTS ==========

// Large decorative circle (top-right, off-canvas)
${v}.addShape('ellipse', {
  x: 8, y: -3, w: 8, h: 8,
  fill: { color: '${palette.primaryDark}', transparency: 50 }
});

// Medium decorative circle (bottom-left)
${v}.addShape('ellipse', {
  x: -2, y: 5, w: 5, h: 5,
  fill: { color: '${palette.accent}', transparency: 70 }
});

// Right side panel (lighter shade)
${v}.addShape('rect', {
  x: 6.5, y: 0, w: 6.83, h: 7.5,
  fill: { color: '${palette.background}' }
});

// Vertical accent line
${v}.addShape('rect', {
  x: 6.4, y: 1.5, w: 0.1, h: 4.5,
  fill: { color: '${palette.accent}' }
});

// ========== SECTION NUMBER ==========

// Number background circle
${v}.addShape('ellipse', {
  x: 1, y: 2.25, w: 3, h: 3,
  fill: { color: '${palette.primaryDark}' },
  shadow: { type: 'outer', blur: 15, offset: 5, angle: 135, opacity: 0.3, color: '000000' }
});

// Section number
${v}.addText('${sectionNum}', {
  x: 1, y: 2.65, w: 3, h: 2.2,
  fontFace: '${FONTS.heading}',
  fontSize: 64,
  bold: true,
  color: '${palette.textInverse}',
  align: 'center',
  valign: 'middle'
});

// ========== SECTION TITLE ==========

// Title area
${v}.addText(${safeTitle}, {
  x: 6.8, y: 2.5, w: 6, h: 1.5,
  fontFace: '${FONTS.heading}',
  fontSize: 36,
  bold: true,
  color: '${palette.text}',
  valign: 'middle'
});

// Title underline accent
${v}.addShape('rect', {
  x: 6.8, y: 4.1, w: 3, h: 0.08,
  fill: { color: '${palette.primary}' }
});

${
  safeSubtitle
    ? `
// Section subtitle/description
${v}.addText(${safeSubtitle}, {
  x: 6.8, y: 4.4, w: 5.8, h: 1.5,
  fontFace: '${FONTS.body}',
  fontSize: 18,
  color: '${palette.textMuted}',
  valign: 'top',
  lineSpacing: 24
});`
    : ""
}

// ========== DECORATIVE DOTS ==========
${v}.addShape('ellipse', { x: 1.2, y: 6.2, w: 0.12, h: 0.12, fill: { color: '${palette.textInverse}', transparency: 50 } });
${v}.addShape('ellipse', { x: 1.5, y: 6.2, w: 0.12, h: 0.12, fill: { color: '${palette.textInverse}', transparency: 50 } });
${v}.addShape('ellipse', { x: 1.8, y: 6.2, w: 0.12, h: 0.12, fill: { color: '${palette.textInverse}', transparency: 50 } });
${v}.addShape('ellipse', { x: 2.1, y: 6.2, w: 0.12, h: 0.12, fill: { color: '${palette.textInverse}', transparency: 50 } });
${v}.addShape('ellipse', { x: 2.4, y: 6.2, w: 0.12, h: 0.12, fill: { color: '${palette.textInverse}', transparency: 50 } });

${content.notes ? `${v}.addNotes(${JSON.stringify(content.notes)});` : ""}
`;
}

// Generate code for a content slide with bullets
// Generate code for a content slide with bullets - MANUS/GAMMA QUALITY
export function generateContentSlideCode(
  content: SlideContent,
  palette: ColorPalette,
  transition: SlideTransition = "fade",
  slideIndex: number = 0,
): string {
  const v = `slide${slideIndex}`;
  const safeTitle = JSON.stringify(content.title || "Slide Title");
  const bullets = Array.isArray(content.content)
    ? content.content
    : [content.content || "Add your content here"];

  // Enhanced bullet styling with custom icons
  const bulletItems = bullets
    .map(
      (item, _idx) => `
    { text: ${JSON.stringify(item)}, options: {
      bullet: { type: 'bullet', color: '${palette.primary}' },
      indentLevel: 0,
      paraSpaceAfter: 12
    } }`,
    )
    .join(",");

  return `
// ============================================================================
// CONTENT SLIDE - Manus/Gamma Quality Design
// ============================================================================
const ${v} = pptx.addSlide();
${v}.background = { color: '${palette.background}' };
${transition !== "none" ? `${v}.transition = { type: '${transition}', speed: 'medium' };` : ""}

// ========== DECORATIVE ELEMENTS ==========

// Left accent bar
${v}.addShape('rect', {
  x: 0, y: 0, w: 0.2, h: 7.5,
  fill: { color: '${palette.primary}' }
});

// Bottom accent stripe
${v}.addShape('rect', {
  x: 0, y: 7.35, w: 13.33, h: 0.15,
  fill: { color: '${palette.primary}' }
});

// Subtle corner decoration
${v}.addShape('ellipse', {
  x: 11.5, y: -1, w: 3, h: 3,
  fill: { color: '${palette.primary}', transparency: 92 }
});

// ========== HEADER SECTION ==========

// Title background card
${v}.addShape('roundRect', {
  x: 0.4, y: 0.25, w: 12.53, h: 1.0,
  fill: { color: '${palette.surface}' },
  rectRadius: 0.08,
  shadow: { type: 'outer', blur: 6, offset: 2, angle: 45, opacity: 0.1, color: '000000' }
});

// Slide title
${v}.addText(${safeTitle}, {
  x: 0.6, y: 0.35, w: 11.5, h: 0.8,
  fontFace: '${FONTS.heading}',
  fontSize: 32,
  bold: true,
  color: '${palette.text}'
});

// Title accent bar
${v}.addShape('rect', {
  x: 0.4, y: 0.25, w: 0.12, h: 1.0,
  fill: { color: '${palette.primary}' }
});

// ========== CONTENT AREA ==========

// Content container card
${v}.addShape('roundRect', {
  x: 0.4, y: 1.5, w: 12.53, h: 5.6,
  fill: { color: '${palette.background}' },
  line: { color: '${palette.surface}', width: 1 },
  rectRadius: 0.08
});

// Bullet content with improved spacing
${v}.addText([${bulletItems}
], {
  x: 0.7, y: 1.8, w: 12, h: 5.0,
  fontFace: '${FONTS.body}',
  fontSize: 18,
  color: '${palette.text}',
  valign: 'top',
  lineSpacing: 32
});

${content.notes ? `${v}.addNotes(${JSON.stringify(content.notes)});` : ""}
`;
}

// Generate code for a two-column slide
export function generateTwoColumnSlideCode(
  content: SlideContent,
  palette: ColorPalette,
  transition: SlideTransition = "fade",
  slideIndex: number = 0,
): string {
  const v = `slide${slideIndex}`;
  const safeTitle = JSON.stringify(content.title || "Comparison");
  const leftItems = Array.isArray(content.leftContent)
    ? content.leftContent
    : [content.leftContent || "Left column content"];
  const rightItems = Array.isArray(content.rightContent)
    ? content.rightContent
    : [content.rightContent || "Right column content"];

  return `
// Two-Column Slide
const ${v} = pptx.addSlide();
${v}.background = { color: '${palette.background}' };
${transition !== "none" ? `${v}.transition = { type: '${transition}', speed: 'medium' };` : ""}

// Slide title
${v}.addText(${safeTitle}, {
  x: 0.5, y: 0.4, w: 12.33, h: 0.8,
  fontFace: '${FONTS.heading}',
  fontSize: 36,
  bold: true,
  color: '${palette.text}'
});

// Left column background
${v}.addShape('rect', {
  x: 0.5, y: 1.4, w: 5.9, h: 5.6,
  fill: { color: '${palette.surface}' },
  shadow: { type: 'outer', blur: 4, offset: 2, angle: 45, opacity: 0.15 }
});

// Right column background
${v}.addShape('rect', {
  x: 6.93, y: 1.4, w: 5.9, h: 5.6,
  fill: { color: '${palette.surfaceAlt}' },
  shadow: { type: 'outer', blur: 4, offset: 2, angle: 45, opacity: 0.15 }
});

// Left column content
${v}.addText(${JSON.stringify(leftItems.join("\n\n"))}, {
  x: 0.7, y: 1.6, w: 5.5, h: 5.2,
  fontFace: '${FONTS.body}',
  fontSize: 18,
  color: '${palette.text}',
  valign: 'top'
});

// Right column content
${v}.addText(${JSON.stringify(rightItems.join("\n\n"))}, {
  x: 7.13, y: 1.6, w: 5.5, h: 5.2,
  fontFace: '${FONTS.body}',
  fontSize: 18,
  color: '${palette.text}',
  valign: 'top'
});

${content.notes ? `${v}.addNotes(${JSON.stringify(content.notes)});` : ""}
`;
}

// Generate code for a three-column slide
// Generate code for a three-column feature cards slide - MANUS/GAMMA QUALITY
export function generateThreeColumnSlideCode(
  content: SlideContent,
  palette: ColorPalette,
  transition: SlideTransition = "fade",
  slideIndex: number = 0,
): string {
  const v = `slide${slideIndex}`;
  const safeTitle = JSON.stringify(content.title || "Features");
  const items = content.items || [
    { title: "Feature 1", description: "Description 1" },
    { title: "Feature 2", description: "Description 2" },
    { title: "Feature 3", description: "Description 3" },
  ];

  // Icon symbols for cards
  const iconSymbols = ["◆", "●", "★", "▲", "■", "◈"];

  let columnsCode = "";
  items.slice(0, 3).forEach((item, idx) => {
    const xPos = 0.5 + idx * 4.11;
    const iconSymbol = iconSymbols[idx % iconSymbols.length];
    columnsCode += `
// ========== CARD ${idx + 1} ==========

// Card background with shadow
${v}.addShape('roundRect', {
  x: ${xPos}, y: 1.6, w: 3.9, h: 5.4,
  fill: { color: '${palette.surface}' },
  rectRadius: 0.12,
  shadow: { type: 'outer', blur: 10, offset: 4, angle: 45, opacity: 0.18, color: '000000' }
});

// Top accent bar
${v}.addShape('rect', {
  x: ${xPos}, y: 1.6, w: 3.9, h: 0.1,
  fill: { color: '${palette.primary}' }
});

// Icon circle
${v}.addShape('ellipse', {
  x: ${xPos + 0.3}, y: 1.9, w: 0.9, h: 0.9,
  fill: { color: '${palette.primary}' },
  shadow: { type: 'outer', blur: 4, offset: 2, angle: 45, opacity: 0.2, color: '${palette.primary}' }
});

// Icon symbol
${v}.addText('${iconSymbol}', {
  x: ${xPos + 0.3}, y: 1.95, w: 0.9, h: 0.8,
  fontSize: 22,
  color: '${palette.textInverse}',
  align: 'center',
  valign: 'middle'
});

// Card title
${v}.addText(${JSON.stringify(item.title || `Feature ${idx + 1}`)}, {
  x: ${xPos + 0.25}, y: 3.0, w: 3.4, h: 0.6,
  fontFace: '${FONTS.heading}',
  fontSize: 18,
  bold: true,
  color: '${palette.text}'
});

// Separator line
${v}.addShape('rect', {
  x: ${xPos + 0.25}, y: 3.6, w: 1.5, h: 0.04,
  fill: { color: '${palette.accent}' }
});

// Card description
${v}.addText(${JSON.stringify(item.description || "")}, {
  x: ${xPos + 0.25}, y: 3.85, w: 3.4, h: 2.9,
  fontFace: '${FONTS.body}',
  fontSize: 14,
  color: '${palette.textMuted}',
  valign: 'top',
  lineSpacing: 22
});
`;
  });

  return `
// ============================================================================
// THREE-COLUMN FEATURE CARDS - Manus/Gamma Quality Design
// ============================================================================
const ${v} = pptx.addSlide();
${v}.background = { color: '${palette.background}' };
${transition !== "none" ? `${v}.transition = { type: '${transition}', speed: 'medium' };` : ""}

// ========== DECORATIVE ELEMENTS ==========

// Left accent bar
${v}.addShape('rect', {
  x: 0, y: 0, w: 0.15, h: 7.5,
  fill: { color: '${palette.primary}' }
});

// Bottom accent bar
${v}.addShape('rect', {
  x: 0, y: 7.35, w: 13.33, h: 0.15,
  fill: { color: '${palette.primary}' }
});

// Decorative circles
${v}.addShape('ellipse', {
  x: -1, y: -1, w: 3, h: 3,
  fill: { color: '${palette.primary}', transparency: 93 }
});
${v}.addShape('ellipse', {
  x: 12, y: 5.5, w: 2.5, h: 2.5,
  fill: { color: '${palette.accent}', transparency: 93 }
});

// ========== HEADER ==========

// Slide title
${v}.addText(${safeTitle}, {
  x: 0.5, y: 0.4, w: 12.33, h: 0.9,
  fontFace: '${FONTS.heading}',
  fontSize: 32,
  bold: true,
  color: '${palette.text}'
});

// Title underline
${v}.addShape('rect', {
  x: 0.5, y: 1.25, w: 2.5, h: 0.06,
  fill: { color: '${palette.primary}' }
});

// ========== FEATURE CARDS ==========
${columnsCode}

${content.notes ? `${v}.addNotes(${JSON.stringify(content.notes)});` : ""}
`;
}

// Generate code for a big number/stats slide
export function generateStatsSlideCode(
  content: SlideContent,
  palette: ColorPalette,
  transition: SlideTransition = "fade",
  slideIndex: number = 0,
): string {
  const v = `slide${slideIndex}`;
  const safeTitle = JSON.stringify(content.title || "Key Metric");
  const safeNumber = JSON.stringify(String(content.number || "100%"));
  const safeLabel = JSON.stringify(
    content.label || "Description of the metric",
  );

  return `
// Stats/Big Number Slide
const ${v} = pptx.addSlide();
${v}.background = { color: '${palette.background}' };
${transition !== "none" ? `${v}.transition = { type: '${transition}', speed: 'medium' };` : ""}

// Slide title
${v}.addText(${safeTitle}, {
  x: 0.5, y: 0.4, w: 12.33, h: 0.8,
  fontFace: '${FONTS.heading}',
  fontSize: 32,
  bold: true,
  color: '${palette.text}'
});

// Big number with glow effect background
${v}.addShape('rect', {
  x: 3.67, y: 1.5, w: 6, h: 3.5,
  fill: { color: '${palette.surface}' },
  shadow: { type: 'outer', blur: 20, offset: 0, angle: 0, opacity: 0.2, color: '${palette.primary}' }
});

// Big number
${v}.addText(${safeNumber}, {
  x: 0.5, y: 2, w: 12.33, h: 2.5,
  fontFace: '${FONTS.heading}',
  fontSize: 120,
  bold: true,
  color: '${palette.primary}',
  align: 'center',
  valign: 'middle'
});

// Label
${v}.addText(${safeLabel}, {
  x: 0.5, y: 4.8, w: 12.33, h: 0.8,
  fontFace: '${FONTS.body}',
  fontSize: 24,
  color: '${palette.textMuted}',
  align: 'center',
  valign: 'middle'
});

// Decorative elements
${v}.addShape('rect', {
  x: 5.67, y: 5.8, w: 2, h: 0.08,
  fill: { color: '${palette.primary}' }
});

${content.notes ? `${v}.addNotes(${JSON.stringify(content.notes)});` : ""}
`;
}

// Generate code for multiple stats slide
export function generateMultiStatsSlideCode(
  content: SlideContent,
  palette: ColorPalette,
  transition: SlideTransition = "fade",
  slideIndex: number = 0,
): string {
  const v = `slide${slideIndex}`;
  const safeTitle = JSON.stringify(content.title || "Key Metrics");
  const items = content.items || [
    { value: "100%", title: "Metric 1" },
    { value: "50K", title: "Metric 2" },
    { value: "24/7", title: "Metric 3" },
    { value: "99.9%", title: "Metric 4" },
  ];

  let statsCode = "";
  const numStats = Math.min(items.length, 4);
  const statWidth = 12.33 / numStats;

  items.slice(0, 4).forEach((item, idx) => {
    const xPos = 0.5 + idx * statWidth;
    statsCode += `
// Stat ${idx + 1}
${v}.addShape('rect', {
  x: ${xPos}, y: 1.8, w: ${statWidth - 0.2}, h: 4.5,
  fill: { color: '${idx % 2 === 0 ? palette.surface : palette.surfaceAlt}' },
  shadow: { type: 'outer', blur: 4, offset: 2, angle: 45, opacity: 0.15 }
});

${v}.addText(${JSON.stringify(String(item.value || "0"))}, {
  x: ${xPos}, y: 2.5, w: ${statWidth - 0.2}, h: 1.5,
  fontFace: '${FONTS.heading}',
  fontSize: 48,
  bold: true,
  color: '${palette.primary}',
  align: 'center',
  valign: 'middle'
});

${v}.addText(${JSON.stringify(item.title || `Metric ${idx + 1}`)}, {
  x: ${xPos}, y: 4.2, w: ${statWidth - 0.2}, h: 0.8,
  fontFace: '${FONTS.body}',
  fontSize: 16,
  color: '${palette.text}',
  align: 'center',
  valign: 'middle'
});

${
  item.description
    ? `
${v}.addText(${JSON.stringify(item.description)}, {
  x: ${xPos}, y: 5, w: ${statWidth - 0.2}, h: 0.8,
  fontFace: '${FONTS.body}',
  fontSize: 12,
  color: '${palette.textMuted}',
  align: 'center',
  valign: 'top'
});`
    : ""
}
`;
  });

  return `
// Multi-Stats Slide
const ${v} = pptx.addSlide();
${v}.background = { color: '${palette.background}' };
${transition !== "none" ? `${v}.transition = { type: '${transition}', speed: 'medium' };` : ""}

// Slide title
${v}.addText(${safeTitle}, {
  x: 0.5, y: 0.4, w: 12.33, h: 0.8,
  fontFace: '${FONTS.heading}',
  fontSize: 36,
  bold: true,
  color: '${palette.text}'
});

// Title underline
${v}.addShape('rect', {
  x: 0.5, y: 1.15, w: 2, h: 0.05,
  fill: { color: '${palette.primary}' }
});

${statsCode}

${content.notes ? `${v}.addNotes(${JSON.stringify(content.notes)});` : ""}
`;
}

// Generate code for a quote slide
export function generateQuoteSlideCode(
  content: SlideContent,
  palette: ColorPalette,
  transition: SlideTransition = "fade",
  slideIndex: number = 0,
): string {
  const v = `slide${slideIndex}`;
  const safeQuote = JSON.stringify(
    content.quote || "Your inspiring quote goes here",
  );
  const safeAuthor = JSON.stringify(`— ${content.author || "Author Name"}`);

  return `
// Quote Slide
const ${v} = pptx.addSlide();
${v}.background = { color: '${palette.surface}' };
${transition !== "none" ? `${v}.transition = { type: '${transition}', speed: 'medium' };` : ""}

// Large quote mark
${v}.addText('"', {
  x: 0.5, y: 1, w: 2, h: 2,
  fontFace: '${FONTS.classic}',
  fontSize: 200,
  color: '${palette.primary}',
  valign: 'top'
});

// Quote text
${v}.addText(${safeQuote}, {
  x: 1.5, y: 2.5, w: 10.33, h: 2.5,
  fontFace: '${FONTS.classic}',
  fontSize: 32,
  italic: true,
  color: '${palette.text}',
  valign: 'middle'
});

// Author attribution
${v}.addText(${safeAuthor}, {
  x: 1.5, y: 5.5, w: 10.33, h: 0.6,
  fontFace: '${FONTS.body}',
  fontSize: 20,
  color: '${palette.textMuted}',
  valign: 'top'
});

${content.notes ? `${v}.addNotes(${JSON.stringify(content.notes)});` : ""}
`;
}

// Generate code for an image + text slide (FIXED - now uses real images!)
// Generate code for image + text split layout - MANUS/GAMMA QUALITY
export function generateImageTextSlideCode(
  content: SlideContent,
  palette: ColorPalette,
  side: "left" | "right" = "left",
  transition: SlideTransition = "fade",
  slideIndex: number = 0,
): string {
  const v = `slide${slideIndex}`;
  const isLeft = side === "left";
  // Full-bleed image on one side
  const imageX = isLeft ? 0 : 6.67;
  const imageW = 6.66;
  const textX = isLeft ? 7 : 0.5;
  const textW = 5.83;
  const safeTitle = JSON.stringify(content.title || "Title");
  const hasImage = !!content.imageUrl;

  // Create bullet items if content is array
  const contentArray = Array.isArray(content.content)
    ? content.content
    : [content.content || "Add your content here"];

  const bulletItems = contentArray
    .map(
      (item) => `
    { text: ${JSON.stringify(item)}, options: {
      bullet: { type: 'bullet', color: '${palette.primary}' },
      indentLevel: 0,
      paraSpaceAfter: 10
    } }`,
    )
    .join(",");

  return `
// ============================================================================
// IMAGE + TEXT SPLIT LAYOUT (${side} image) - Manus/Gamma Quality Design
// ============================================================================
const ${v} = pptx.addSlide();
${v}.background = { color: '${palette.background}' };
${transition !== "none" ? `${v}.transition = { type: '${transition}', speed: 'medium' };` : ""}

// ========== DECORATIVE ELEMENTS ==========

// ${isLeft ? "Right" : "Left"} side accent bar
${v}.addShape('rect', {
  x: ${isLeft ? 13.13 : 0}, y: 0, w: 0.2, h: 7.5,
  fill: { color: '${palette.primary}' }
});

// Bottom accent line
${v}.addShape('rect', {
  x: 0, y: 7.35, w: 13.33, h: 0.15,
  fill: { color: '${palette.primary}' }
});

// Decorative circle on text side
${v}.addShape('ellipse', {
  x: ${isLeft ? 10.5 : -1}, y: ${isLeft ? -1.5 : 5.5}, w: 3, h: 3,
  fill: { color: '${palette.primary}', transparency: 92 }
});

// ========== IMAGE AREA ==========

// Image container with shadow
${v}.addShape('rect', {
  x: ${imageX}, y: 0, w: ${imageW}, h: 7.5,
  fill: { color: '${palette.surface}' },
  shadow: { type: 'outer', blur: 15, offset: 5, angle: ${isLeft ? 0 : 180}, opacity: 0.2, color: '000000' }
});

${
  hasImage
    ? `
// Actual image (full bleed within container)
addImageToSlide(${v}, imageResults.image_slide${slideIndex}, {
  x: ${imageX}, y: 0, w: ${imageW}, h: 7.5,
  sizing: { type: 'cover', w: ${imageW}, h: 7.5 },
  placeholderColor: '${palette.surface}',
  placeholderText: 'Image'
});
`
    : `
// Placeholder design
${v}.addShape('ellipse', {
  x: ${imageX + imageW / 2 - 1}, y: 2.75, w: 2, h: 2,
  fill: { color: '${palette.primary}', transparency: 80 }
});
${v}.addText('📷', {
  x: ${imageX + imageW / 2 - 1}, y: 3, w: 2, h: 1.5,
  fontSize: 36,
  align: 'center',
  valign: 'middle'
});
${v}.addText('Add Image', {
  x: ${imageX}, y: 5, w: ${imageW}, h: 0.5,
  fontFace: '${FONTS.body}',
  fontSize: 16,
  color: '${palette.textMuted}',
  align: 'center'
});
`
}

// ========== TEXT CONTENT AREA ==========

// Content card background
${v}.addShape('roundRect', {
  x: ${textX}, y: 0.8, w: ${textW}, h: 5.9,
  fill: { color: '${palette.background}' },
  rectRadius: 0.1
});

// Title with accent bar
${v}.addShape('rect', {
  x: ${textX}, y: 0.8, w: 0.1, h: 1.2,
  fill: { color: '${palette.primary}' }
});

${v}.addText(${safeTitle}, {
  x: ${textX + 0.3}, y: 0.9, w: ${textW - 0.5}, h: 1.0,
  fontFace: '${FONTS.heading}',
  fontSize: 28,
  bold: true,
  color: '${palette.text}',
  valign: 'middle'
});

// Separator line
${v}.addShape('rect', {
  x: ${textX + 0.3}, y: 2.1, w: 2, h: 0.05,
  fill: { color: '${palette.accent}' }
});

// Content as bullet points for better readability
${v}.addText([${bulletItems}
], {
  x: ${textX + 0.3}, y: 2.4, w: ${textW - 0.6}, h: 4.0,
  fontFace: '${FONTS.body}',
  fontSize: 16,
  color: '${palette.text}',
  valign: 'top',
  lineSpacing: 26
});

${
  content.imageCaption
    ? `
// Image caption overlay
${v}.addShape('rect', {
  x: ${imageX}, y: 6.7, w: ${imageW}, h: 0.8,
  fill: { color: '000000', transparency: 40 }
});
${v}.addText(${JSON.stringify(content.imageCaption)}, {
  x: ${imageX + 0.2}, y: 6.8, w: ${imageW - 0.4}, h: 0.6,
  fontFace: '${FONTS.body}',
  fontSize: 12,
  color: 'FFFFFF',
  align: 'center',
  valign: 'middle'
});
`
    : ""
}

${content.notes ? `${v}.addNotes(${JSON.stringify(content.notes)});` : ""}
`;
}

// Generate code for a full image slide
export function generateImageFullSlideCode(
  content: SlideContent,
  palette: ColorPalette,
  transition: SlideTransition = "fade",
  slideIndex: number = 0,
): string {
  const v = `slide${slideIndex}`;
  const safeTitle = content.title ? JSON.stringify(content.title) : null;
  const safeCaption = content.imageCaption
    ? JSON.stringify(content.imageCaption)
    : null;
  const hasImage = !!content.imageUrl;

  return `
// Full Image Slide
const ${v} = pptx.addSlide();
${v}.background = { color: '${palette.background}' };
${transition !== "none" ? `${v}.transition = { type: '${transition}', speed: 'medium' };` : ""}

// Full slide image
${
  hasImage
    ? `
addImageToSlide(${v}, imageResults.image_slide${slideIndex}, {
  x: 0, y: 0, w: 13.33, h: 7.5,
  sizing: { type: 'cover', w: 13.33, h: 7.5 },
  placeholderColor: '${palette.surface}'
});
`
    : `
${v}.addShape('rect', {
  x: 0, y: 0, w: 13.33, h: 7.5,
  fill: { color: '${palette.surface}' }
});

${v}.addText('Full Image', {
  x: 0, y: 3.5, w: 13.33, h: 1,
  fontFace: '${FONTS.body}',
  fontSize: 32,
  color: '${palette.textMuted}',
  align: 'center',
  valign: 'middle'
});
`
}

${
  safeTitle
    ? `
// Title overlay
${v}.addShape('rect', {
  x: 0, y: 0, w: 13.33, h: 1.5,
  fill: { color: '000000', transparency: 50 }
});

${v}.addText(${safeTitle}, {
  x: 0.5, y: 0.4, w: 12.33, h: 0.8,
  fontFace: '${FONTS.heading}',
  fontSize: 36,
  bold: true,
  color: 'FFFFFF'
});
`
    : ""
}

${
  safeCaption
    ? `
// Caption overlay
${v}.addShape('rect', {
  x: 0, y: 6.5, w: 13.33, h: 1,
  fill: { color: '000000', transparency: 50 }
});

${v}.addText(${safeCaption}, {
  x: 0.5, y: 6.7, w: 12.33, h: 0.5,
  fontFace: '${FONTS.body}',
  fontSize: 16,
  color: 'FFFFFF',
  align: 'center'
});
`
    : ""
}

${content.notes ? `${v}.addNotes(${JSON.stringify(content.notes)});` : ""}
`;
}

// Generate code for a timeline slide
export function generateTimelineSlideCode(
  content: SlideContent,
  palette: ColorPalette,
  transition: SlideTransition = "fade",
  slideIndex: number = 0,
): string {
  const v = `slide${slideIndex}`;
  const safeTitle = JSON.stringify(content.title || "Timeline");
  const timelineItems = content.timelineItems || [
    { date: "2024", title: "Milestone 1", description: "Description" },
    { date: "2025", title: "Milestone 2", description: "Description" },
    { date: "2026", title: "Milestone 3", description: "Description" },
  ];

  let timelineCode = `
// Timeline line
${v}.addShape('rect', {
  x: 0.5, y: 3.5, w: 12.33, h: 0.05,
  fill: { color: '${palette.primary}' }
});
`;

  const numItems = Math.min(timelineItems.length, 5);
  const itemWidth = 12.33 / numItems;

  timelineItems.slice(0, 5).forEach((item, idx) => {
    const xPos = 0.5 + idx * itemWidth + itemWidth / 2;
    timelineCode += `
// Timeline item ${idx + 1}
${v}.addShape('ellipse', {
  x: ${xPos - 0.15}, y: 3.35, w: 0.3, h: 0.3,
  fill: { color: '${palette.primary}' }
});

${v}.addText(${JSON.stringify(item.date)}, {
  x: ${xPos - itemWidth / 2}, y: 2.5, w: ${itemWidth}, h: 0.6,
  fontFace: '${FONTS.heading}',
  fontSize: 14,
  bold: true,
  color: '${palette.primary}',
  align: 'center'
});

${v}.addText(${JSON.stringify(item.title)}, {
  x: ${xPos - itemWidth / 2}, y: 3.9, w: ${itemWidth}, h: 0.6,
  fontFace: '${FONTS.heading}',
  fontSize: 16,
  bold: true,
  color: '${palette.text}',
  align: 'center'
});

${
  item.description
    ? `
${v}.addText(${JSON.stringify(item.description)}, {
  x: ${xPos - itemWidth / 2}, y: 4.5, w: ${itemWidth}, h: 1.5,
  fontFace: '${FONTS.body}',
  fontSize: 12,
  color: '${palette.textMuted}',
  align: 'center',
  valign: 'top'
});
`
    : ""
}
`;
  });

  return `
// Timeline Slide
const ${v} = pptx.addSlide();
${v}.background = { color: '${palette.background}' };
${transition !== "none" ? `${v}.transition = { type: '${transition}', speed: 'medium' };` : ""}

// Slide title
${v}.addText(${safeTitle}, {
  x: 0.5, y: 0.4, w: 12.33, h: 0.8,
  fontFace: '${FONTS.heading}',
  fontSize: 36,
  bold: true,
  color: '${palette.text}'
});

// Title underline
${v}.addShape('rect', {
  x: 0.5, y: 1.15, w: 2, h: 0.05,
  fill: { color: '${palette.primary}' }
});

${timelineCode}

${content.notes ? `${v}.addNotes(${JSON.stringify(content.notes)});` : ""}
`;
}

// Generate code for a process/steps slide
export function generateProcessSlideCode(
  content: SlideContent,
  palette: ColorPalette,
  transition: SlideTransition = "fade",
  slideIndex: number = 0,
): string {
  const v = `slide${slideIndex}`;
  const safeTitle = JSON.stringify(content.title || "Process");
  const steps = content.processSteps ||
    content.items || [
      { step: 1, title: "Step 1", description: "Description" },
      { step: 2, title: "Step 2", description: "Description" },
      { step: 3, title: "Step 3", description: "Description" },
    ];

  let processCode = "";
  const numSteps = Math.min(steps.length, 4);
  const stepWidth = 12.33 / numSteps;

  steps.slice(0, 4).forEach((item: any, idx: number) => {
    const xPos = 0.5 + idx * stepWidth;
    const stepNum = item.step || idx + 1;

    // Arrow between steps
    if (idx > 0) {
      processCode += `
${v}.addText('→', {
  x: ${xPos - 0.3}, y: 2.8, w: 0.4, h: 0.6,
  fontFace: '${FONTS.heading}',
  fontSize: 32,
  color: '${palette.primary}',
  align: 'center',
  valign: 'middle'
});
`;
    }

    processCode += `
// Step ${stepNum}
${v}.addShape('ellipse', {
  x: ${xPos + stepWidth / 2 - 0.5}, y: 2, w: 1, h: 1,
  fill: { color: '${palette.primary}' },
  shadow: { type: 'outer', blur: 6, offset: 2, angle: 45, opacity: 0.2 }
});

${v}.addText('${stepNum}', {
  x: ${xPos + stepWidth / 2 - 0.5}, y: 2.15, w: 1, h: 0.7,
  fontFace: '${FONTS.heading}',
  fontSize: 28,
  bold: true,
  color: '${palette.textInverse}',
  align: 'center',
  valign: 'middle'
});

${v}.addText(${JSON.stringify(item.title || `Step ${stepNum}`)}, {
  x: ${xPos}, y: 3.3, w: ${stepWidth - 0.2}, h: 0.6,
  fontFace: '${FONTS.heading}',
  fontSize: 18,
  bold: true,
  color: '${palette.text}',
  align: 'center'
});

${
  item.description
    ? `
${v}.addText(${JSON.stringify(item.description)}, {
  x: ${xPos}, y: 4, w: ${stepWidth - 0.2}, h: 2.5,
  fontFace: '${FONTS.body}',
  fontSize: 14,
  color: '${palette.textMuted}',
  align: 'center',
  valign: 'top'
});
`
    : ""
}
`;
  });

  return `
// Process/Steps Slide
const ${v} = pptx.addSlide();
${v}.background = { color: '${palette.background}' };
${transition !== "none" ? `${v}.transition = { type: '${transition}', speed: 'medium' };` : ""}

// Slide title
${v}.addText(${safeTitle}, {
  x: 0.5, y: 0.4, w: 12.33, h: 0.8,
  fontFace: '${FONTS.heading}',
  fontSize: 36,
  bold: true,
  color: '${palette.text}'
});

// Title underline
${v}.addShape('rect', {
  x: 0.5, y: 1.15, w: 2, h: 0.05,
  fill: { color: '${palette.primary}' }
});

${processCode}

${content.notes ? `${v}.addNotes(${JSON.stringify(content.notes)});` : ""}
`;
}

// Generate code for a chart slide
export function generateChartSlideCode(
  content: SlideContent,
  palette: ColorPalette,
  transition: SlideTransition = "fade",
  slideIndex: number = 0,
): string {
  const v = `slide${slideIndex}`;
  const safeTitle = JSON.stringify(content.title || "Chart");
  const chartData = content.chartData || {
    type: "bar",
    labels: ["Q1", "Q2", "Q3", "Q4"],
    data: [100, 150, 120, 180],
    title: "Sample Chart",
  };

  const chartColors = palette.chart?.colors || [
    palette.primary,
    palette.accent,
    palette.primaryDark,
  ];

  return `
// Chart Slide
const ${v} = pptx.addSlide();
${v}.background = { color: '${palette.background}' };
${transition !== "none" ? `${v}.transition = { type: '${transition}', speed: 'medium' };` : ""}

// Slide title
${v}.addText(${safeTitle}, {
  x: 0.5, y: 0.4, w: 12.33, h: 0.8,
  fontFace: '${FONTS.heading}',
  fontSize: 36,
  bold: true,
  color: '${palette.text}'
});

// Title underline
${v}.addShape('rect', {
  x: 0.5, y: 1.15, w: 2, h: 0.05,
  fill: { color: '${palette.primary}' }
});

// Chart
${(() => {
  let chartType = "bar";
  if (chartData.type === "line") chartType = "line";
  else if (chartData.type === "pie") chartType = "pie";
  else if (chartData.type === "doughnut") chartType = "doughnut";
  else if (chartData.type === "area") chartType = "area";
  return `${v}.addChart(pptx.ChartType.${chartType}, [`;
})()}
  {
    name: ${JSON.stringify(chartData.title || "Series 1")},
    labels: ${JSON.stringify(chartData.labels)},
    values: ${JSON.stringify(chartData.data)}
  }
], {
  x: 1, y: 1.5, w: 11.33, h: 5.5,
  chartColors: [${chartColors.map((c: string) => `'${c}'`).join(", ")}],
  showTitle: ${chartData.title ? "true" : "false"},
  title: ${JSON.stringify(chartData.title || "")},
  titleFontFace: '${FONTS.heading}',
  titleFontSize: 14,
  titleColor: '${palette.text}',
  showLegend: ${chartData.showLegend !== false},
  legendPos: 'r',
  legendFontSize: 10,
  legendColor: '${palette.textMuted}',
  showValue: ${chartData.showValues || false},
  dataLabelColor: '${palette.text}',
  dataLabelFontSize: 10,
  catAxisLabelColor: '${palette.text}',
  catAxisLabelFontSize: 10,
  valAxisLabelColor: '${palette.textMuted}',
  valAxisLabelFontSize: 10,
  catGridLine: { style: 'none' },
  valGridLine: { color: '${palette.surface}', style: 'dash' }
});

${content.notes ? `${v}.addNotes(${JSON.stringify(content.notes)});` : ""}
`;
}

// Generate code for a table slide
export function generateTableSlideCode(
  content: SlideContent,
  palette: ColorPalette,
  transition: SlideTransition = "fade",
  slideIndex: number = 0,
): string {
  const v = `slide${slideIndex}`;
  const safeTitle = JSON.stringify(content.title || "Table");
  const tableData = content.tableData || {
    headers: ["Column 1", "Column 2", "Column 3"],
    rows: [
      ["Row 1 Data", "Data", "Data"],
      ["Row 2 Data", "Data", "Data"],
    ],
  };

  const tableRows = [tableData.headers, ...tableData.rows];

  return `
// Table Slide
const ${v} = pptx.addSlide();
${v}.background = { color: '${palette.background}' };
${transition !== "none" ? `${v}.transition = { type: '${transition}', speed: 'medium' };` : ""}

// Slide title
${v}.addText(${safeTitle}, {
  x: 0.5, y: 0.4, w: 12.33, h: 0.8,
  fontFace: '${FONTS.heading}',
  fontSize: 36,
  bold: true,
  color: '${palette.text}'
});

// Title underline
${v}.addShape('rect', {
  x: 0.5, y: 1.15, w: 2, h: 0.05,
  fill: { color: '${palette.primary}' }
});

// Table
const tableRows = ${JSON.stringify(tableRows)}.map((row, rowIdx) =>
  row.map((cell, colIdx) => ({
    text: cell,
    options: {
      fontFace: rowIdx === 0 ? '${FONTS.heading}' : '${FONTS.body}',
      fontSize: rowIdx === 0 ? 14 : 12,
      bold: rowIdx === 0,
      color: rowIdx === 0 ? '${palette.textInverse}' : '${palette.text}',
      fill: { color: rowIdx === 0 ? '${palette.primary}' : rowIdx % 2 === 1 ? '${palette.surface}' : '${palette.background}' },
      align: 'center',
      valign: 'middle'
    }
  }))
);

${v}.addTable(tableRows, {
  x: 0.5, y: 1.5, w: 12.33,
  rowH: 0.5,
  border: { pt: 1, color: '${palette.surface}' },
  autoPage: false
});

${content.notes ? `${v}.addNotes(${JSON.stringify(content.notes)});` : ""}
`;
}

// Generate code for an agenda slide
export function generateAgendaSlideCode(
  content: SlideContent,
  palette: ColorPalette,
  transition: SlideTransition = "fade",
  slideIndex: number = 0,
): string {
  const v = `slide${slideIndex}`;
  const safeTitle = JSON.stringify(content.title || "Agenda");
  const items: (string | { title?: string })[] = Array.isArray(content.content)
    ? content.content
    : content.items
        ?.map((i) => i.title || i.description || "Item")
        .filter(Boolean) || ["Item 1", "Item 2", "Item 3"];

  let agendaCode = "";
  items.forEach((item, idx) => {
    const itemText = typeof item === "string" ? item : item.title || "Item";
    const yPos = 1.5 + idx * 0.9;
    agendaCode += `
// Agenda item ${idx + 1}
${v}.addShape('rect', {
  x: 0.5, y: ${yPos}, w: 0.6, h: 0.6,
  fill: { color: '${palette.primary}' }
});

${v}.addText('${idx + 1}', {
  x: 0.5, y: ${yPos}, w: 0.6, h: 0.6,
  fontFace: '${FONTS.heading}',
  fontSize: 18,
  bold: true,
  color: '${palette.textInverse}',
  align: 'center',
  valign: 'middle'
});

${v}.addText(${JSON.stringify(itemText)}, {
  x: 1.3, y: ${yPos}, w: 11.53, h: 0.6,
  fontFace: '${FONTS.body}',
  fontSize: 20,
  color: '${palette.text}',
  valign: 'middle'
});

${v}.addShape('rect', {
  x: 1.3, y: ${yPos + 0.7}, w: 11.53, h: 0.02,
  fill: { color: '${palette.surface}' }
});
`;
  });

  return `
// Agenda Slide
const ${v} = pptx.addSlide();
${v}.background = { color: '${palette.background}' };
${transition !== "none" ? `${v}.transition = { type: '${transition}', speed: 'medium' };` : ""}

// Slide title
${v}.addText(${safeTitle}, {
  x: 0.5, y: 0.4, w: 12.33, h: 0.8,
  fontFace: '${FONTS.heading}',
  fontSize: 36,
  bold: true,
  color: '${palette.text}'
});

${agendaCode}

${content.notes ? `${v}.addNotes(${JSON.stringify(content.notes)});` : ""}
`;
}

// Generate code for a thank you slide
export function generateThankYouSlideCode(
  content: SlideContent,
  palette: ColorPalette,
  transition: SlideTransition = "fade",
  slideIndex: number = 0,
): string {
  const v = `slide${slideIndex}`;
  const safeTitle = JSON.stringify(content.title || "Thank You!");
  const safeSubtitle = content.subtitle
    ? JSON.stringify(content.subtitle)
    : null;

  return `
// Thank You Slide
const ${v} = pptx.addSlide();
${v}.background = { color: '${palette.primary}' };
${transition !== "none" ? `${v}.transition = { type: '${transition}', speed: 'medium' };` : ""}

// Decorative shapes
${v}.addShape('ellipse', {
  x: -2, y: -2, w: 6, h: 6,
  fill: { color: '${palette.primaryDark}', transparency: 50 }
});

${v}.addShape('ellipse', {
  x: 10, y: 4, w: 5, h: 5,
  fill: { color: '${palette.primaryDark}', transparency: 50 }
});

// Main text
${v}.addText(${safeTitle}, {
  x: 0.5, y: 2.5, w: 12.33, h: 1.5,
  fontFace: '${FONTS.heading}',
  fontSize: 72,
  bold: true,
  color: '${palette.textInverse}',
  align: 'center',
  valign: 'middle'
});

${
  safeSubtitle
    ? `
${v}.addText(${safeSubtitle}, {
  x: 0.5, y: 4.5, w: 12.33, h: 0.8,
  fontFace: '${FONTS.body}',
  fontSize: 24,
  color: '${palette.textInverse}',
  align: 'center'
});
`
    : ""
}

${content.notes ? `${v}.addNotes(${JSON.stringify(content.notes)});` : ""}
`;
}

// Generate code for a contact slide
export function generateContactSlideCode(
  content: SlideContent,
  palette: ColorPalette,
  transition: SlideTransition = "fade",
  slideIndex: number = 0,
): string {
  const v = `slide${slideIndex}`;
  const safeTitle = JSON.stringify(content.title || "Get In Touch");
  const contactInfo = content.contactInfo || {};

  let contactCode = "";
  let yPos = 2.5;

  if (contactInfo.email) {
    contactCode += `
${v}.addText('✉', { x: 4, y: ${yPos}, w: 0.6, h: 0.6, fontSize: 24, color: '${palette.primary}', align: 'center' });
${v}.addText(${JSON.stringify(contactInfo.email)}, {
  x: 4.7, y: ${yPos}, w: 5, h: 0.6,
  fontFace: '${FONTS.body}',
  fontSize: 18,
  color: '${palette.text}',
  valign: 'middle'
});
`;
    yPos += 0.8;
  }

  if (contactInfo.phone) {
    contactCode += `
${v}.addText('☎', { x: 4, y: ${yPos}, w: 0.6, h: 0.6, fontSize: 24, color: '${palette.primary}', align: 'center' });
${v}.addText(${JSON.stringify(contactInfo.phone)}, {
  x: 4.7, y: ${yPos}, w: 5, h: 0.6,
  fontFace: '${FONTS.body}',
  fontSize: 18,
  color: '${palette.text}',
  valign: 'middle'
});
`;
    yPos += 0.8;
  }

  if (contactInfo.website) {
    contactCode += `
${v}.addText('🌐', { x: 4, y: ${yPos}, w: 0.6, h: 0.6, fontSize: 24, color: '${palette.primary}', align: 'center' });
${v}.addText(${JSON.stringify(contactInfo.website)}, {
  x: 4.7, y: ${yPos}, w: 5, h: 0.6,
  fontFace: '${FONTS.body}',
  fontSize: 18,
  color: '${palette.text}',
  valign: 'middle',
  hyperlink: { url: ${JSON.stringify(contactInfo.website.startsWith("http") ? contactInfo.website : "https://" + contactInfo.website)} }
});
`;
    yPos += 0.8;
  }

  if (contactInfo.address) {
    contactCode += `
${v}.addText('📍', { x: 4, y: ${yPos}, w: 0.6, h: 0.6, fontSize: 24, color: '${palette.primary}', align: 'center' });
${v}.addText(${JSON.stringify(contactInfo.address)}, {
  x: 4.7, y: ${yPos}, w: 5, h: 0.8,
  fontFace: '${FONTS.body}',
  fontSize: 16,
  color: '${palette.text}',
  valign: 'top'
});
`;
  }

  return `
// Contact Slide
const ${v} = pptx.addSlide();
${v}.background = { color: '${palette.background}' };
${transition !== "none" ? `${v}.transition = { type: '${transition}', speed: 'medium' };` : ""}

// Slide title
${v}.addText(${safeTitle}, {
  x: 0.5, y: 0.8, w: 12.33, h: 1,
  fontFace: '${FONTS.heading}',
  fontSize: 44,
  bold: true,
  color: '${palette.text}',
  align: 'center'
});

// Title underline
${v}.addShape('rect', {
  x: 5.67, y: 1.8, w: 2, h: 0.05,
  fill: { color: '${palette.primary}' }
});

${contactCode}

${content.notes ? `${v}.addNotes(${JSON.stringify(content.notes)});` : ""}
`;
}

/**
 * Generate Team/People Slide with member cards
 */
export function generateTeamSlideCode(
  content: SlideContent,
  palette: ColorPalette,
  transition: SlideTransition = "fade",
  slideIndex: number = 0,
): string {
  const v = `slide${slideIndex}`;
  const safeTitle = JSON.stringify(content.title || "Our Team");
  const members = content.teamMembers || [];

  // Calculate grid layout based on number of members
  const cols =
    members.length <= 3 ? members.length : members.length <= 6 ? 3 : 4;
  const cardWidth = (12.33 - (cols - 1) * 0.3) / cols;
  const cardHeight = 4.5;

  let memberCode = "";
  members.forEach((member, idx) => {
    const col = idx % cols;
    const row = Math.floor(idx / cols);
    const x = 0.5 + col * (cardWidth + 0.3);
    const y = 1.8 + row * (cardHeight + 0.3);

    // Member card background
    memberCode += `
${v}.addShape('roundRect', {
  x: ${x}, y: ${y}, w: ${cardWidth}, h: ${cardHeight},
  fill: { color: '${palette.surface}' },
  shadow: { type: 'outer', blur: 6, offset: 3, angle: 45, opacity: 0.15 },
  rectRadius: 0.15
});
`;

    // Member photo placeholder or actual image (if using image fetching)
    memberCode += `
${v}.addShape('ellipse', {
  x: ${x + cardWidth / 2 - 0.6}, y: ${y + 0.3}, w: 1.2, h: 1.2,
  fill: { color: '${palette.primary}' }
});
${v}.addText('👤', {
  x: ${x + cardWidth / 2 - 0.6}, y: ${y + 0.4}, w: 1.2, h: 1,
  fontSize: 36,
  align: 'center',
  color: '${palette.textInverse}'
});
`;

    // Member name
    memberCode += `
${v}.addText(${JSON.stringify(member.name)}, {
  x: ${x + 0.1}, y: ${y + 1.7}, w: ${cardWidth - 0.2}, h: 0.5,
  fontFace: '${FONTS.heading}',
  fontSize: 16,
  bold: true,
  color: '${palette.text}',
  align: 'center'
});
`;

    // Member role
    memberCode += `
${v}.addText(${JSON.stringify(member.role)}, {
  x: ${x + 0.1}, y: ${y + 2.2}, w: ${cardWidth - 0.2}, h: 0.4,
  fontFace: '${FONTS.body}',
  fontSize: 12,
  color: '${palette.primary}',
  align: 'center'
});
`;

    // Email if available
    if (member.email) {
      memberCode += `
${v}.addText(${JSON.stringify(member.email)}, {
  x: ${x + 0.1}, y: ${y + 2.7}, w: ${cardWidth - 0.2}, h: 0.3,
  fontFace: '${FONTS.body}',
  fontSize: 10,
  color: '${palette.textMuted}',
  align: 'center'
});
`;
    }
  });

  return `
// Team Slide
const ${v} = pptx.addSlide();
${v}.background = { color: '${palette.background}' };
${transition !== "none" ? `${v}.transition = { type: '${transition}', speed: 'medium' };` : ""}

// Slide title
${v}.addText(${safeTitle}, {
  x: 0.5, y: 0.5, w: 12.33, h: 0.8,
  fontFace: '${FONTS.heading}',
  fontSize: 36,
  bold: true,
  color: '${palette.text}',
  align: 'center'
});

// Decorative underline
${v}.addShape('rect', {
  x: 5.67, y: 1.3, w: 2, h: 0.05,
  fill: { color: '${palette.primary}' }
});

${memberCode}

${content.notes ? `${v}.addNotes(${JSON.stringify(content.notes)});` : ""}
`;
}

/**
 * Generate Image Grid Slide with multiple images
 */
export function generateImageGridSlideCode(
  content: SlideContent,
  palette: ColorPalette,
  transition: SlideTransition = "fade",
  slideIndex: number = 0,
): string {
  const v = `slide${slideIndex}`;
  const safeTitle = content.title ? JSON.stringify(content.title) : null;
  const images = content.images || [];

  // Calculate grid layout
  const count = images.length;
  let cols: number, rows: number;
  if (count <= 2) {
    cols = count;
    rows = 1;
  } else if (count <= 4) {
    cols = 2;
    rows = 2;
  } else if (count <= 6) {
    cols = 3;
    rows = 2;
  } else {
    cols = 4;
    rows = Math.ceil(count / 4);
  }

  const startY = safeTitle ? 1.5 : 0.5;
  const availHeight = safeTitle ? 5.5 : 6.5;
  const availWidth = 12.33;
  const gap = 0.2;

  const imgWidth = (availWidth - (cols - 1) * gap) / cols;
  const imgHeight = (availHeight - (rows - 1) * gap) / rows;

  let imageCode = "";
  images.forEach((_imageUrl, idx) => {
    const col = idx % cols;
    const row = Math.floor(idx / cols);
    const x = 0.5 + col * (imgWidth + gap);
    const y = startY + row * (imgHeight + gap);

    // Placeholder for each image
    imageCode += `
${v}.addShape('rect', {
  x: ${x}, y: ${y}, w: ${imgWidth}, h: ${imgHeight},
  fill: { color: '${palette.surface}' },
  shadow: { type: 'outer', blur: 4, offset: 2, angle: 45, opacity: 0.1 }
});
${v}.addText('🖼', {
  x: ${x}, y: ${y + imgHeight / 2 - 0.3}, w: ${imgWidth}, h: 0.6,
  fontSize: 28,
  align: 'center',
  color: '${palette.textMuted}'
});
`;
  });

  return `
// Image Grid Slide
const ${v} = pptx.addSlide();
${v}.background = { color: '${palette.background}' };
${transition !== "none" ? `${v}.transition = { type: '${transition}', speed: 'medium' };` : ""}

${
  safeTitle
    ? `
// Slide title
${v}.addText(${safeTitle}, {
  x: 0.5, y: 0.4, w: 12.33, h: 0.8,
  fontFace: '${FONTS.heading}',
  fontSize: 32,
  bold: true,
  color: '${palette.text}',
  align: 'center'
});
`
    : ""
}

${imageCode}

${content.notes ? `${v}.addNotes(${JSON.stringify(content.notes)});` : ""}
`;
}

/**
 * Generate Dashboard Slide with KPIs and mini-charts
 */
export function generateDashboardSlideCode(
  content: SlideContent,
  palette: ColorPalette,
  transition: SlideTransition = "fade",
  slideIndex: number = 0,
): string {
  const v = `slide${slideIndex}`;
  const safeTitle = JSON.stringify(content.title || "Dashboard");
  const dashboardData = content.dashboardData || {};
  const kpis = dashboardData.kpis || [];
  const miniCharts = dashboardData.miniCharts || [];

  // Generate KPI cards
  let kpiCode = "";
  const kpiCount = kpis.length;
  const kpiWidth = kpiCount > 0 ? (12.33 - (kpiCount - 1) * 0.3) / kpiCount : 3;

  kpis.forEach((kpi, idx) => {
    const x = 0.5 + idx * (kpiWidth + 0.3);
    const y = 1.5;

    // KPI card background
    kpiCode += `
${v}.addShape('roundRect', {
  x: ${x}, y: ${y}, w: ${kpiWidth}, h: 1.8,
  fill: { color: '${palette.surface}' },
  shadow: { type: 'outer', blur: 6, offset: 3, angle: 45, opacity: 0.15 },
  rectRadius: 0.1
});
`;

    // KPI Icon
    if (kpi.icon) {
      kpiCode += `
${v}.addText(${JSON.stringify(kpi.icon)}, {
  x: ${x + 0.2}, y: ${y + 0.2}, w: 0.6, h: 0.6,
  fontSize: 24,
  align: 'center'
});
`;
    }

    // KPI Value
    kpiCode += `
${v}.addText(${JSON.stringify(String(kpi.value))}, {
  x: ${x + 0.2}, y: ${y + (kpi.icon ? 0.6 : 0.2)}, w: ${kpiWidth - 0.4}, h: 0.7,
  fontFace: '${FONTS.heading}',
  fontSize: 28,
  bold: true,
  color: '${palette.primary}',
  align: 'center'
});
`;

    // KPI Label
    kpiCode += `
${v}.addText(${JSON.stringify(kpi.label)}, {
  x: ${x + 0.2}, y: ${y + 1.1}, w: ${kpiWidth - 0.4}, h: 0.4,
  fontFace: '${FONTS.body}',
  fontSize: 12,
  color: '${palette.textMuted}',
  align: 'center'
});
`;

    // Trend indicator
    if (kpi.change) {
      let trendColor: string;
      if (kpi.trend === "up") {
        trendColor = "4CAF50";
      } else if (kpi.trend === "down") {
        trendColor = "F44336";
      } else {
        trendColor = palette.textMuted;
      }
      const trendArrow =
        kpi.trend === "up" ? "↑" : kpi.trend === "down" ? "↓" : "";
      kpiCode += `
${v}.addText(${JSON.stringify(trendArrow + " " + kpi.change)}, {
  x: ${x + 0.2}, y: ${y + 1.4}, w: ${kpiWidth - 0.4}, h: 0.3,
  fontFace: '${FONTS.body}',
  fontSize: 10,
  bold: true,
  color: '${trendColor}',
  align: 'center'
});
`;
    }
  });

  // Generate mini-charts section
  let chartCode = "";
  const chartCount = miniCharts.length;
  if (chartCount > 0) {
    const chartWidth =
      chartCount > 0 ? (12.33 - (chartCount - 1) * 0.3) / chartCount : 4;
    const chartHeight = 3.5;
    const chartY = 3.8;

    miniCharts.forEach((chart, idx) => {
      const x = 0.5 + idx * (chartWidth + 0.3);

      // Chart container
      chartCode += `
${v}.addShape('roundRect', {
  x: ${x}, y: ${chartY}, w: ${chartWidth}, h: ${chartHeight},
  fill: { color: '${palette.surface}' },
  shadow: { type: 'outer', blur: 4, offset: 2, angle: 45, opacity: 0.1 },
  rectRadius: 0.1
});
`;

      // Chart title
      chartCode += `
${v}.addText(${JSON.stringify(chart.title)}, {
  x: ${x + 0.2}, y: ${chartY + 0.1}, w: ${chartWidth - 0.4}, h: 0.4,
  fontFace: '${FONTS.heading}',
  fontSize: 12,
  bold: true,
  color: '${palette.text}',
  align: 'center'
});
`;

      // Add actual chart using PptxGenJS
      const chartType =
        chart.type === "pie" ? "pie" : chart.type === "line" ? "line" : "bar";
      const chartData = chart.data.map((val, i) => ({
        name: chart.labels?.[i] || `Item ${i + 1}`,
        labels: [chart.labels?.[i] || `${i + 1}`],
        values: [val],
      }));

      chartCode += `
${v}.addChart(pptx.ChartType.${chartType}, ${JSON.stringify(chartData)}, {
  x: ${x + 0.2}, y: ${chartY + 0.6}, w: ${chartWidth - 0.4}, h: ${chartHeight - 0.8},
  showLegend: false,
  showTitle: false,
  chartColors: ['${palette.primary}', '${palette.accent}', '${palette.textMuted}', '2196F3', 'FF9800', '4CAF50'],
  barDir: 'bar',
  barGrouping: 'clustered'
});
`;
    });
  }

  return `
// Dashboard Slide
const ${v} = pptx.addSlide();
${v}.background = { color: '${palette.background}' };
${transition !== "none" ? `${v}.transition = { type: '${transition}', speed: 'medium' };` : ""}

// Slide title
${v}.addText(${safeTitle}, {
  x: 0.5, y: 0.4, w: 12.33, h: 0.8,
  fontFace: '${FONTS.heading}',
  fontSize: 32,
  bold: true,
  color: '${palette.text}'
});

// Decorative accent line
${v}.addShape('rect', {
  x: 0.5, y: 1.15, w: 1.5, h: 0.05,
  fill: { color: '${palette.primary}' }
});

${kpiCode}

${chartCode}

${content.notes ? `${v}.addNotes(${JSON.stringify(content.notes)});` : ""}
`;
}

// Main template generator that creates full PptxGenJS code
export function generatePresentationTemplate(
  slides: SlideContent[],
  options: {
    paletteName?: string;
    transition?: SlideTransition;
    title?: string;
    author?: string;
    branding?: BrandingConfig;
    useMasterSlides?: boolean;
  } = {},
): string {
  const palette = getPalette(options.paletteName || "gamma-dark");
  const transition = options.transition || "fade";
  const safeAuthor = JSON.stringify(options.author || "Shadower AI");
  const safeTitle = JSON.stringify(options.title || "Presentation");
  const safeFileName =
    (options.title?.replace(/[^a-zA-Z0-9]/g, "_") || "presentation") + ".pptx";
  const useMasterSlides = options.useMasterSlides !== false; // Default to true

  // Generate image fetching code
  const { code: imageFetchCode } = generateImageFetchingCode(slides);
  const hasImages = imageFetchCode.length > 0;
  const hasBrandingLogo = !!options.branding?.logoUrl;

  let code = `
// ============================================================================
// PPTX GENERATION - Enhanced with image support, charts, and advanced layouts
// ============================================================================

// Install dependencies
const { execSync } = require('child_process');
try {
  require.resolve('pptxgenjs');
} catch (e) {
  console.log('Installing pptxgenjs...');
  execSync('npm install pptxgenjs --no-save --silent 2>/dev/null || npm install pptxgenjs --no-save', {
    stdio: 'pipe',
    cwd: '/home/user'
  });
  console.log('pptxgenjs installed successfully');
}

const PptxGenJS = require('pptxgenjs');

${
  hasImages || hasBrandingLogo
    ? `
// Wrap in async function for image fetching
(async () => {
${imageFetchCode}
`
    : ""
}

const pptx = new PptxGenJS();

// Presentation metadata
pptx.author = ${safeAuthor};
pptx.title = ${safeTitle};
pptx.subject = 'Generated by Shadower AI';
pptx.company = ${options.branding?.companyName ? JSON.stringify(options.branding.companyName) : "'Shadower'"};

// Layout settings
pptx.layout = 'LAYOUT_16x9';

// Define theme colors
const theme = {
  background: '${palette.background}',
  surface: '${palette.surface}',
  primary: '${palette.primary}',
  accent: '${palette.accent}',
  text: '${palette.text}',
  textMuted: '${palette.textMuted}'
};

${useMasterSlides ? generateMasterSlidesCode(options.paletteName || "gamma-dark", options.branding) : ""}
`;

  // Generate code for each slide with unique index
  slides.forEach((slide, index) => {
    code += `\n// ============ Slide ${index + 1}: ${slide.type} ============\n`;

    const hasImage = !!slide.imageUrl;

    switch (slide.type) {
      case "title":
        code += generateTitleSlideCode(
          slide,
          palette,
          transition,
          index,
          hasImage,
        );
        break;
      case "section":
        code += generateSectionSlideCode(slide, palette, transition, index);
        break;
      case "content":
      case "bullets":
        code += generateContentSlideCode(slide, palette, transition, index);
        break;
      case "two-column":
      case "comparison":
        code += generateTwoColumnSlideCode(slide, palette, transition, index);
        break;
      case "three-column":
        code += generateThreeColumnSlideCode(slide, palette, transition, index);
        break;
      case "stats":
      case "big-number":
        if (slide.items && slide.items.length > 1) {
          code += generateMultiStatsSlideCode(
            slide,
            palette,
            transition,
            index,
          );
        } else {
          code += generateStatsSlideCode(slide, palette, transition, index);
        }
        break;
      case "quote":
        code += generateQuoteSlideCode(slide, palette, transition, index);
        break;
      case "image-left":
        code += generateImageTextSlideCode(
          slide,
          palette,
          "left",
          transition,
          index,
        );
        break;
      case "image-right":
        code += generateImageTextSlideCode(
          slide,
          palette,
          "right",
          transition,
          index,
        );
        break;
      case "image-full":
        code += generateImageFullSlideCode(slide, palette, transition, index);
        break;
      case "timeline":
        code += generateTimelineSlideCode(slide, palette, transition, index);
        break;
      case "process":
        code += generateProcessSlideCode(slide, palette, transition, index);
        break;
      case "chart":
        code += generateChartSlideCode(slide, palette, transition, index);
        break;
      case "table":
        code += generateTableSlideCode(slide, palette, transition, index);
        break;
      case "agenda":
        code += generateAgendaSlideCode(slide, palette, transition, index);
        break;
      case "thank-you":
        code += generateThankYouSlideCode(slide, palette, transition, index);
        break;
      case "contact":
        code += generateContactSlideCode(slide, palette, transition, index);
        break;
      case "team":
        code += generateTeamSlideCode(slide, palette, transition, index);
        break;
      case "image-grid":
        code += generateImageGridSlideCode(slide, palette, transition, index);
        break;
      case "dashboard":
        code += generateDashboardSlideCode(slide, palette, transition, index);
        break;
      default:
        code += generateContentSlideCode(slide, palette, transition, index);
    }
  });

  // Add save code
  code += `
// ============ Save Presentation ============
const fileName = ${JSON.stringify(safeFileName)};
pptx.writeFile({ fileName })
  .then(filePath => {
    console.log('Presentation saved to: ' + filePath);
  })
  .catch(err => {
    console.error('Error saving presentation:', err);
  });
`;

  if (hasImages || hasBrandingLogo) {
    code += `
})().catch(err => {
  console.error('Error in async execution:', err);
});
`;
  }

  return code;
}

// Export all generators for use in document-agent
export const slideGenerators = {
  title: generateTitleSlideCode,
  section: generateSectionSlideCode,
  content: generateContentSlideCode,
  twoColumn: generateTwoColumnSlideCode,
  threeColumn: generateThreeColumnSlideCode,
  stats: generateStatsSlideCode,
  multiStats: generateMultiStatsSlideCode,
  quote: generateQuoteSlideCode,
  imageText: generateImageTextSlideCode,
  imageFull: generateImageFullSlideCode,
  timeline: generateTimelineSlideCode,
  process: generateProcessSlideCode,
  chart: generateChartSlideCode,
  table: generateTableSlideCode,
  agenda: generateAgendaSlideCode,
  thankYou: generateThankYouSlideCode,
  contact: generateContactSlideCode,
  team: generateTeamSlideCode,
  imageGrid: generateImageGridSlideCode,
  dashboard: generateDashboardSlideCode,
};
