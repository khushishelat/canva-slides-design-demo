/**
 * Research zoom-in slide.
 *
 * Reframed from the prior "strategy brief" — this slide drills into one
 * specific facet of the deck topic and surfaces it observationally:
 *   - Left: Research findings prose with inline **bold** key phrases
 *   - Middle: Key dimensions of the facet (4 stacked rows)
 *   - Right: Headline metrics (3 stacked rows, full prefix/number/suffix
 *     shape like the callout slide — $, %, x, M, etc., not bare digits)
 *
 * Same backing schema (general_approach / action_areas / commitments)
 * but the prompt and column headers are reframed observational. The
 * commitments now render with prefix + number + suffix concatenated so
 * "$24B" and "3.2x" come through as expected.
 */
import type { ElementAtPoint } from "@canva/design";
import type { FontRef } from "@canva/asset";
import { COLORS, GUTTER, TYPE, inches } from "src/design/tokens";
import { cleanLine, cleanProse, footerBand, headerBand, richtextWithBold } from "./_shared";
import type { BriefContent, Dims, PageSpec } from "./types";
import { hline, rect } from "./types";

/**
 * Defensive truncation — schema caps in the prompt are SOFT (the model can
 * overshoot). The brief layout has fixed-height grid cells; an overlong
 * description visibly overflows into the next row. Clip with an ellipsis
 * if the model exceeded its cap.
 */
function clip(s: string, max: number): string {
  if (!s) return "";
  if (s.length <= max) return s;
  return s.slice(0, max - 1).replace(/\s+\S*$/, "") + "…";
}

export function briefPage(
  content: BriefContent,
  dims: Dims,
  fonts: { sans?: FontRef; mono?: FontRef } = {},
): PageSpec {
  const elements: ElementAtPoint[] = [];

  elements.push(...headerBand({ kicker: "01.2 / RESEARCH BRIEF" }, dims, fonts));

  // Title + divider beneath. Smaller font (32px vs sectionTitle 48px)
  // because real research-brief titles often run 50-70 chars and 48px
  // wrapped to two lines, eating into the divider and content area.
  // 32px stays on one line for ~70 chars at our column width.
  elements.push({
    type: "text",
    children: [cleanLine(content.title)],
    top: inches(0.85),
    left: GUTTER,
    width: dims.width - 2 * GUTTER,
    fontSize: TYPE.bodyLarge,
    color: COLORS.black,
    fontWeight: "medium",
    fontRef: fonts.sans,
  });
  elements.push(hline(inches(1.5), GUTTER, dims.width - 2 * GUTTER));

  // ---------- Column geometry ----------
  const col1X = GUTTER;
  const col1W = inches(4.1);
  const col2X = inches(4.75);
  const col2W = inches(4.2);
  const col3X = inches(9.2);
  const col3W = inches(3.7);
  const colHeaderY = inches(1.7);
  const contentY = inches(2.15);
  // Stop content well above the footer divider at 6.85" so prose can't
  // spill into it. The earlier 6.55 was too close — 4-line wrapped
  // descriptions were intersecting the footer.
  const contentEndY = inches(6.45);
  const contentHeight = contentEndY - contentY;

  // ---------- Right card (white background, orange accent stripe) ----------
  const cardX = col3X - inches(0.15);
  const cardW = col3W + inches(0.3);
  const cardY = inches(1.5);
  const cardH = inches(5.1);
  elements.push(rect(cardY, cardX, cardW, cardH, COLORS.white));
  // 1px outline emulated as 4 thin rects
  elements.push(rect(cardY, cardX, cardW, 1, COLORS.grey300));
  elements.push(rect(cardY + cardH - 1, cardX, cardW, 1, COLORS.grey300));
  elements.push(rect(cardY, cardX, 1, cardH, COLORS.grey300));
  elements.push(rect(cardY, cardX + cardW - 1, 1, cardH, COLORS.grey300));
  // Orange accent bar
  elements.push(
    rect(cardY, cardX, inches(0.5), inches(0.06), COLORS.brand),
  );

  // ---------- Column headers (reframed observational) ----------
  for (const [x, w, label] of [
    [col1X, col1W, "Research findings"],
    [col2X, col2W, "Key dimensions"],
    [col3X, col3W, "Headline metrics"],
  ] as const) {
    elements.push({
      type: "text",
      children: [label],
      top: colHeaderY,
      left: x,
      width: w,
      fontSize: TYPE.body,
      color: COLORS.black,
      fontWeight: "medium",
      fontRef: fonts.sans,
    });
  }

  // ---------- Column 1: research findings prose with inline bold ----------
  // Use richtext so **bold** markers render as actual inline bold runs.
  // This is the readability fix — without it, the prose was a flat wall
  // of text and key entities/numbers got lost in the body.
  elements.push({
    type: "richtext",
    range: richtextWithBold({
      text: clip(content.general_approach, 750),
      fontSize: TYPE.caption,
      color: COLORS.black,
      fontRef: fonts.sans,
    }),
    top: contentY,
    left: col1X,
    width: col1W,
  });

  // ---------- Column 2: key dimensions (stacked rows + hr dividers) ----------
  const actionRows = content.action_areas.slice(0, 4);
  const actionRowH = contentHeight / Math.max(1, actionRows.length);
  const labelW = inches(1.7);
  const descX = col2X + labelW + inches(0.15);
  const descW = col2W - labelW - inches(0.15);
  actionRows.forEach((a, i) => {
    const rowY = contentY + i * actionRowH;
    // Bold label
    elements.push({
      type: "text",
      children: [clip(cleanProse(a.label), 30)],
      top: rowY + inches(0.1),
      left: col2X,
      width: labelW,
      fontSize: TYPE.caption,
      color: COLORS.black,
      fontWeight: "medium",
      fontRef: fonts.sans,
    });
    // Description with inline bold — clipped to keep within row height
    elements.push({
      type: "richtext",
      range: richtextWithBold({
        text: clip(a.desc, 110),
        fontSize: TYPE.caption,
        color: COLORS.black,
        fontRef: fonts.sans,
      }),
      top: rowY + inches(0.1),
      left: descX,
      width: descW,
    });
    // hr divider above the next row
    if (i < actionRows.length - 1) {
      elements.push(hline(rowY + actionRowH, col2X, col2W, COLORS.grey300));
    }
  });

  // ---------- Column 3: headline metrics (callout-style: prefix+number+suffix) ----------
  const metrics = content.commitments.slice(0, 3);
  const metricStartY = contentY + inches(0.1);
  const metricEndY = contentEndY - inches(0.1);
  const metricRowH =
    (metricEndY - metricStartY) / Math.max(1, metrics.length);
  const numberW = inches(1.95);
  const numLabelX = col3X + numberW + inches(0.05);
  const numLabelW = col3W - numberW - inches(0.1);

  metrics.forEach((m, i) => {
    const rowY = metricStartY + i * metricRowH;
    // Big number — concatenate prefix + number + suffix at title-size.
    // (Plain text element can't do per-character size variation; richtext
    // could render prefix/suffix smaller, but the visual impact of one
    // unified large number reads cleaner anyway.)
    const numStr = `${m.prefix || ""}${m.number}${m.suffix || ""}`;
    elements.push({
      type: "text",
      children: [numStr],
      top: rowY + metricRowH * 0.18,
      left: col3X,
      width: numberW,
      fontSize: TYPE.title,
      color: COLORS.black,
      fontWeight: "medium",
      fontRef: fonts.sans,
    });
    // Descriptor label (cites the source)
    elements.push({
      type: "text",
      children: [clip(cleanLine(m.label), 90)],
      top: rowY + metricRowH * 0.3,
      left: numLabelX,
      width: numLabelW,
      fontSize: TYPE.caption,
      color: COLORS.grey700,
      fontRef: fonts.sans,
    });
    // Subtle hr between rows
    if (i < metrics.length - 1) {
      elements.push(
        hline(rowY + metricRowH, col3X, col3W - inches(0.1), COLORS.grey200),
      );
    }
  });

  elements.push(
    ...footerBand(
      {
        source: "PARALLEL ANALYSIS  ·  PRESS RELEASES  ·  PUBLIC FILINGS",
        pageNumber: "04",
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
