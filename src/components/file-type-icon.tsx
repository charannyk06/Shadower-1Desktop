"use client";

import { getIcon, defaultIcon } from "material-file-icons";
import { cn } from "lib/utils";
import { useMemo } from "react";
import { FolderIcon, FolderOpenIcon } from "lucide-react";

interface FileTypeIconProps {
  readonly filename?: string;
  readonly className?: string;
  readonly size?: number;
  readonly isFolder?: boolean;
  readonly isOpen?: boolean;
}

/**
 * Sanitize SVG content to remove potentially dangerous elements.
 * The material-file-icons library is trusted, but this provides defense-in-depth
 * against any compromised package or unexpected content.
 */
function sanitizeSvg(svg: string): string {
  // Remove script tags and event handlers
  return svg
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/\bon\w+\s*=/gi, "data-removed=");
}

/**
 * File type icon component using material-file-icons library.
 * Matches VS Code / Conductor style icons with proper colors and badges.
 */
export function FileTypeIcon({
  filename,
  className,
  size = 16,
  isFolder = false,
  isOpen = false,
}: FileTypeIconProps) {
  const icon = useMemo(() => {
    // Handle folders
    if (isFolder) {
      const FolderComponent = isOpen ? FolderOpenIcon : FolderIcon;
      return (
        <FolderComponent
          className={cn("text-yellow-500/80", className)}
          style={{ width: size, height: size }}
        />
      );
    }

    // Get icon for file
    const iconData = filename ? getIcon(filename) : defaultIcon;

    // Sanitize SVG content for defense-in-depth security
    const sanitizedSvg = sanitizeSvg(iconData.svg);

    return (
      <div
        className={cn("flex-shrink-0", className)}
        style={{ width: size, height: size }}
        dangerouslySetInnerHTML={{ __html: sanitizedSvg }}
      />
    );
  }, [filename, className, size, isFolder, isOpen]);

  return icon;
}
