/**
 * AI Document Optimizer
 *
 * Provides intelligent optimization for document generation:
 * - Content summarization for slides
 * - Layout recommendations based on content type
 * - Chart type suggestions based on data
 * - Color accessibility validation
 * - Text density analysis
 * - Visual balance suggestions
 */

import { type SlideContent, type SlideLayoutType } from "./document-templates";
import { getPalette } from "./document-templates/color-palettes";

// Optimization suggestion types
export interface OptimizationSuggestion {
  type:
    | "content"
    | "layout"
    | "chart"
    | "color"
    | "density"
    | "balance"
    | "readability";
  severity: "info" | "warning" | "error";
  message: string;
  recommendation: string;
  affectedElement?: string;
  autoFixAvailable?: boolean;
}

// Content analysis result
export interface ContentAnalysis {
  wordCount: number;
  sentenceCount: number;
  avgWordsPerSentence: number;
  bulletPointCount: number;
  hasNumbers: boolean;
  hasComparisons: boolean;
  hasTimeline: boolean;
  hasProcess: boolean;
  primaryTopic?: string;
}

// Data analysis result for charts
export interface DataAnalysis {
  rowCount: number;
  columnCount: number;
  hasNegativeValues: boolean;
  hasPercentages: boolean;
  hasTimeSeries: boolean;
  hasCategorical: boolean;
  valueRange: { min: number; max: number };
  suggestedChartTypes: string[];
}

// Slide optimization result
export interface SlideOptimization {
  originalSlide: SlideContent;
  suggestions: OptimizationSuggestion[];
  optimizedSlide?: SlideContent;
  recommendedLayout?: SlideLayoutType;
}

// Document optimization result
export interface DocumentOptimization {
  totalSuggestions: number;
  criticalIssues: number;
  warnings: number;
  suggestions: OptimizationSuggestion[];
  overallScore: number; // 0-100
  categories: {
    content: number;
    design: number;
    accessibility: number;
    readability: number;
  };
}

/**
 * Analyze content to determine optimal presentation format
 */
export function analyzeContent(content: string): ContentAnalysis {
  const sentences = content.split(/[.!?]+/).filter((s) => s.trim().length > 0);
  const words = content.split(/\s+/).filter((w) => w.length > 0);
  const bulletPoints = (content.match(/^[-•*]\s/gm) || []).length;

  // Check for specific content patterns
  const hasNumbers = /\d+/.test(content);
  const hasComparisons =
    /versus|vs\.?|compared|better|worse|more|less|than/i.test(content);
  const hasTimeline =
    /first|then|next|finally|after|before|during|phase|step|stage/i.test(
      content,
    );
  const hasProcess = /process|workflow|procedure|steps|how to/i.test(content);

  return {
    wordCount: words.length,
    sentenceCount: sentences.length,
    avgWordsPerSentence:
      sentences.length > 0 ? words.length / sentences.length : 0,
    bulletPointCount: bulletPoints,
    hasNumbers,
    hasComparisons,
    hasTimeline,
    hasProcess,
  };
}

/**
 * Suggest optimal slide layout based on content
 */
export function suggestSlideLayout(content: string): SlideLayoutType {
  const analysis = analyzeContent(content);

  // Timeline/process content -> timeline or process slide
  if (analysis.hasTimeline || analysis.hasProcess) {
    return "content"; // Could be "timeline" or "process" in enhanced version
  }

  // Comparison content -> two-column
  if (analysis.hasComparisons) {
    return "two-column";
  }

  // Statistical/numerical content -> stats
  if (
    analysis.hasNumbers &&
    analysis.wordCount < 50 &&
    analysis.bulletPointCount <= 3
  ) {
    return "stats";
  }

  // Short content -> title or section
  if (analysis.wordCount < 20) {
    return "section";
  }

  // Long content with bullet points -> content
  if (analysis.bulletPointCount > 0 || analysis.wordCount > 100) {
    return "content";
  }

  // Default to content slide
  return "content";
}

/**
 * Analyze data for chart recommendations
 */
export function analyzeDataForChart(
  data: Record<string, unknown>[],
): DataAnalysis {
  if (data.length === 0) {
    return {
      rowCount: 0,
      columnCount: 0,
      hasNegativeValues: false,
      hasPercentages: false,
      hasTimeSeries: false,
      hasCategorical: false,
      valueRange: { min: 0, max: 0 },
      suggestedChartTypes: ["column"],
    };
  }

  const columns = Object.keys(data[0]);
  const numericColumns: number[][] = [];
  let hasNegative = false;
  let hasPercent = false;
  let hasDate = false;
  let hasCategorical = false;

  // Analyze each column
  columns.forEach((col) => {
    const values = data.map((row) => row[col]);
    const numericValues: number[] = values.filter(
      (v): v is number => typeof v === "number",
    );

    if (numericValues.length > 0) {
      numericColumns.push(numericValues);
      if (numericValues.some((v) => v < 0)) hasNegative = true;
      if (numericValues.every((v) => v >= 0 && v <= 1)) hasPercent = true;
    }

    // Check for date strings
    if (
      values.some(
        (v) =>
          typeof v === "string" &&
          /^\d{4}[-/]\d{2}[-/]\d{2}|^\d{1,2}[-/]\d{1,2}[-/]\d{2,4}/.test(v),
      )
    ) {
      hasDate = true;
    }

    // Check for categorical data
    if (values.every((v) => typeof v === "string")) {
      hasCategorical = true;
    }
  });

  // Calculate value range
  const allValues = numericColumns.flat();
  const min = allValues.length > 0 ? Math.min(...allValues) : 0;
  const max = allValues.length > 0 ? Math.max(...allValues) : 0;

  // Suggest chart types based on data characteristics
  const suggestions: string[] = [];

  if (hasDate) {
    suggestions.push("line", "area");
  }

  if (hasPercent && data.length <= 6) {
    suggestions.push("pie", "doughnut");
  }

  if (hasNegative) {
    suggestions.push("bar", "waterfall");
  }

  if (hasCategorical && !hasDate) {
    suggestions.push("column", "bar");
  }

  if (data.length > 10) {
    suggestions.push("line", "scatter");
  }

  if (numericColumns.length >= 2) {
    suggestions.push("scatter", "bubble");
  }

  // Default suggestions if none matched
  if (suggestions.length === 0) {
    suggestions.push("column", "bar", "line");
  }

  return {
    rowCount: data.length,
    columnCount: columns.length,
    hasNegativeValues: hasNegative,
    hasPercentages: hasPercent,
    hasTimeSeries: hasDate,
    hasCategorical,
    valueRange: { min, max },
    suggestedChartTypes: [...new Set(suggestions)],
  };
}

/**
 * Check color contrast for accessibility (WCAG 2.1)
 */
export function checkColorContrast(
  foreground: string,
  background: string,
): { ratio: number; passesAA: boolean; passesAAA: boolean } {
  // Convert hex to RGB
  const hexToRgb = (hex: string): { r: number; g: number; b: number } => {
    const cleanHex = hex.replaceAll("#", "");
    return {
      r: Number.parseInt(cleanHex.slice(0, 2), 16),
      g: Number.parseInt(cleanHex.slice(2, 4), 16),
      b: Number.parseInt(cleanHex.slice(4, 6), 16),
    };
  };

  // Calculate relative luminance
  const getLuminance = (rgb: { r: number; g: number; b: number }): number => {
    const [rs, gs, bs] = [rgb.r / 255, rgb.g / 255, rgb.b / 255].map((c) =>
      c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4),
    );
    return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
  };

  const l1 = getLuminance(hexToRgb(foreground));
  const l2 = getLuminance(hexToRgb(background));
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  const ratio = (lighter + 0.05) / (darker + 0.05);

  return {
    ratio: Math.round(ratio * 100) / 100,
    passesAA: ratio >= 4.5,
    passesAAA: ratio >= 7,
  };
}

/**
 * Validate color palette accessibility
 */
export function validatePaletteAccessibility(
  paletteName: string,
): OptimizationSuggestion[] {
  const palette = getPalette(paletteName);
  const suggestions: OptimizationSuggestion[] = [];

  // Check primary text on background
  const primaryContrast = checkColorContrast(palette.text, palette.background);
  if (!primaryContrast.passesAA) {
    suggestions.push({
      type: "color",
      severity: "error",
      message: `Low contrast between text (${palette.text}) and background (${palette.background})`,
      recommendation: `Contrast ratio is ${primaryContrast.ratio}:1. WCAG AA requires 4.5:1 minimum.`,
      autoFixAvailable: false,
    });
  }

  // Check inverse text on primary
  const inverseContrast = checkColorContrast(
    palette.textInverse,
    palette.primary,
  );
  if (!inverseContrast.passesAA) {
    suggestions.push({
      type: "color",
      severity: "warning",
      message: `Low contrast between inverse text and primary color`,
      recommendation: `Contrast ratio is ${inverseContrast.ratio}:1. Consider using a darker primary or lighter text.`,
      autoFixAvailable: false,
    });
  }

  // Check muted text
  const mutedContrast = checkColorContrast(
    palette.textMuted,
    palette.background,
  );
  if (!mutedContrast.passesAA) {
    suggestions.push({
      type: "color",
      severity: "info",
      message: `Muted text may be difficult to read`,
      recommendation: `Contrast ratio is ${mutedContrast.ratio}:1. Consider darkening the muted text color.`,
      autoFixAvailable: false,
    });
  }

  return suggestions;
}

/**
 * Analyze slide text density
 */
export function analyzeTextDensity(
  slide: SlideContent,
): OptimizationSuggestion[] {
  const suggestions: OptimizationSuggestion[] = [];

  // Count total words in slide
  let totalWords = 0;
  if (slide.content) {
    if (typeof slide.content === "string") {
      totalWords += slide.content.split(/\s+/).length;
    } else if (Array.isArray(slide.content)) {
      totalWords += slide.content.join(" ").split(/\s+/).length;
    }
  }

  if (slide.leftContent) {
    const content = Array.isArray(slide.leftContent)
      ? slide.leftContent.join(" ")
      : slide.leftContent;
    totalWords += content.split(/\s+/).length;
  }

  if (slide.rightContent) {
    const content = Array.isArray(slide.rightContent)
      ? slide.rightContent.join(" ")
      : slide.rightContent;
    totalWords += content.split(/\s+/).length;
  }

  // Check bullet point count
  const bulletCount = slide.items?.length || 0;

  // Density checks
  if (totalWords > 150) {
    suggestions.push({
      type: "density",
      severity: "warning",
      message: `Slide has ${totalWords} words - too much text for effective presentation`,
      recommendation:
        "Limit slides to 50-75 words. Consider splitting into multiple slides or using visuals.",
      autoFixAvailable: true,
    });
  } else if (totalWords > 100) {
    suggestions.push({
      type: "density",
      severity: "info",
      message: `Slide has ${totalWords} words - consider reducing text`,
      recommendation:
        "Best practice is 50-75 words per slide for optimal audience engagement.",
      autoFixAvailable: false,
    });
  }

  if (bulletCount > 7) {
    suggestions.push({
      type: "density",
      severity: "warning",
      message: `Slide has ${bulletCount} bullet points - too many for one slide`,
      recommendation:
        "Limit to 5-7 bullet points per slide. Group related points or split into multiple slides.",
      autoFixAvailable: true,
    });
  }

  return suggestions;
}

/**
 * Summarize long content for slides (basic implementation)
 */
export function summarizeForSlide(
  content: string,
  maxWords: number = 75,
): string {
  const sentences = content.split(/[.!?]+/).filter((s) => s.trim().length > 0);
  const words = content.split(/\s+/);

  if (words.length <= maxWords) {
    return content;
  }

  // Take the most important sentences (first and those with key terms)
  const keyTerms = [
    "important",
    "key",
    "main",
    "critical",
    "essential",
    "significant",
    "primary",
    "result",
    "conclusion",
  ];

  const scoredSentences = sentences.map((sentence, index) => {
    let score = 0;
    // First sentence gets bonus
    if (index === 0) score += 3;
    // Last sentence gets bonus
    if (index === sentences.length - 1) score += 2;
    // Key terms bonus
    keyTerms.forEach((term) => {
      if (sentence.toLowerCase().includes(term)) score += 1;
    });
    // Numbers bonus
    if (/\d+/.test(sentence)) score += 1;

    return { sentence, score };
  });

  // Sort by score and take top sentences
  scoredSentences.sort((a, b) => b.score - a.score);

  let result = "";
  let currentWords = 0;

  for (const { sentence } of scoredSentences) {
    const sentenceWords = sentence.trim().split(/\s+/).length;
    if (currentWords + sentenceWords <= maxWords) {
      result += sentence.trim() + ". ";
      currentWords += sentenceWords;
    }
  }

  return result.trim();
}

/**
 * Convert long content to bullet points
 */
export function convertToBulletPoints(
  content: string,
  maxBullets: number = 5,
): string[] {
  const sentences = content.split(/[.!?]+/).filter((s) => s.trim().length > 0);

  if (sentences.length <= maxBullets) {
    return sentences.map((s) => s.trim());
  }

  // Score and select most important sentences
  const keyTerms = [
    "important",
    "key",
    "main",
    "result",
    "conclusion",
    "significant",
  ];

  const scoredSentences = sentences.map((sentence, index) => {
    let score = 0;
    if (index === 0) score += 3;
    if (index === sentences.length - 1) score += 2;
    keyTerms.forEach((term) => {
      if (sentence.toLowerCase().includes(term)) score += 1;
    });
    if (/\d+/.test(sentence)) score += 1;
    return { sentence: sentence.trim(), score };
  });

  scoredSentences.sort((a, b) => b.score - a.score);

  return scoredSentences.slice(0, maxBullets).map((s) => s.sentence);
}

/**
 * Optimize a single slide
 */
export function optimizeSlide(slide: SlideContent): SlideOptimization {
  const suggestions: OptimizationSuggestion[] = [];

  // Check text density
  suggestions.push(...analyzeTextDensity(slide));

  // Check if layout is optimal for content
  if (slide.content) {
    const content =
      typeof slide.content === "string"
        ? slide.content
        : slide.content.join(" ");
    const recommendedLayout = suggestSlideLayout(content);

    if (recommendedLayout !== slide.type) {
      suggestions.push({
        type: "layout",
        severity: "info",
        message: `Current layout "${slide.type}" may not be optimal`,
        recommendation: `Consider using "${recommendedLayout}" layout for this content type.`,
        autoFixAvailable: true,
      });
    }
  }

  // Check for missing title
  if (!slide.title && slide.type !== "quote" && slide.type !== "image-full") {
    suggestions.push({
      type: "content",
      severity: "info",
      message: "Slide has no title",
      recommendation: "Adding a title improves navigation and understanding.",
      autoFixAvailable: false,
    });
  }

  return {
    originalSlide: slide,
    suggestions,
    recommendedLayout: suggestSlideLayout(
      typeof slide.content === "string"
        ? slide.content || ""
        : (slide.content || []).join(" "),
    ),
  };
}

/**
 * Optimize entire document/presentation
 */
export function optimizeDocument(
  slides: SlideContent[],
  paletteName?: string,
): DocumentOptimization {
  const allSuggestions: OptimizationSuggestion[] = [];

  // Check each slide
  slides.forEach((slide, index) => {
    const optimization = optimizeSlide(slide);
    optimization.suggestions.forEach((s) => {
      allSuggestions.push({
        ...s,
        affectedElement: `Slide ${index + 1}`,
      });
    });
  });

  // Check palette accessibility
  if (paletteName) {
    allSuggestions.push(...validatePaletteAccessibility(paletteName));
  }

  // Calculate scores
  const criticalIssues = allSuggestions.filter(
    (s) => s.severity === "error",
  ).length;
  const warnings = allSuggestions.filter(
    (s) => s.severity === "warning",
  ).length;
  const info = allSuggestions.filter((s) => s.severity === "info").length;

  // Overall score calculation (100 - deductions)
  const overallScore = Math.max(
    0,
    100 - criticalIssues * 20 - warnings * 10 - info * 2,
  );

  // Category scores
  const contentIssues = allSuggestions.filter(
    (s) => s.type === "content" || s.type === "density",
  ).length;
  const designIssues = allSuggestions.filter(
    (s) => s.type === "layout" || s.type === "balance",
  ).length;
  const accessibilityIssues = allSuggestions.filter(
    (s) => s.type === "color",
  ).length;
  const readabilityIssues = allSuggestions.filter(
    (s) => s.type === "readability" || s.type === "density",
  ).length;

  return {
    totalSuggestions: allSuggestions.length,
    criticalIssues,
    warnings,
    suggestions: allSuggestions,
    overallScore,
    categories: {
      content: Math.max(0, 100 - contentIssues * 15),
      design: Math.max(0, 100 - designIssues * 15),
      accessibility: Math.max(0, 100 - accessibilityIssues * 20),
      readability: Math.max(0, 100 - readabilityIssues * 15),
    },
  };
}

// Export all functions
export const documentOptimizer = {
  analyzeContent,
  suggestSlideLayout,
  analyzeDataForChart,
  checkColorContrast,
  validatePaletteAccessibility,
  analyzeTextDensity,
  summarizeForSlide,
  convertToBulletPoints,
  optimizeSlide,
  optimizeDocument,
};
