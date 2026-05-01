/**
 * Design introspection — read text + detect dominant color from the
 * user's current Canva page. Used by the facts page to:
 *   1. Auto-suggest a research topic based on what's already on the slide
 *   2. Match the inserted fact card's accent color to the design's brand
 *
 * Both calls fail gracefully if Canva permissions aren't granted or the
 * page is empty — callers fall back to defaults (manual topic entry,
 * Parallel orange accent).
 */
import { editContent } from "@canva/design";
import type { FontRef } from "@canva/design";

export type DesignIntrospection = {
  /** Concatenated plaintext from all richtext on the current page (trimmed, deduped). */
  pageText: string | null;
  /** Most prominent non-grey color from text on the page (hex), or null if none detected. */
  accentColor: string | null;
  /** Heaviest fontRef from richtext (by char_count × fontSize), or null. */
  fontRef: FontRef | null;
};

/**
 * Read every richtext range on the current page and return:
 *   - pageText: a single concatenated string of plaintext for topic
 *     suggestion (capped at ~400 chars; deduped repeated chunks)
 *   - accentColor: the most "weighty" non-greyscale color used across
 *     text, where weight = char_count × fontSize. Excludes pure
 *     black/white and near-neutral greys (where the RGB channels are
 *     all within 25 of each other).
 *
 * Read-only: we never call session.sync() so nothing is written back
 * to the design.
 */
export async function introspectCurrentPage(): Promise<DesignIntrospection> {
  const result: DesignIntrospection = {
    pageText: null,
    accentColor: null,
    fontRef: null,
  };
  // Pass 1: text colors + fontRef from richtext on the current page.
  // (SDK only supports `current_page` for editContent — no design-wide read.)
  try {
    await editContent(
      { contentType: "richtext", target: "current_page" },
      async (session) => {
        const allText: string[] = [];
        const colorWeights = new Map<string, number>();
        const fontWeights = new Map<FontRef, number>();
        for (const range of session.contents) {
          const text = range.readPlaintext();
          if (text) allText.push(text);
          const regions = range.readTextRegions();
          for (const region of regions) {
            const fmt = region.formatting;
            const fontSize = fmt?.fontSize ?? 16;
            const len = region.text.length;
            if (len === 0) continue;
            const weight = len * fontSize;

            const color = fmt?.color;
            if (color && !isNeutral(color)) {
              const key = color.toUpperCase();
              colorWeights.set(key, (colorWeights.get(key) ?? 0) + weight);
            }

            // fontRef is an opaque string ref; we just pick the heaviest one.
            const fontRef = fmt?.fontRef;
            if (fontRef) {
              fontWeights.set(
                fontRef,
                (fontWeights.get(fontRef) ?? 0) + weight,
              );
            }
          }
        }
        if (allText.length > 0) {
          result.pageText = dedupeJoin(allText, 400);
        }
        result.accentColor = pickHeaviest(colorWeights);
        result.fontRef = pickHeaviest(fontWeights);
      },
    );
  } catch {
    // Permission denied, no current page, or other SDK error — fall through.
  }

  // Note: the public Apps SDK only exposes richtext via editContent and
  // does not expose page background fills or shape colors, so a slide
  // made of a single colored shape with no text yields no accent. We
  // surface this in the UI ("switch to a slide with text").
  return result;
}

function pickHeaviest<T>(map: Map<T, number>): T | null {
  let best: T | null = null;
  let bestW = 0;
  for (const [k, w] of map) {
    if (w > bestW) {
      bestW = w;
      best = k;
    }
  }
  return best;
}

// ===== Helpers =====

/**
 * A color is "neutral" if it's pure white, pure black, our brand
 * off-white, our brand Index black, or any grey (R≈G≈B). We skip
 * neutrals when picking an accent because they're the dominant
 * fill/text colors on most slides and don't represent the brand.
 */
function isNeutral(hex: string): boolean {
  const rgb = parseHex(hex);
  if (!rgb) return false;
  const [r, g, b] = rgb;
  // Greyscale check: max channel difference ≤ 25
  const maxC = Math.max(r, g, b);
  const minC = Math.min(r, g, b);
  if (maxC - minC <= 25) return true;
  return false;
}

function parseHex(hex: string): [number, number, number] | null {
  const m = hex.replace("#", "").match(/^([0-9a-f]{6})$/i);
  if (!m || !m[1]) return null;
  const v = parseInt(m[1], 16);
  return [(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
}

/**
 * Concatenate text fragments with " · " separators, dedupe consecutive
 * duplicates, and cap at maxLen chars. Helps produce a clean topic
 * seed from a slide that might have repeated headers, page numbers, etc.
 */
function dedupeJoin(parts: string[], maxLen: number): string {
  const seen = new Set<string>();
  const cleaned: string[] = [];
  for (const raw of parts) {
    const t = raw.trim().replace(/\s+/g, " ");
    if (!t) continue;
    if (t.length < 2) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    cleaned.push(t);
  }
  let out = cleaned.join(" · ");
  if (out.length > maxLen) out = out.slice(0, maxLen - 1) + "…";
  return out;
}
