/**
 * Gamma-style professional color palettes for document generation
 * These palettes are designed to create stunning, modern presentations
 */

import { randomInt } from "node:crypto";

export interface ColorPalette {
  name: string;
  description: string;
  background: string;
  surface: string;
  surfaceAlt: string;
  primary: string;
  primaryDark: string;
  accent: string;
  text: string;
  textMuted: string;
  textInverse: string;
  gradient: {
    start: string;
    end: string;
    angle?: number;
  };
  chart: {
    colors: string[];
  };
}

export const COLOR_PALETTES: Record<string, ColorPalette> = {
  "gamma-dark": {
    name: "Gamma Dark",
    description:
      "Modern dark theme with vibrant purple accents - the signature Gamma look",
    background: "0f0f0f",
    surface: "1a1a1a",
    surfaceAlt: "262626",
    primary: "6366f1",
    primaryDark: "4f46e5",
    accent: "818cf8",
    text: "ffffff",
    textMuted: "a1a1aa",
    textInverse: "0f0f0f",
    gradient: { start: "6366f1", end: "a855f7", angle: 135 },
    chart: {
      colors: ["6366f1", "a855f7", "ec4899", "14b8a6", "f59e0b", "10b981"],
    },
  },

  "gamma-light": {
    name: "Gamma Light",
    description: "Clean light theme with professional purple accents",
    background: "ffffff",
    surface: "f4f4f5",
    surfaceAlt: "e4e4e7",
    primary: "4f46e5",
    primaryDark: "4338ca",
    accent: "6366f1",
    text: "18181b",
    textMuted: "71717a",
    textInverse: "ffffff",
    gradient: { start: "4f46e5", end: "7c3aed", angle: 135 },
    chart: {
      colors: ["4f46e5", "7c3aed", "db2777", "0d9488", "d97706", "059669"],
    },
  },

  "vibrant-purple": {
    name: "Vibrant Purple",
    description: "Bold, energetic purple theme for impactful presentations",
    background: "1e1b4b",
    surface: "312e81",
    surfaceAlt: "3730a3",
    primary: "a78bfa",
    primaryDark: "8b5cf6",
    accent: "c4b5fd",
    text: "ffffff",
    textMuted: "c4b5fd",
    textInverse: "1e1b4b",
    gradient: { start: "7c3aed", end: "db2777", angle: 135 },
    chart: {
      colors: ["a78bfa", "f472b6", "38bdf8", "4ade80", "fbbf24", "fb7185"],
    },
  },

  "corporate-blue": {
    name: "Corporate Blue",
    description: "Professional blue theme for business presentations",
    background: "0c4a6e",
    surface: "075985",
    surfaceAlt: "0369a1",
    primary: "38bdf8",
    primaryDark: "0ea5e9",
    accent: "7dd3fc",
    text: "ffffff",
    textMuted: "bae6fd",
    textInverse: "0c4a6e",
    gradient: { start: "0284c7", end: "0891b2", angle: 135 },
    chart: {
      colors: ["38bdf8", "22d3ee", "34d399", "a78bfa", "fb923c", "f87171"],
    },
  },

  "midnight-blue": {
    name: "Midnight Blue",
    description: "Deep, sophisticated blue for executive presentations",
    background: "0f172a",
    surface: "1e293b",
    surfaceAlt: "334155",
    primary: "3b82f6",
    primaryDark: "2563eb",
    accent: "60a5fa",
    text: "f8fafc",
    textMuted: "94a3b8",
    textInverse: "0f172a",
    gradient: { start: "2563eb", end: "7c3aed", angle: 135 },
    chart: {
      colors: ["3b82f6", "8b5cf6", "ec4899", "06b6d4", "10b981", "f59e0b"],
    },
  },

  "forest-green": {
    name: "Forest Green",
    description: "Natural, calming green theme for sustainability topics",
    background: "14532d",
    surface: "166534",
    surfaceAlt: "15803d",
    primary: "4ade80",
    primaryDark: "22c55e",
    accent: "86efac",
    text: "ffffff",
    textMuted: "bbf7d0",
    textInverse: "14532d",
    gradient: { start: "22c55e", end: "14b8a6", angle: 135 },
    chart: {
      colors: ["4ade80", "2dd4bf", "38bdf8", "a78bfa", "fbbf24", "f472b6"],
    },
  },

  "sunset-orange": {
    name: "Sunset Orange",
    description: "Warm, energetic orange theme for creative presentations",
    background: "7c2d12",
    surface: "9a3412",
    surfaceAlt: "c2410c",
    primary: "fb923c",
    primaryDark: "f97316",
    accent: "fdba74",
    text: "ffffff",
    textMuted: "fed7aa",
    textInverse: "7c2d12",
    gradient: { start: "f97316", end: "ef4444", angle: 135 },
    chart: {
      colors: ["fb923c", "f87171", "fbbf24", "a78bfa", "34d399", "38bdf8"],
    },
  },

  "minimal-white": {
    name: "Minimal White",
    description: "Ultra-clean white theme with subtle gray accents",
    background: "ffffff",
    surface: "fafafa",
    surfaceAlt: "f5f5f5",
    primary: "171717",
    primaryDark: "0a0a0a",
    accent: "525252",
    text: "171717",
    textMuted: "737373",
    textInverse: "ffffff",
    gradient: { start: "525252", end: "171717", angle: 135 },
    chart: {
      colors: ["171717", "525252", "737373", "a3a3a3", "d4d4d4", "e5e5e5"],
    },
  },

  "minimal-dark": {
    name: "Minimal Dark",
    description: "Sleek dark theme with minimal color - maximum contrast",
    background: "000000",
    surface: "0a0a0a",
    surfaceAlt: "171717",
    primary: "ffffff",
    primaryDark: "fafafa",
    accent: "a3a3a3",
    text: "ffffff",
    textMuted: "a3a3a3",
    textInverse: "000000",
    gradient: { start: "525252", end: "262626", angle: 135 },
    chart: {
      colors: ["ffffff", "e5e5e5", "d4d4d4", "a3a3a3", "737373", "525252"],
    },
  },

  "rose-pink": {
    name: "Rose Pink",
    description: "Elegant pink theme for creative and lifestyle content",
    background: "831843",
    surface: "9d174d",
    surfaceAlt: "be185d",
    primary: "f472b6",
    primaryDark: "ec4899",
    accent: "f9a8d4",
    text: "ffffff",
    textMuted: "fbcfe8",
    textInverse: "831843",
    gradient: { start: "ec4899", end: "f43f5e", angle: 135 },
    chart: {
      colors: ["f472b6", "fb7185", "c084fc", "38bdf8", "4ade80", "fbbf24"],
    },
  },

  "ocean-teal": {
    name: "Ocean Teal",
    description: "Fresh, aquatic theme for health and technology topics",
    background: "134e4a",
    surface: "115e59",
    surfaceAlt: "0f766e",
    primary: "2dd4bf",
    primaryDark: "14b8a6",
    accent: "5eead4",
    text: "ffffff",
    textMuted: "99f6e4",
    textInverse: "134e4a",
    gradient: { start: "14b8a6", end: "06b6d4", angle: 135 },
    chart: {
      colors: ["2dd4bf", "22d3ee", "38bdf8", "a78bfa", "f472b6", "fbbf24"],
    },
  },

  "slate-professional": {
    name: "Slate Professional",
    description: "Sophisticated slate gray for corporate and finance",
    background: "1e293b",
    surface: "334155",
    surfaceAlt: "475569",
    primary: "cbd5e1",
    primaryDark: "94a3b8",
    accent: "e2e8f0",
    text: "f1f5f9",
    textMuted: "94a3b8",
    textInverse: "1e293b",
    gradient: { start: "475569", end: "1e293b", angle: 135 },
    chart: {
      colors: ["60a5fa", "818cf8", "f472b6", "4ade80", "fbbf24", "fb7185"],
    },
  },
};

// Default palette
export const DEFAULT_PALETTE = "gamma-dark";

// Get a palette by name with fallback
export function getPalette(name: string): ColorPalette {
  return COLOR_PALETTES[name] || COLOR_PALETTES[DEFAULT_PALETTE];
}

// Get all palette names
export function getPaletteNames(): string[] {
  return Object.keys(COLOR_PALETTES);
}

// Get palette for light vs dark mode preference
export function getPalettesByMode(mode: "light" | "dark"): string[] {
  const lightPalettes = ["gamma-light", "minimal-white"];
  const darkPalettes = Object.keys(COLOR_PALETTES).filter(
    (name) => !lightPalettes.includes(name),
  );
  return mode === "light" ? lightPalettes : darkPalettes;
}

// ============================================
// Dynamic Color Palette Generation
// ============================================

/**
 * Convert hex color to HSL
 */
function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const cleanHex = hex.replaceAll("#", "");
  const r = Number.parseInt(cleanHex.slice(0, 2), 16) / 255;
  const g = Number.parseInt(cleanHex.slice(2, 4), 16) / 255;
  const b = Number.parseInt(cleanHex.slice(4, 6), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

    switch (max) {
      case r:
        h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        break;
      case g:
        h = ((b - r) / d + 2) / 6;
        break;
      case b:
        h = ((r - g) / d + 4) / 6;
        break;
    }
  }

  return { h: h * 360, s: s * 100, l: l * 100 };
}

/**
 * Convert HSL to hex color
 */
function hslToHex(h: number, s: number, l: number): string {
  h = h / 360;
  s = s / 100;
  l = l / 100;

  let r: number, g: number, b: number;

  if (s === 0) {
    r = g = b = l;
  } else {
    const hue2rgb = (p: number, q: number, t: number): number => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };

    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }

  const toHex = (x: number): string => {
    const hex = Math.round(x * 255).toString(16);
    return hex.length === 1 ? "0" + hex : hex;
  };

  return `${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/**
 * Generate a harmonious color palette from a single primary color
 */
export function generatePaletteFromColor(
  primaryHex: string,
  mode: "light" | "dark" = "light",
  name?: string,
): ColorPalette {
  const primary = hexToHsl(primaryHex);

  // Generate harmonious colors
  const accent = {
    h: (primary.h + 30) % 360, // Analogous color
    s: primary.s,
    l: primary.l,
  };

  // Generate chart colors (split-complementary + triadic)
  const chartColors = [
    hslToHex(primary.h, primary.s, primary.l),
    hslToHex((primary.h + 150) % 360, primary.s * 0.9, primary.l),
    hslToHex((primary.h + 210) % 360, primary.s * 0.9, primary.l),
    hslToHex((primary.h + 60) % 360, primary.s * 0.85, primary.l),
    hslToHex((primary.h + 300) % 360, primary.s * 0.85, primary.l),
    hslToHex((primary.h + 120) % 360, primary.s * 0.8, primary.l),
  ];

  if (mode === "dark") {
    return {
      name: name || `Custom Dark (${primaryHex})`,
      description: `Dark theme generated from ${primaryHex}`,
      background: "0f0f0f",
      surface: "1a1a1a",
      surfaceAlt: "262626",
      primary: hslToHex(primary.h, primary.s, Math.min(primary.l + 10, 70)),
      primaryDark: hslToHex(primary.h, primary.s + 5, primary.l),
      accent: hslToHex(accent.h, accent.s, Math.min(accent.l + 10, 75)),
      text: "ffffff",
      textMuted: "a1a1aa",
      textInverse: "0f0f0f",
      gradient: {
        start: hslToHex(primary.h, primary.s, primary.l),
        end: hslToHex(accent.h, accent.s, accent.l),
        angle: 135,
      },
      chart: { colors: chartColors },
    };
  }

  // Light mode
  return {
    name: name || `Custom Light (${primaryHex})`,
    description: `Light theme generated from ${primaryHex}`,
    background: "ffffff",
    surface: "f4f4f5",
    surfaceAlt: "e4e4e7",
    primary: hslToHex(primary.h, primary.s, Math.max(primary.l - 10, 30)),
    primaryDark: hslToHex(
      primary.h,
      primary.s + 5,
      Math.max(primary.l - 15, 25),
    ),
    accent: hslToHex(accent.h, accent.s, Math.max(accent.l - 5, 35)),
    text: "18181b",
    textMuted: "71717a",
    textInverse: "ffffff",
    gradient: {
      start: hslToHex(primary.h, primary.s, primary.l),
      end: hslToHex(accent.h, accent.s, accent.l),
      angle: 135,
    },
    chart: { colors: chartColors },
  };
}

/**
 * Generate a palette based on mood/industry
 */
export type MoodPreset =
  | "professional"
  | "creative"
  | "tech"
  | "finance"
  | "healthcare"
  | "education"
  | "nature"
  | "luxury"
  | "playful"
  | "minimalist";

const MOOD_COLORS: Record<MoodPreset, { primary: string; accent: string }> = {
  professional: { primary: "1e40af", accent: "3b82f6" }, // Blue
  creative: { primary: "7c3aed", accent: "a855f7" }, // Purple
  tech: { primary: "0891b2", accent: "06b6d4" }, // Cyan
  finance: { primary: "047857", accent: "10b981" }, // Green
  healthcare: { primary: "0369a1", accent: "0ea5e9" }, // Sky blue
  education: { primary: "7c2d12", accent: "ea580c" }, // Orange
  nature: { primary: "15803d", accent: "22c55e" }, // Green
  luxury: { primary: "78350f", accent: "b45309" }, // Amber/Gold
  playful: { primary: "be185d", accent: "ec4899" }, // Pink
  minimalist: { primary: "404040", accent: "737373" }, // Gray
};

export function generatePaletteFromMood(
  mood: MoodPreset,
  mode: "light" | "dark" = "light",
): ColorPalette {
  const colors = MOOD_COLORS[mood];
  const palette = generatePaletteFromColor(
    colors.primary,
    mode,
    `${mood}-${mode}`,
  );
  return {
    ...palette,
    name: `${mood.charAt(0).toUpperCase() + mood.slice(1)} ${mode === "dark" ? "Dark" : "Light"}`,
    description: `${mood.charAt(0).toUpperCase() + mood.slice(1)}-style ${mode} theme`,
  };
}

/**
 * Adjust palette for better accessibility
 */
export function adjustPaletteForAccessibility(
  palette: ColorPalette,
): ColorPalette {
  const textHsl = hexToHsl(palette.text);
  const bgHsl = hexToHsl(palette.background);

  // Calculate if text needs adjustment for contrast
  const textLuminance = textHsl.l;
  const bgLuminance = bgHsl.l;
  const contrast = Math.abs(textLuminance - bgLuminance);

  let adjustedText = palette.text;
  let adjustedTextMuted = palette.textMuted;

  // If contrast is too low, adjust text color
  if (contrast < 50) {
    if (bgLuminance > 50) {
      // Light background, make text darker
      adjustedText = hslToHex(
        textHsl.h,
        textHsl.s,
        Math.max(textHsl.l - 30, 10),
      );
      const mutedHsl = hexToHsl(palette.textMuted);
      adjustedTextMuted = hslToHex(
        mutedHsl.h,
        mutedHsl.s,
        Math.max(mutedHsl.l - 20, 25),
      );
    } else {
      // Dark background, make text lighter
      adjustedText = hslToHex(
        textHsl.h,
        textHsl.s,
        Math.min(textHsl.l + 30, 95),
      );
      const mutedHsl = hexToHsl(palette.textMuted);
      adjustedTextMuted = hslToHex(
        mutedHsl.h,
        mutedHsl.s,
        Math.min(mutedHsl.l + 20, 80),
      );
    }
  }

  return {
    ...palette,
    text: adjustedText,
    textMuted: adjustedTextMuted,
    name: palette.name + " (Accessible)",
    description: palette.description + " - Adjusted for WCAG accessibility",
  };
}

/**
 * Get a random palette from the available palettes
 * Uses cryptographically secure random number generation
 */
export function getRandomPalette(): ColorPalette {
  const names = getPaletteNames();
  // Use crypto.randomInt for cryptographically secure randomness
  const randomIndex = randomInt(0, names.length);
  return COLOR_PALETTES[names[randomIndex]];
}

/**
 * Suggest palette based on keywords
 */
export function suggestPalette(keywords: string[]): string {
  const keywordMapping: Record<string, string[]> = {
    professional: ["business", "corporate", "formal", "enterprise"],
    creative: ["art", "design", "creative", "innovative"],
    tech: ["technology", "software", "digital", "modern"],
    finance: ["finance", "banking", "money", "investment"],
    healthcare: ["health", "medical", "wellness", "hospital"],
    education: ["school", "learning", "education", "academic"],
    nature: ["green", "eco", "environment", "sustainable"],
    luxury: ["premium", "luxury", "exclusive", "elegant"],
    playful: ["fun", "colorful", "vibrant", "energetic"],
    dark: ["dark", "night", "dramatic", "bold"],
    light: ["light", "clean", "minimal", "simple"],
  };

  const lowerKeywords = keywords.map((k) => k.toLowerCase());

  for (const [mood, moodKeywords] of Object.entries(keywordMapping)) {
    if (lowerKeywords.some((k) => moodKeywords.includes(k))) {
      // Find matching palette
      if (mood === "dark") return "gamma-dark";
      if (mood === "light") return "gamma-light";

      // Try to find a matching preset
      const matchingPalettes = getPaletteNames().filter((name) =>
        name.toLowerCase().includes(mood),
      );
      if (matchingPalettes.length > 0) {
        return matchingPalettes[0];
      }
    }
  }

  // Default to gamma-light for most cases
  return "gamma-light";
}
