/**
 * "Deeper findings" — table variant. Renders a markdown table that the
 * pro-fast research pass surfaced (typically a 4-5 column comparison of
 * niche players or counterintuitive metrics).
 *
 * Layout:
 *   - Header band ("DEEPER FINDINGS · PRO-FAST")
 *   - Title (the H2 the model emitted)
 *   - Table grid (rendered as shape+richtext cells since Canva's
 *     TableElement isn't accepted by addPage's element list)
 *   - 1-3 short paragraphs of analysis below the table
 *   - Footer band
 *
 * The table is built from primitives (rect for header bg + dividers,
 * richtext for cell content). Bold runs in cell content come from
 * markdown `**...**` markers the model emits.
 */
import type { ElementAtPoint } from "@canva/design";
import type { FontRef } from "@canva/asset";
import { COLORS, GUTTER, TYPE, inches } from "src/design/tokens";
import { cleanLine, cleanProse, footerBand, headerBand, richtextWithBold } from "./_shared";
import type { DeeperFindingsTableContent, Dims, PageSpec } from "./types";
import { hline, rect } from "./types";

// Strip the trailing `[N]` numeric citation markers Parallel inlines —
// they reference the basis array but read as noise on the slide.
function stripCiteRefs(s: string): string {
  return s
    .replace(/\s*\[\d+\](\s*\[\d+\])*/g, "")
    .replace(/\s+([,.;:!?])/g, "$1")
    .trim();
}

export function deeperFindingsTablePage(
  content: DeeperFindingsTableContent,
  dims: Dims,
  fonts: { sans?: FontRef; mono?: FontRef } = {},
): PageSpec {
  const elements: ElementAtPoint[] = [];

  elements.push(
    ...headerBand(
      { kicker: "DEEPER FINDINGS  ·  PRO-FAST" },
      dims,
      fonts,
    ),
  );

  // ---------- Title + divider ----------
  elements.push({
    type: "text",
    children: [cleanLine(content.title)],
    top: inches(0.78),
    left: GUTTER,
    width: dims.width - 2 * GUTTER,
    fontSize: TYPE.sectionTitle,
    color: COLORS.black,
    fontWeight: "medium",
    fontRef: fonts.sans,
  });
  elements.push(hline(inches(1.65), GUTTER, dims.width - 2 * GUTTER));

  // ---------- Table geometry ----------
  // Cap rows/cols so it fits on the slide. The pro-fast prompt asks for
  // 4-5 cols and 4-5 rows; truncate harder if the model returns more.
  const MAX_ROWS = 5;
  const MAX_COLS = 5;
  const rows = content.rows.slice(0, MAX_ROWS);
  const columns = content.columns.slice(0, MAX_COLS);
  const colCount = columns.length;

  const tableX = GUTTER;
  const tableW = dims.width - 2 * GUTTER;
  const tableY = inches(1.95);
  const headerRowH = inches(0.5);
  // Each data row gets ~0.65" so the body block below has room.
  const dataRowH = inches(0.65);
  const tableH = headerRowH + rows.length * dataRowH;

  // Equal-width columns. (The first column tends to be a name/label;
  // we could give it 1.4× weight, but a uniform grid reads cleaner
  // and avoids per-topic guessing.)
  const colW = colCount > 0 ? tableW / colCount : tableW;
  const cellPadX = inches(0.12);
  const cellPadY = inches(0.1);

  // Header row background (light orange wash for visual anchor)
  elements.push(rect(tableY, tableX, tableW, headerRowH, COLORS.orangeWash));

  // Header cells
  columns.forEach((col, i) => {
    const x = tableX + i * colW;
    elements.push({
      type: "text",
      children: [cleanLine(stripCiteRefs(col)).toUpperCase()],
      top: tableY + cellPadY,
      left: x + cellPadX,
      width: colW - 2 * cellPadX,
      fontSize: TYPE.small,
      color: COLORS.grey700,
      fontWeight: "medium",
      fontRef: fonts.mono,
    });
  });

  // Horizontal divider below header
  elements.push(
    hline(tableY + headerRowH, tableX, tableW, COLORS.grey400),
  );

  // Data rows
  rows.forEach((row, ri) => {
    const rowY = tableY + headerRowH + ri * dataRowH;
    // Subtle row divider between rows (skip after last row to avoid
    // doubling with the table border underneath)
    if (ri < rows.length - 1) {
      elements.push(
        hline(rowY + dataRowH, tableX, tableW, COLORS.grey200),
      );
    }
    row.forEach((cell, ci) => {
      if (ci >= colCount) return;
      const x = tableX + ci * colW;
      const cleaned = stripCiteRefs(cell);
      // Column 0 gets bold-by-default treatment (it's usually the name).
      // Other columns use richtextWithBold so any **...** runs render.
      elements.push({
        type: "richtext",
        range: richtextWithBold({
          text: ci === 0 && !cleaned.includes("**") ? `**${cleaned}**` : cleaned,
          fontSize: TYPE.caption,
          color: COLORS.black,
          fontRef: fonts.sans,
        }),
        top: rowY + cellPadY,
        left: x + cellPadX,
        width: colW - 2 * cellPadX,
      });
    });
  });

  // Bottom border under the whole table
  elements.push(
    hline(tableY + tableH, tableX, tableW, COLORS.grey400),
  );

  // ---------- Body paragraphs (below table) ----------
  const bodyY = tableY + tableH + inches(0.3);
  const bodyEndY = inches(6.55);
  const bodyH = bodyEndY - bodyY;
  if (bodyH > inches(0.4) && content.body) {
    elements.push({
      type: "richtext",
      range: richtextWithBold({
        text: cleanProse(content.body),
        fontSize: TYPE.caption,
        color: COLORS.grey700,
        fontRef: fonts.sans,
      }),
      top: bodyY,
      left: GUTTER,
      width: dims.width - 2 * GUTTER,
    });
  }

  elements.push(
    ...footerBand(
      {
        source: "PARALLEL  ·  PRO-FAST  ·  DEEPER FINDINGS",
        pageNumber: "98",
      },
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
