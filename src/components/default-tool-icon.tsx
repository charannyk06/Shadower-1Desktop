"use client";
import { DefaultToolName } from "lib/ai/tools";
import { cn } from "lib/utils";
import {
  BookOpenIcon,
  ChartColumnIcon,
  ChartPieIcon,
  CodeIcon,
  ComputerIcon,
  FileSpreadsheetIcon,
  FileTextIcon,
  GlobeIcon,
  GripIcon,
  HammerIcon,
  ImageIcon,
  KeyboardIcon,
  MousePointerClickIcon,
  NavigationIcon,
  PlayIcon,
  PresentationIcon,
  ScrollIcon,
  SearchIcon,
  TableOfContents,
  TimerIcon,
  TrendingUpIcon,
  UploadIcon,
  XIcon,
} from "lucide-react";
import { useMemo } from "react";

export function DefaultToolIcon({
  name,
  className,
}: {
  name: DefaultToolName;
  className?: string;
}) {
  return useMemo(() => {
    // Visualization tools
    if (name === DefaultToolName.CreatePieChart) {
      return (
        <ChartPieIcon className={cn("size-3.5 text-blue-500", className)} />
      );
    }
    if (name === DefaultToolName.CreateBarChart) {
      return (
        <ChartColumnIcon className={cn("size-3.5 text-blue-500", className)} />
      );
    }
    if (name === DefaultToolName.CreateLineChart) {
      return (
        <TrendingUpIcon className={cn("size-3.5 text-blue-500", className)} />
      );
    }
    if (name === DefaultToolName.CreateTable) {
      return (
        <TableOfContents className={cn("size-3.5 text-blue-500", className)} />
      );
    }

    // Web tools
    if (name === DefaultToolName.WebSearch) {
      return <GlobeIcon className={cn("size-3.5 text-blue-400", className)} />;
    }
    if (name === DefaultToolName.WebContent) {
      return <GlobeIcon className={cn("size-3.5 text-blue-400", className)} />;
    }

    // Browser automation tools (Local Chrome DevTools Protocol)
    if (name === DefaultToolName.BrowserCreateSession) {
      return <PlayIcon className={cn("size-3.5 text-orange-500", className)} />;
    }
    if (name === DefaultToolName.BrowserCloseSession) {
      return <XIcon className={cn("size-3.5 text-orange-500", className)} />;
    }
    if (name === DefaultToolName.BrowserNavigate) {
      return (
        <NavigationIcon className={cn("size-3.5 text-orange-500", className)} />
      );
    }
    if (name === DefaultToolName.BrowserClick) {
      return (
        <MousePointerClickIcon
          className={cn("size-3.5 text-orange-500", className)}
        />
      );
    }
    if (name === DefaultToolName.BrowserFill) {
      return (
        <FileTextIcon className={cn("size-3.5 text-orange-400", className)} />
      );
    }
    if (name === DefaultToolName.BrowserType) {
      return (
        <FileTextIcon className={cn("size-3.5 text-orange-400", className)} />
      );
    }
    if (name === DefaultToolName.BrowserGetSnapshot) {
      return (
        <SearchIcon className={cn("size-3.5 text-orange-400", className)} />
      );
    }
    if (name === DefaultToolName.BrowserGetContent) {
      return (
        <FileTextIcon className={cn("size-3.5 text-orange-400", className)} />
      );
    }
    if (name === DefaultToolName.BrowserScreenshot) {
      return (
        <ImageIcon className={cn("size-3.5 text-orange-500", className)} />
      );
    }
    if (name === DefaultToolName.BrowserWait) {
      return (
        <TimerIcon className={cn("size-3.5 text-orange-400", className)} />
      );
    }
    if (name === DefaultToolName.BrowserEvaluate) {
      return <CodeIcon className={cn("size-3.5 text-orange-500", className)} />;
    }

    // Desktop/Computer Use tools (Local Terminal)
    if (name === DefaultToolName.DesktopScreenshot) {
      return (
        <ComputerIcon className={cn("size-3.5 text-purple-500", className)} />
      );
    }
    if (name === DefaultToolName.DesktopClick) {
      return (
        <MousePointerClickIcon
          className={cn("size-3.5 text-purple-500", className)}
        />
      );
    }
    if (name === DefaultToolName.DesktopType) {
      return (
        <KeyboardIcon className={cn("size-3.5 text-purple-400", className)} />
      );
    }
    if (name === DefaultToolName.DesktopPress) {
      return (
        <KeyboardIcon className={cn("size-3.5 text-purple-500", className)} />
      );
    }
    if (name === DefaultToolName.DesktopScroll) {
      return (
        <ScrollIcon className={cn("size-3.5 text-purple-400", className)} />
      );
    }
    if (name === DefaultToolName.DesktopDrag) {
      return <GripIcon className={cn("size-3.5 text-purple-500", className)} />;
    }
    if (name === DefaultToolName.DesktopLaunchApp) {
      return <PlayIcon className={cn("size-3.5 text-purple-600", className)} />;
    }

    // Data analysis tools
    if (name === DefaultToolName.UploadDataset) {
      return <UploadIcon className={cn("size-3.5 text-cyan-500", className)} />;
    }
    if (name === DefaultToolName.ProfileData) {
      return <SearchIcon className={cn("size-3.5 text-cyan-400", className)} />;
    }
    if (name === DefaultToolName.AnalyzeData) {
      return (
        <ChartColumnIcon className={cn("size-3.5 text-cyan-500", className)} />
      );
    }
    if (name === DefaultToolName.CreateVisualization) {
      return (
        <ChartPieIcon className={cn("size-3.5 text-cyan-500", className)} />
      );
    }

    // Document generation tools
    if (name === DefaultToolName.CreatePresentation) {
      return (
        <PresentationIcon
          className={cn("size-3.5 text-amber-500", className)}
        />
      );
    }
    if (name === DefaultToolName.CreateDocument) {
      return (
        <FileTextIcon className={cn("size-3.5 text-amber-500", className)} />
      );
    }
    if (name === DefaultToolName.CreateSpreadsheet) {
      return (
        <FileSpreadsheetIcon
          className={cn("size-3.5 text-amber-500", className)}
        />
      );
    }
    // Research tools
    if (name === DefaultToolName.DeepResearch) {
      return (
        <BookOpenIcon className={cn("size-3.5 text-indigo-500", className)} />
      );
    }

    return <HammerIcon className={cn("size-3.5", className)} />;
  }, [name, className]);
}
