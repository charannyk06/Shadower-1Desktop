export enum AppDefaultToolkit {
  Visualization = "visualization",
  WebSearch = "webSearch",
  Http = "http",
  // Browser and Desktop automation toolkits (local execution)
  Browser = "browser",
  Desktop = "desktop",
  DataAnalysis = "dataAnalysis",
  Documents = "documents",
  Research = "research",
  Memory = "memory",
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
  // Browser automation tools (Local Chrome DevTools Protocol via agent-browser)
  BrowserCreateSession = "browserCreateSession",
  BrowserCloseSession = "browserCloseSession",
  BrowserListSessions = "browserListSessions",
  BrowserSwitchSession = "browserSwitchSession",
  BrowserNavigate = "browserNavigate",
  BrowserGoBack = "browserGoBack",
  BrowserGoForward = "browserGoForward",
  BrowserReload = "browserReload",
  BrowserGetSnapshot = "browserGetSnapshot",
  BrowserGetContext = "browserGetContext",
  BrowserAnalyzeForms = "browserAnalyzeForms",
  BrowserFillForm = "browserFillForm",
  BrowserClick = "browserClick",
  BrowserFill = "browserFill",
  BrowserType = "browserType",
  BrowserPressKey = "browserPressKey",
  BrowserScroll = "browserScroll",
  BrowserWait = "browserWait",
  BrowserScreenshot = "browserScreenshot",
  BrowserGetContent = "browserGetContent",
  BrowserGetUrl = "browserGetUrl",
  BrowserGetTitle = "browserGetTitle",
  BrowserEvaluate = "browserEvaluate",
  // Desktop/Computer Use tools (Local Terminal)
  DesktopCreate = "desktopCreate",
  DesktopCommand = "desktopCommand", // Shell/terminal command execution
  DesktopScreenshot = "desktopScreenshot",
  DesktopClick = "desktopClick",
  DesktopType = "desktopType",
  DesktopPress = "desktopPress",
  DesktopScroll = "desktopScroll",
  DesktopDrag = "desktopDrag",
  DesktopLaunchApp = "desktopLaunchApp",
  DesktopDisplayInfo = "desktopDisplayInfo",
  DesktopCursorPosition = "desktopCursorPosition",
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
}

export const SequentialThinkingToolName = "sequential_thinking";

export const ImageToolName = "image_manager";
