/**
 * Shared layout primitives used across most slides:
 *   - Header band: kicker (top-left) + "PARALLEL · HUMAN MODE" (top-right) + thin divider
 *   - Footer band: source line + page number + thin divider
 * The pptxgenjs templates use these on 8 of 9 slides (divider is the
 * exception — it's an inverse dark-mode layout).
 *
 * Plus a `cleanProse()` helper for stripping the LLM's idiosyncratic
 * citation markers (e.g. 【3†L1-L3】) from any text field before render.
 * Real citations live in the slide's `basis` array — these inline
 * markers are noise.
 */
import type { ElementAtPoint } from "@canva/design";
import { createRichtextRange } from "@canva/design";
import type { FontRef } from "@canva/asset";
import { COLORS, GUTTER, TYPE, inches } from "src/design/tokens";
import { hline } from "./types";

/**
 * Build a richtext range with inline bold runs from a string containing
 * `**double-asterisk**` markup. Keeps the rest of the prose clean (citation
 * markers stripped, whitespace tidied). Use for prose-heavy slide fields
 * where editorial bold-emphasis is part of the design (the brief slide).
 *
 * Returns the range — the caller wraps it in a richtext element with
 * top/left/width.
 */

export function richtextWithBold(args: {
  text: string;
  fontSize: number;
  color: string;
  fontRef?: FontRef;
}) {
  const cleaned = stripMarkers(args.text);
  const range = createRichtextRange();
  // Split on **bold** spans, preserving the markers as match groups
  const parts = cleaned.split(/(\*\*[^*]+\*\*)/);
  let cursor = 0;
  const boldSpans: Array<{ index: number; length: number }> = [];
  for (const part of parts) {
    if (!part) continue;
    const m = part.match(/^\*\*(.+)\*\*$/);
    if (m && m[1]) {
      const text = m[1];
      range.appendText(text);
      boldSpans.push({ index: cursor, length: text.length });
      cursor += text.length;
    } else {
      range.appendText(part);
      cursor += part.length;
    }
  }
  // Apply base paragraph styling to whole range first
  if (cursor > 0) {
    range.formatParagraph(
      { index: 0, length: cursor },
      {
        fontSize: args.fontSize,
        color: args.color,
        fontRef: args.fontRef,
      },
    );
    // Then layer bold on the marked spans
    for (const span of boldSpans) {
      range.formatText(span, { fontWeight: "medium" });
    }
  }
  return range;
}

/** Strip citation markers + tidy whitespace, but PRESERVE **bold** markup. */
function stripMarkers(s: string | undefined | null): string {
  if (!s) return "";
  return decodeEscapes(s)
    .replace(/【[^】]*】/g, "")
    .replace(/\[†[^\]]*\]/g, "")
    .replace(/\[\^[^\]]+\]/g, "")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/\(\s*\)/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+\n/g, "\n")
    .trim();
}

/**
 * Convert literal escape sequences the model sometimes emits as raw text
 * (e.g. when it double-escapes JSON) into their real characters. Without
 * this, slides render the literal string "\\n" instead of a line break,
 * and tabs/CRs leak through as visible glyphs.
 *
 * The model normally emits a real newline character via JSON's `\n`, but
 * occasionally double-escapes (`"foo\\nbar"` JSON-parses to literal
 * `foo\nbar`), and we need to recover.
 */
function decodeEscapes(s: string): string {
  return s
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t")
    .replace(/\\r/g, "")
    // After decoding, any literal-backslash-quote remnants are noise
    .replace(/\\"/g, '"');
}

/**
 * Remove citation markers and clean up whitespace artifacts left by them.
 * Parallel's `core` model often emits markers like:
 *   【3†L1-L3】     (full-width brackets, Parallel-style cite refs)
 *   [†L1-L3]       (variant)
 *   [^1] [^abc]    (markdown footnote refs)
 *   [1] [12]       (bare numeric refs that aren't part of legitimate prose)
 * After stripping we collapse the resulting double-spaces and orphaned
 * punctuation so the prose reads cleanly.
 */
export function cleanProse(s: string | undefined | null): string {
  if (!s) return "";
  return decodeEscapes(s)
    .replace(/【[^】]*】/g, "")
    .replace(/\[†[^\]]*\]/g, "")
    .replace(/\[\^[^\]]+\]/g, "")
    // Strip **markdown bold** markers (Canva text doesn't render them as
    // bold; they show up as literal asterisks). Future fix is to use
    // richtext for inline bold; for now strip the markers.
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    // Cleanup: orphaned punctuation, double spaces, leading/trailing ws
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/\(\s*\)/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+\n/g, "\n")
    .trim();
}

/**
 * Stronger version of cleanProse for SINGLE-LINE titles/labels. Same
 * cleanups + collapses any newline (real or literal `\n`) into a space
 * so a wrapped title doesn't render the literal escape, and so a 2-line
 * label that's supposed to be 1 line doesn't break unexpectedly.
 *
 * Use for title fields where the layout assumes a single line.
 */
export function cleanLine(s: string | undefined | null): string {
  if (!s) return "";
  return cleanProse(s)
    .replace(/[\n\r]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * Like cleanLine but PRESERVES newlines (so 2-line labels stay 2 lines).
 * Decodes literal escapes and strips bold markers; keeps real newlines.
 */
export function cleanMultiline(s: string | undefined | null): string {
  if (!s) return "";
  return cleanProse(s);
}

export type HeaderArgs = {
  /** Top-left mono kicker, e.g. "01 / RESEARCH BRIEF" */
  kicker: string;
  /** Top-right mono caption (default: "PARALLEL · HUMAN MODE") */
  rightLabel?: string;
};

export function headerBand(
  args: HeaderArgs,
  dims: { width: number; height: number },
  fonts: { mono?: FontRef } = {},
): ElementAtPoint[] {
  const right = args.rightLabel ?? "PARALLEL  ·  HUMAN MODE";
  return [
    {
      type: "text",
      children: [args.kicker],
      top: inches(0.3),
      left: GUTTER,
      width: inches(7),
      fontSize: TYPE.micro,
      color: COLORS.grey600,
      fontWeight: "medium",
      fontRef: fonts.mono,
    },
    {
      type: "text",
      children: [right],
      top: inches(0.3),
      left: dims.width - GUTTER - inches(5),
      width: inches(5),
      fontSize: TYPE.micro,
      color: COLORS.grey600,
      fontWeight: "medium",
      textAlign: "end",
      fontRef: fonts.mono,
    },
    hline(inches(0.6), GUTTER, dims.width - 2 * GUTTER),
  ];
}

export type FooterArgs = {
  source?: string;
  pageNumber?: string;
};

export function footerBand(
  args: FooterArgs,
  dims: { width: number; height: number },
  fonts: { mono?: FontRef } = {},
): ElementAtPoint[] {
  const elements: ElementAtPoint[] = [
    hline(inches(6.85), GUTTER, dims.width - 2 * GUTTER),
  ];
  if (args.source) {
    elements.push({
      type: "text",
      children: [args.source.toUpperCase()],
      top: inches(6.95),
      left: GUTTER,
      width: dims.width * 0.6,
      fontSize: TYPE.micro,
      color: COLORS.grey600,
      fontWeight: "medium",
      fontRef: fonts.mono,
    });
  }
  if (args.pageNumber) {
    elements.push({
      type: "text",
      children: [`PARALLEL  ·  ${args.pageNumber}`],
      top: inches(6.95),
      left: dims.width - GUTTER - inches(5),
      width: inches(5),
      fontSize: TYPE.micro,
      color: COLORS.grey600,
      fontWeight: "medium",
      textAlign: "end",
      fontRef: fonts.mono,
    });
  }
  return elements;
}
