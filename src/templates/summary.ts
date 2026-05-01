/**
 * Executive summary slide — port of build_summary_slide.js.
 *
 * Layout: 5 numbered rows stacked vertically. Each row:
 *   [BIG MONO ORANGE NUMBER] [HEADLINE (bold)
 *                            description (grey body)]
 * with thin grey dividers between rows.
 *
 * Earlier my layout had headline/desc side-by-side which lost the
 * "scannable list of 5" rhythm. Vertical stacking matches the source.
 */
import type { ElementAtPoint } from "@canva/design";
import type { FontRef } from "@canva/asset";
import { COLORS, GUTTER, TYPE, inches } from "src/design/tokens";
import { cleanLine, cleanProse, footerBand, headerBand } from "./_shared";
import type { Dims, PageSpec, SummaryContent } from "./types";
import { hline } from "./types";

export function summaryPage(
  content: SummaryContent,
  dims: Dims,
  fonts: { sans?: FontRef; mono?: FontRef } = {},
): PageSpec {
  const elements: ElementAtPoint[] = [];

  elements.push(...headerBand({ kicker: "00 / EXECUTIVE SUMMARY" }, dims, fonts));

  // Eyebrow ("1.0 / Executive summary")
  elements.push({
    type: "text",
    children: ["1.0 / Executive summary"],
    top: inches(0.78),
    left: GUTTER,
    width: dims.width - 2 * GUTTER,
    fontSize: TYPE.body,
    color: COLORS.grey700,
    fontRef: fonts.sans,
  });

  // Title
  elements.push({
    type: "text",
    children: [cleanLine(content.title)],
    top: inches(1.1),
    left: GUTTER,
    width: dims.width - 2 * GUTTER,
    fontSize: TYPE.sectionTitle,
    color: COLORS.black,
    fontWeight: "medium",
    fontRef: fonts.sans,
  });

  // Top divider beneath title
  elements.push(hline(inches(2.1), GUTTER, dims.width - 2 * GUTTER));

  // 5 takeaway rows from y=2.25" to y=6.55"
  const takeaways = content.takeaways.slice(0, 5);
  const rowsStartY = inches(2.25);
  const rowsEndY = inches(6.55);
  const rowH = (rowsEndY - rowsStartY) / Math.max(1, takeaways.length);

  // Number column on the left (~1.1" wide)
  const numCellW = inches(1.1);
  const txtX = GUTTER + numCellW + inches(0.2);
  const txtW = dims.width - 2 * GUTTER - numCellW - inches(0.2);

  takeaways.forEach((t, i) => {
    const rowY = rowsStartY + i * rowH;
    // Big mono orange number — 0-padded
    elements.push({
      type: "text",
      children: [String(i + 1).padStart(2, "0")],
      top: rowY + inches(0.08),
      left: GUTTER,
      width: numCellW,
      fontSize: TYPE.title, // ~60px, big enough to be hero next to body text
      color: COLORS.brand,
      fontWeight: "medium",
      fontRef: fonts.mono,
    });
    // Headline (bold, larger) on top
    elements.push({
      type: "text",
      children: [cleanProse(t.headline)],
      top: rowY + inches(0.1),
      left: txtX,
      width: txtW,
      fontSize: TYPE.bodyLarge,
      color: COLORS.black,
      fontWeight: "medium",
      fontRef: fonts.sans,
    });
    // Description (smaller, grey) below headline
    elements.push({
      type: "text",
      children: [cleanProse(t.desc)],
      top: rowY + inches(0.55),
      left: txtX,
      width: txtW,
      fontSize: TYPE.caption,
      color: COLORS.grey700,
      fontRef: fonts.sans,
    });
    // hr divider between rows
    if (i < takeaways.length - 1) {
      elements.push(
        hline(rowY + rowH, GUTTER, dims.width - 2 * GUTTER, COLORS.grey300),
      );
    }
  });

  elements.push(
    ...footerBand(
      { source: "PARALLEL ANALYSIS", pageNumber: "02" },
      dims,
      fonts,
    ),
  );

  return {
    title: content.title,
    background: { color: COLORS.offWhite },
    elements,
    dimensions: dims,
  };
}
