/**
 * Pull-quote slide — port of build_quote_slide.js.
 *
 * Layout:
 *   - Header band
 *   - Eyebrow ("1.3 / Voice of the field") below header
 *   - HUGE signal-orange opening quotation mark (left side, the slide's
 *     one big visual moment)
 *   - Quote text indented past the mark, large sans
 *   - Thin grey divider below quote
 *   - Vertical orange BRACKET (the Parallel signature motif) at the
 *     attribution, with name (bold) / title (grey) / organization (grey)
 *     stacked vertically beside it
 *   - Footer
 */
import type { ElementAtPoint } from "@canva/design";
import type { FontRef } from "@canva/asset";
import { COLORS, GUTTER, TYPE, inches } from "src/design/tokens";
import { cleanLine, cleanProse, footerBand, headerBand } from "./_shared";
import type { Dims, PageSpec, QuoteContent } from "./types";
import { hline, rect } from "./types";

/**
 * Auto-fit the quote font size so the text wraps to ≤ 5 lines in the
 * given width. Caps at 36 (smaller than the source's 28pt × 2 = 56 to
 * keep room for attribution beneath); falls down to 18 for very long
 * quotes.
 */
function fitQuoteFontSize(text: string, maxWidth: number): number {
  const maxLines = 5;
  let size = 44;
  while (size > 20) {
    const charsPerLine = Math.max(1, Math.floor(maxWidth / (size * 0.55)));
    const lines = Math.ceil(text.length / charsPerLine);
    if (lines <= maxLines) return size;
    size -= 2;
  }
  return size;
}

export function quotePage(
  content: QuoteContent,
  dims: Dims,
  fonts: { sans?: FontRef; mono?: FontRef } = {},
): PageSpec {
  const elements: ElementAtPoint[] = [];

  elements.push(...headerBand({ kicker: "03 / VOICE OF THE FIELD" }, dims, fonts));

  // Eyebrow
  elements.push({
    type: "text",
    children: ["1.3 / Voice of the field"],
    top: inches(0.78),
    left: GUTTER,
    width: dims.width - 2 * GUTTER,
    fontSize: TYPE.body,
    color: COLORS.grey700,
    fontRef: fonts.sans,
  });

  // ---------- Hero quote mark + body ----------
  // The opening quote is the slide's only big visual element. Source uses
  // fontSize 260 (Canva caps at 100) so we render at the cap.
  elements.push({
    type: "text",
    children: ["“"],
    top: inches(1.1),
    left: inches(0.3),
    width: inches(2.5),
    fontSize: 100,
    color: COLORS.brand,
    fontWeight: "medium",
    fontRef: fonts.sans,
  });

  // Quote text — auto-fit, indented past the giant quote mark
  const cleaned = cleanProse(content.text);
  const quoteX = inches(2.3);
  const quoteWidth = dims.width - quoteX - GUTTER;
  const quoteFontSize = fitQuoteFontSize(cleaned, quoteWidth);
  elements.push({
    type: "text",
    children: [cleaned],
    top: inches(1.95),
    left: quoteX,
    width: quoteWidth,
    fontSize: quoteFontSize,
    color: COLORS.black,
    fontRef: fonts.sans,
  });

  // ---------- Divider between quote and attribution ----------
  elements.push(hline(inches(5.65), GUTTER, dims.width - 2 * GUTTER));

  // ---------- Attribution: orange bracket + stacked name/title/org ----------
  // Vertical orange accent bar — the Parallel bracket motif
  const bracketLeft = GUTTER;
  const bracketTop = inches(5.9);
  const bracketHeight = inches(0.9);
  elements.push(rect(bracketTop, bracketLeft, 6, bracketHeight, COLORS.brand));

  // Name (bold, larger)
  elements.push({
    type: "text",
    children: [cleanLine(content.name)],
    top: inches(5.85),
    left: GUTTER + inches(0.2),
    width: inches(8),
    fontSize: TYPE.bodyLarge,
    color: COLORS.black,
    fontWeight: "medium",
    fontRef: fonts.sans,
  });

  // Title (smaller, grey)
  if (content.title) {
    elements.push({
      type: "text",
      children: [cleanLine(content.title)],
      top: inches(6.3),
      left: GUTTER + inches(0.2),
      width: inches(8),
      fontSize: TYPE.caption,
      color: COLORS.grey700,
      fontRef: fonts.sans,
    });
  }

  // Organization (smaller, grey)
  elements.push({
    type: "text",
    children: [cleanLine(content.organization)],
    top: inches(6.6),
    left: GUTTER + inches(0.2),
    width: inches(8),
    fontSize: TYPE.caption,
    color: COLORS.grey700,
    fontRef: fonts.sans,
  });

  elements.push(
    ...footerBand({ source: "VERBATIM CITED QUOTE", pageNumber: "07" }, dims, fonts),
  );

  return {
    title: content.name,
    background: { color: COLORS.offWhite },
    elements,
    dimensions: dims,
  };
}
