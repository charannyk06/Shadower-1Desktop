export enum AppDefaultToolkit {
  Visualization = "visualization",
  WebSearch = "webSearch",
  Http = "http",
  Sandbox = "sandbox",
  // Browser and Desktop automation toolkits
  Browser = "browser",
  Desktop = "desktop",
  DataAnalysis = "dataAnalysis",
  Documents = "documents",
  Research = "research",
  Memory = "memory",
  // Fragment-based micro-app and document generation
  Fragments = "fragments",
}

export enum DefaultToolName {
  // Existing tools
  CreatePieChart = "createPieChart",
  CreateBarChart = "createBarChart",
  CreateLineChart = "createLineChart",
  CreateTable = "createTable",
  WebSearch = "webSearch",
  WebContent = "webContent",
  Http = "http",
  Sandbox = "sandbox",
  // Browser automation tools (Local Chrome DevTools Protocol)
  BrowserNavigate = "browserNavigate",
  BrowserAct = "browserAct",
  BrowserObserve = "browserObserve",
  BrowserExtract = "browserExtract",
  BrowserScreenshot = "browserScreenshot",
  BrowserStealth = "browserStealth",
  BrowserWait = "browserWait",
  BrowserClose = "browserClose",
  // Desktop/Computer Use tools (Local Terminal)
  DesktopCreate = "desktopCreate",
  DesktopScreenshot = "desktopScreenshot",
  DesktopClick = "desktopClick",
  DesktopType = "desktopType",
  DesktopPress = "desktopPress",
  DesktopScroll = "desktopScroll",
  DesktopDrag = "desktopDrag",
  DesktopLaunchApp = "desktopLaunchApp",
  // Data analysis tools
  UploadDataset = "uploadDataset",
  ProfileData = "profileData",
  AnalyzeData = "analyzeData",
  CreateVisualization = "createVisualization",
  // Document generation tools
  CreatePresentation = "createPresentation",
  CreateDocument = "createDocument",
  CreateSpreadsheet = "createSpreadsheet",
  CreateMultiSheetWorkbook = "createMultiSheetWorkbook",
  CreatePDF = "createPDF",
  // Document editing tools (surgical editing of existing documents)
  EditSpreadsheet = "editSpreadsheet",
  EditPresentation = "editPresentation",
  EditDocument = "editDocument",
  // Research tools
  DeepResearch = "deepResearch",
  // Memory tools
  RememberContext = "rememberContext",
  // Fragment tools (autonomous app generation)
  CreateFragment = "createFragment",
  EditFragment = "editFragment",
  DeployFragment = "deployFragment",
  GetFragment = "getFragment",
  ListFragments = "listFragments",
}

export const SequentialThinkingToolName = "sequential_thinking";

export const ImageToolName = "image_manager";
