"use client";

import { cn } from "lib/utils";
import {
  FileIcon,
  FileTextIcon,
  ImageIcon,
  MusicIcon,
  VideoIcon,
} from "lucide-react";
import { useMemo } from "react";
import {
  FaFileExcel,
  FaFilePdf,
  FaFilePowerpoint,
  FaFileWord,
} from "react-icons/fa";
import {
  SiCss3,
  SiHtml5,
  SiJavascript,
  SiPython,
  SiTypescript,
} from "react-icons/si";
import {
  VscFile,
  VscFileCode,
  VscFileZip,
  VscJson,
  VscMarkdown,
} from "react-icons/vsc";

interface FileTypeIconProps {
  readonly filename?: string;
  readonly className?: string;
  readonly size?: number;
}

/**
 * Comprehensive file type icon component that maps file extensions
 * to proper icons using real icon libraries (react-icons).
 * Follows the same pattern as other icon components in the codebase.
 */
export function FileTypeIcon({
  filename,
  className,
  size = 16,
}: FileTypeIconProps) {
  const icon = useMemo(() => {
    if (!filename) {
      return (
        <FileIcon
          className={cn("size-4", className)}
          style={{ width: size, height: size }}
        />
      );
    }

    const ext = filename.split(".").pop()?.toLowerCase() || "";
    const name = filename.toLowerCase();
    const sizeStyle = { width: size, height: size };

    // Images
    if (
      [
        "jpg",
        "jpeg",
        "png",
        "gif",
        "webp",
        "svg",
        "ico",
        "bmp",
        "tiff",
      ].includes(ext)
    ) {
      return (
        <ImageIcon className={cn("size-4", className)} style={sizeStyle} />
      );
    }

    // PDF - FontAwesome PDF icon
    if (ext === "pdf") {
      return (
        <FaFilePdf
          className={cn("size-4 text-red-600", className)}
          style={sizeStyle}
        />
      );
    }

    // Office Documents - Word (FontAwesome Word icon)
    if (["doc", "docx"].includes(ext)) {
      return (
        <FaFileWord
          className={cn("size-4 text-blue-600", className)}
          style={sizeStyle}
        />
      );
    }

    // Office Documents - Excel (FontAwesome Excel icon)
    if (["xls", "xlsx", "csv"].includes(ext)) {
      return (
        <FaFileExcel
          className={cn("size-4 text-green-600", className)}
          style={sizeStyle}
        />
      );
    }

    // Office Documents - PowerPoint (FontAwesome PowerPoint icon)
    if (["ppt", "pptx"].includes(ext)) {
      return (
        <FaFilePowerpoint
          className={cn("size-4 text-orange-600", className)}
          style={sizeStyle}
        />
      );
    }

    // Code Files - JavaScript
    if (["js", "jsx", "mjs", "cjs"].includes(ext)) {
      return (
        <SiJavascript
          className={cn("size-4 text-yellow-400", className)}
          style={sizeStyle}
        />
      );
    }

    // Code Files - TypeScript
    if (["ts", "tsx"].includes(ext)) {
      return (
        <SiTypescript
          className={cn("size-4 text-blue-600", className)}
          style={sizeStyle}
        />
      );
    }

    // Code Files - Python
    if (ext === "py" || name === "python") {
      return (
        <SiPython
          className={cn("size-4 text-yellow-500", className)}
          style={sizeStyle}
        />
      );
    }

    // Code Files - HTML
    if (["html", "htm"].includes(ext)) {
      return (
        <SiHtml5
          className={cn("size-4 text-orange-500", className)}
          style={sizeStyle}
        />
      );
    }

    // Code Files - CSS
    if (["css", "scss", "sass", "less"].includes(ext)) {
      return (
        <SiCss3
          className={cn("size-4 text-blue-500", className)}
          style={sizeStyle}
        />
      );
    }

    // JSON
    if (ext === "json") {
      return <VscJson className={cn("size-4", className)} style={sizeStyle} />;
    }

    // Markdown
    if (["md", "markdown"].includes(ext)) {
      return (
        <VscMarkdown className={cn("size-4", className)} style={sizeStyle} />
      );
    }

    // Text files
    if (ext === "txt") {
      return (
        <FileTextIcon className={cn("size-4", className)} style={sizeStyle} />
      );
    }

    // Code files - generic
    if (
      [
        "c",
        "cpp",
        "cc",
        "cxx",
        "h",
        "hpp",
        "java",
        "go",
        "rs",
        "rb",
        "php",
        "swift",
        "kt",
        "scala",
        "r",
        "sh",
        "bash",
        "zsh",
        "fish",
        "ps1",
        "bat",
        "cmd",
      ].includes(ext)
    ) {
      return (
        <VscFileCode className={cn("size-4", className)} style={sizeStyle} />
      );
    }

    // Audio files
    if (
      ["mp3", "wav", "ogg", "m4a", "flac", "aac", "wma", "opus"].includes(ext)
    ) {
      return (
        <MusicIcon
          className={cn("size-4 text-purple-500", className)}
          style={sizeStyle}
        />
      );
    }

    // Video files
    if (
      ["mp4", "webm", "avi", "mov", "wmv", "flv", "mkv", "m4v"].includes(ext)
    ) {
      return (
        <VideoIcon
          className={cn("size-4 text-red-500", className)}
          style={sizeStyle}
        />
      );
    }

    // Archive files
    if (
      [
        "zip",
        "rar",
        "7z",
        "tar",
        "gz",
        "bz2",
        "xz",
        "z",
        "tar.gz",
        "tar.bz2",
      ].includes(ext)
    ) {
      return (
        <VscFileZip className={cn("size-4", className)} style={sizeStyle} />
      );
    }

    // XML
    if (ext === "xml") {
      return (
        <VscFileCode
          className={cn("size-4 text-orange-600", className)}
          style={sizeStyle}
        />
      );
    }

    // YAML/YML
    if (["yaml", "yml"].includes(ext)) {
      return (
        <FileTextIcon
          className={cn("size-4 text-blue-500", className)}
          style={sizeStyle}
        />
      );
    }

    // Default
    return <VscFile className={cn("size-4", className)} style={sizeStyle} />;
  }, [filename, className, size]);

  return icon;
}
