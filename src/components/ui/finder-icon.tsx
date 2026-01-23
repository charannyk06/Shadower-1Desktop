import { cn } from "lib/utils";

/**
 * Mac Finder icon - the official macOS Finder app icon
 * Features the iconic blue/cyan split face design with smiling face
 */
export function FinderIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("", className)}
      aria-label="Finder"
    >
      {/* Rounded rectangle background clipping */}
      <defs>
        <clipPath id="finderClip">
          <rect x="2" y="2" width="20" height="20" rx="4" ry="4" />
        </clipPath>
      </defs>

      {/* Background - left half (blue) */}
      <rect
        x="2"
        y="2"
        width="10"
        height="20"
        fill="#1B97F3"
        clipPath="url(#finderClip)"
      />
      {/* Background - right half (cyan/teal) */}
      <rect
        x="12"
        y="2"
        width="10"
        height="20"
        fill="#63D7FA"
        clipPath="url(#finderClip)"
      />

      {/* Rounded border overlay to create corner radius effect */}
      <rect
        x="2"
        y="2"
        width="20"
        height="20"
        rx="4"
        ry="4"
        fill="none"
        stroke="none"
      />

      {/* Face divider line - curved line from top to bottom */}
      <path
        d="M13 2C13 2 10 8 10.5 12H13.5L14 22"
        stroke="white"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
        clipPath="url(#finderClip)"
      />

      {/* Left eye */}
      <line
        x1="7"
        y1="8"
        x2="7"
        y2="10"
        stroke="white"
        strokeWidth="1.5"
        strokeLinecap="round"
      />

      {/* Right eye */}
      <line
        x1="17"
        y1="8"
        x2="17"
        y2="10"
        stroke="white"
        strokeWidth="1.5"
        strokeLinecap="round"
      />

      {/* Smile */}
      <path
        d="M6.5 15.5C6.5 15.5 9 18 12 18C15 18 17.5 15.5 17.5 15.5"
        stroke="white"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />

      {/* Bottom nose line */}
      <line
        x1="10.5"
        y1="22"
        x2="16"
        y2="22"
        stroke="white"
        strokeWidth="1.2"
        strokeLinecap="round"
        clipPath="url(#finderClip)"
      />

      {/* Top nose line */}
      <line
        x1="10"
        y1="2"
        x2="15"
        y2="2"
        stroke="white"
        strokeWidth="1.2"
        strokeLinecap="round"
        clipPath="url(#finderClip)"
      />
    </svg>
  );
}
