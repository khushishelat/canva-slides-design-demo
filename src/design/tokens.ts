/**
 * Parallel design tokens — the single source of truth for colors, type
 * sizes, spacing, and font resolution across the app.
 *
 * The pptxgenjs templates live at /Users/khushishelat/Downloads/parallel-deck-templates/scripts/.
 * Tokens here mirror the `C` and font constants used there, so layout
 * builders are 1:1 ports.
 */

import { findFonts, type FontRef } from "@canva/asset";

// ===== Colors =====

export const COLORS = {
  offWhite: "#F9F8F4",
  white: "#FFFFFF",
  black: "#1D1B16",
  neural: "#D8D0BF",

  brand: "#FB631B",
  brandHover: "#F4793F",
  orangeTint: "#F79A6F",
  orangeLight: "#F9BC9F",
  orangeWash: "#FCDDCF",

  grey100: "#F6F6F6",
  grey200: "#EEEEEE",
  grey300: "#E5E5E5",
  grey400: "#D6D6D6",
  grey500: "#ADADAC",
  grey600: "#858483",
  grey700: "#5C5B59",
  grey800: "#434343",
  grey900: "#181818",
} as const;

// ===== Slide dimensions =====
// pptxgenjs templates use LAYOUT_WIDE: 13.3" × 7.5". At ~144.36 px/in this
// is 1920 × 1083 — close enough to standard 16:9 1920×1080.

export const DEFAULT_DIMS = { width: 1920, height: 1080 } as const;

// Conversion factor for porting pptxgenjs inch coordinates to Canva pixels.
// 13.3 inches → 1920 px ≈ 144.36 px/inch.
export const PX_PER_INCH = 1920 / 13.3;
export const inches = (n: number): number => Math.round(n * PX_PER_INCH);

// ===== Type scale (px at 1920 wide) =====
// pptxgenjs uses points (10pt body, 26pt section title, 44pt big number).
// At our 1920×1080 canvas, ~2× those point values gives the right visual
// weight. Earlier sizes were ~half this scale and read as too small.
// Capped at 100 (the SDK ceiling).

export const TYPE = {
  hero: 100, // big number callout (Canva SDK max)
  display: 88, // cover hero title (pptx 44pt × 2)
  title: 60, // pptx 30pt × 2
  sectionTitle: 48, // pptx 24pt × 2
  bodyLarge: 32, // pptx 16pt × 2
  body: 26, // pptx 13pt × 2
  caption: 22, // pptx 11pt × 2
  small: 18, // pptx 9pt × 2
  micro: 14, // mono kicker / footer (pptx 7pt × 2)
} as const;

// ===== Layout grid =====
// pptxgenjs templates use 0.4" gutter on left/right. At 144.36 px/in that's ~58 px.
export const GUTTER = inches(0.4); // ~58
export const FOOTER_GUTTER = inches(6.85); // y-coord where footer divider sits in pptxgenjs
export const HEADER_GUTTER = inches(0.6); // y-coord where header divider sits

// ===== Font resolution =====
// pptxgenjs templates use:
//   SANS = "Helvetica Neue" (Gerstner Programm fallback)
//   MONO = "Courier New"    (FT System Mono fallback)
// We try those first via Canva's findFonts, then fall back to broader candidates.

type ResolvedFonts = { sans?: FontRef; mono?: FontRef };

let cachedFonts: ResolvedFonts | null = null;

const SANS_CANDIDATES = [
  "Helvetica Neue",
  "Helvetica",
  "Inter",
  "Arial",
  "Roboto",
  "Open Sans",
];

const MONO_CANDIDATES = [
  "Courier New",
  "Courier",
  "JetBrains Mono",
  "IBM Plex Mono",
  "Roboto Mono",
  "Fira Code",
];

export async function resolveFonts(): Promise<ResolvedFonts> {
  if (cachedFonts) return cachedFonts;
  try {
    const res = await findFonts();
    const all = res.fonts || [];
    const byName = new Map<string, FontRef>();
    for (const f of all) {
      if (f.name && f.ref) byName.set(f.name.toLowerCase(), f.ref);
    }
    const pick = (candidates: string[]): FontRef | undefined => {
      for (const c of candidates) {
        const ref = byName.get(c.toLowerCase());
        if (ref) return ref;
      }
      // Substring match fallback
      for (const c of candidates) {
        const lower = c.toLowerCase();
        for (const [name, ref] of byName.entries()) {
          if (name.includes(lower)) return ref;
        }
      }
      return undefined;
    };
    cachedFonts = { sans: pick(SANS_CANDIDATES), mono: pick(MONO_CANDIDATES) };
  } catch {
    cachedFonts = {};
  }
  return cachedFonts;
}

export function clearFontCache(): void {
  cachedFonts = null;
}
