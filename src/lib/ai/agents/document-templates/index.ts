/**
 * Document Templates - Gamma-style professional document generation
 *
 * This module provides templates for creating stunning presentations,
 * Word documents, and Excel spreadsheets using JavaScript libraries
 * (PptxGenJS, docx, ExcelJS) instead of Python.
 */

// Color palettes
export {
  COLOR_PALETTES,
  DEFAULT_PALETTE,
  getPalette,
  getPaletteNames,
  getPalettesByMode,
  generatePaletteFromColor,
  generatePaletteFromMood,
  adjustPaletteForAccessibility,
  getRandomPalette,
  suggestPalette,
  type ColorPalette,
  type MoodPreset,
} from "./color-palettes";

// Presentation templates (Manus/Gamma quality)
export {
  FONTS,
  SLIDE_DIMENSIONS,
  LAYOUT_POSITIONS,
  // Visual effect helpers
  generateGradientBackgroundCode,
  generateCalloutBoxCode,
  generateCardCode,
  generateDecorativeAccentsCode,
  // Core template functions
  generateSlideMaster,
  generateMasterSlidesCode,
  getMasterForSlideType,
  getSlideBackground,
  getTextStyle,
  generateTitleSlideCode,
  generateSectionSlideCode,
  generateContentSlideCode,
  generateTwoColumnSlideCode,
  generateThreeColumnSlideCode,
  generateStatsSlideCode,
  generateQuoteSlideCode,
  generateImageTextSlideCode,
  generatePresentationTemplate,
  slideGenerators,
  type SlideTransition,
  type SlideLayoutType,
  type SlideContent,
  type BrandingConfig,
  type MasterSlideConfig,
} from "./presentation-templates";

// Document templates
export {
  DOCUMENT_FONTS,
  SPACING,
  generateCoverPageCode,
  generateTocCode,
  generateHeadingCode,
  generateParagraphCode,
  generateBulletListCode,
  generateNumberedListCode,
  generateTableCode,
  generateAdvancedTableCode,
  generateQuoteCode as generateDocQuoteCode,
  generateCodeBlockCode,
  generateHeaderFooterCode,
  generateDocumentTemplate,
  type DocumentTemplateType,
  type SectionType,
  type DocumentSection,
  type DocumentOptions,
  type TableCellConfig,
  type AdvancedTableData,
} from "./document-templates";

// Spreadsheet templates
export {
  SPREADSHEET_FONTS,
  generateHeaderStyleCode,
  generateAlternatingRowStyleCode,
  generateDataBarCode,
  generateColorScaleCode,
  generateIconSetCode,
  generateHighlightCellsCode,
  generateChartCode,
  generateAdvancedChartCode,
  generateFormulaCode,
  generateFreezePaneCode,
  generateAutoFilterCode,
  generateDashboardTitleCode,
  generateSpreadsheetTemplate,
  generateMultiSheetWorkbook,
  generateSampleData,
  type SpreadsheetTemplateType,
  type ConditionalFormatType,
  type ChartType,
  type FormulaType,
  type FormulaConfig,
  type ConditionalFormatRule,
  type ChartConfig,
  type SpreadsheetOptions,
  type ColumnConfig,
  type SheetConfig,
  type WorkbookOptions,
} from "./spreadsheet-templates";

// Edit templates (for surgical editing of existing documents)
export {
  generateSpreadsheetEditCode,
  generatePresentationEditCode,
  generateDocumentEditCode,
  generateDownloadHelperCode,
  type SpreadsheetChange,
  type PresentationChange,
  type DocumentChange,
} from "./edit-templates";

// PDF templates
export {
  generatePDFTemplate,
  type PDFTemplateType,
  type PDFSectionType,
  type PDFSection,
  type PDFOptions,
} from "./pdf-templates";
