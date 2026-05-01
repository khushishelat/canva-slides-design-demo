/**
 * 2x2 matrix slide — port of build_matrix_slide.js.
 *
 * Layout:
 *   - Header band + eyebrow + title + thin divider
 *   - Plot area with subtle grey-300 outline + dashed grey-400 mid-lines
 *   - Quadrant labels in mono small caps (top-right is signal ORANGE — the
 *     "winner" quadrant emphasis)
 *   - Y-axis: HIGH/LOW markers above and below the plot's left edge,
 *     "↑ AXIS LABEL" caption above
 *   - X-axis: LOW/HIGH markers at corners below the plot,
 *     "AXIS LABEL →" centered caption below
 *   - Items: signal-orange dots with sans-bold labels, with vertical
 *     stagger when labels would collide
 */
import type { ElementAtPoint } from "@canva/design";
import type { FontRef } from "@canva/asset";
import { COLORS, GUTTER, TYPE, inches } from "src/design/tokens";
import { cleanLine, footerBand, headerBand } from "./_shared";
import type { Dims, MatrixContent, PageSpec } from "./types";
import { hline, rect, vline } from "./types";

export function matrixPage(
  content: MatrixContent,
  dims: Dims,
  fonts: { sans?: FontRef; mono?: FontRef } = {},
): PageSpec {
  const elements: ElementAtPoint[] = [];

  elements.push(...headerBand({ kicker: "02 / FRAMEWORK" }, dims, fonts));

  // Eyebrow
  elements.push({
    type: "text",
    children: ["1.4 / Framework"],
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

  // ---------- Plot geometry ----------
  // Mirror the source: plotX 2.20, plotY 2.10, plotW 9.20, plotH 4.30
  const plotX = inches(2.2);
  const plotY = inches(2.1);
  const plotW = inches(9.2);
  const plotH = inches(4.3);

  // Bounding rectangle as 4 thin grey-300 sides (white interior over off-white bg)
  elements.push(rect(plotY, plotX, plotW, plotH, COLORS.white));
  elements.push(rect(plotY, plotX, plotW, 1, COLORS.grey300)); // top
  elements.push(rect(plotY + plotH - 1, plotX, plotW, 1, COLORS.grey300)); // bottom
  elements.push(rect(plotY, plotX, 1, plotH, COLORS.grey300)); // left
  elements.push(rect(plotY, plotX + plotW - 1, 1, plotH, COLORS.grey300)); // right

  // Mid lines — Canva text/shape doesn't support dashType; render as a
  // single flat thin line in grey-400 (a subtle solid is acceptable since
  // a dashed line at our resolution would be barely distinguishable anyway).
  elements.push(vline(plotY, plotX + plotW / 2, plotH, COLORS.grey400));
  elements.push(hline(plotY + plotH / 2, plotX, plotW, COLORS.grey400));

  // ---------- Quadrant labels ----------
  // Each label goes to its quadrant's OUTER corner (away from the center
  // axes), so items clustering near the middle don't collide with them.
  // Earlier all four labels were anchored to the top-left of each
  // quadrant — that put bottom-row labels and right-column labels
  // right where item dots cluster (e.g. "Hyperscale leaders" overlapped
  // CoreWeave). Top-right is ORANGE (winner emphasis); others grey-700.
  const quadPad = inches(0.18);
  const halfW = plotW / 2;
  const halfH = plotH / 2;
  const quadLabelW = inches(2.2);
  const quadLabelH = inches(0.45);

  // Top-left quadrant → label at TOP-LEFT corner
  elements.push({
    type: "text",
    children: [cleanLine(content.quadrants.top_left).toUpperCase()],
    top: plotY + quadPad,
    left: plotX + quadPad,
    width: quadLabelW,
    fontSize: TYPE.small,
    color: COLORS.grey700,
    fontWeight: "medium",
    fontRef: fonts.mono,
  });
  // Top-right quadrant → label at TOP-RIGHT corner (right-aligned)
  elements.push({
    type: "text",
    children: [cleanLine(content.quadrants.top_right).toUpperCase()],
    top: plotY + quadPad,
    left: plotX + plotW - quadLabelW - quadPad,
    width: quadLabelW,
    fontSize: TYPE.small,
    color: COLORS.brand,
    fontWeight: "medium",
    textAlign: "end",
    fontRef: fonts.mono,
  });
  // Bottom-left quadrant → label at BOTTOM-LEFT corner
  elements.push({
    type: "text",
    children: [cleanLine(content.quadrants.bot_left).toUpperCase()],
    top: plotY + plotH - quadLabelH - quadPad,
    left: plotX + quadPad,
    width: quadLabelW,
    fontSize: TYPE.small,
    color: COLORS.grey700,
    fontWeight: "medium",
    fontRef: fonts.mono,
  });
  // Bottom-right quadrant → label at BOTTOM-RIGHT corner (right-aligned)
  elements.push({
    type: "text",
    children: [cleanLine(content.quadrants.bot_right).toUpperCase()],
    top: plotY + plotH - quadLabelH - quadPad,
    left: plotX + plotW - quadLabelW - quadPad,
    width: quadLabelW,
    fontSize: TYPE.small,
    color: COLORS.grey700,
    fontWeight: "medium",
    textAlign: "end",
    fontRef: fonts.mono,
  });
  void halfW;
  void halfH;

  // ---------- Items: dots + labels, kept tight to the dot ----------
  // Label sits at the dot's exact y so it visually couples to the dot.
  // Earlier we vertically staggered colliding labels by ~46px each — for
  // 4 items at similar y, the 4th label ended up 140px below its dot
  // and the visual coupling broke. New strategy:
  //   1. Label side defaults based on x (left half → right of dot, right
  //      half → left of dot, so labels point toward the plot interior).
  //   2. If a horizontal neighbor already placed a label at this y on
  //      this side, flip to the other side rather than vertically stagger.
  //   3. Only when both sides are taken do we bump y by one label-height.
  const dotSize = 14;
  const labelWidth = inches(1.7);
  const labelHOffset = inches(0.14);
  const labelRowH = inches(0.3);

  type Placed = {
    label: string;
    cx: number;
    cy: number;
    side: "right" | "left";
    labelTop: number;
    labelLeft: number;
  };

  // Approximate the bounding box of each placed label so we can detect
  // overlaps without reaching into Canva's own measurement.
  function rectsOverlap(
    a: { top: number; left: number; w: number; h: number },
    b: { top: number; left: number; w: number; h: number },
  ): boolean {
    return !(
      a.left + a.w <= b.left ||
      b.left + b.w <= a.left ||
      a.top + a.h <= b.top ||
      b.top + b.h <= a.top
    );
  }

  const items = content.items.slice(0, 12);
  // Stable placement order — top-to-bottom, then left-to-right.
  const ordered = items
    .map((it, i) => ({ ...it, i }))
    .sort((a, b) => (1 - a.y) - (1 - b.y) || a.x - b.x);

  const placed: Placed[] = [];
  for (const item of ordered) {
    const xN = Math.max(0, Math.min(1, item.x));
    const yN = Math.max(0, Math.min(1, item.y));
    const cx = plotX + xN * plotW;
    const cy = plotY + (1 - yN) * plotH;
    // Default side: point label toward the interior of the plot.
    const preferRight = xN < 0.5;
    const sides: Array<"right" | "left"> = preferRight
      ? ["right", "left"]
      : ["left", "right"];

    let chosen: Placed | null = null;
    // Try side first, then small vertical bumps if both sides collide.
    for (let bump = 0; bump < 4 && !chosen; bump++) {
      for (const side of sides) {
        const labelTop = cy - inches(0.09) + bump * labelRowH;
        const labelLeft =
          side === "right"
            ? cx + dotSize / 2 + labelHOffset
            : Math.max(plotX, cx - dotSize / 2 - labelHOffset - labelWidth);
        const candidateRect = {
          top: labelTop,
          left: labelLeft,
          w: labelWidth,
          h: labelRowH * 0.8,
        };
        const collides = placed.some((p) =>
          rectsOverlap(candidateRect, {
            top: p.labelTop,
            left: p.labelLeft,
            w: labelWidth,
            h: labelRowH * 0.8,
          }),
        );
        if (!collides) {
          chosen = { label: item.label, cx, cy, side, labelTop, labelLeft };
          break;
        }
      }
    }
    // Fallback: place to the preferred side regardless of collision.
    if (!chosen) {
      const side = sides[0]!;
      chosen = {
        label: item.label,
        cx,
        cy,
        side,
        labelTop: cy - inches(0.09),
        labelLeft:
          side === "right"
            ? cx + dotSize / 2 + labelHOffset
            : Math.max(plotX, cx - dotSize / 2 - labelHOffset - labelWidth),
      };
    }
    placed.push(chosen);
  }

  for (const p of placed) {
    elements.push(
      rect(p.cy - dotSize / 2, p.cx - dotSize / 2, dotSize, dotSize, COLORS.brand),
    );
    elements.push({
      type: "text",
      children: [cleanLine(p.label)],
      top: p.labelTop,
      left: p.labelLeft,
      width: labelWidth,
      fontSize: TYPE.small,
      color: COLORS.black,
      fontWeight: "medium",
      textAlign: p.side === "right" ? "start" : "end",
      fontRef: fonts.sans,
    });
  }

  // ---------- Y-axis: HIGH at top, LOW at bottom, "↑ LABEL" caption ----------
  elements.push({
    type: "text",
    children: [`↑  ${cleanLine(content.y_axis_label)}`],
    top: plotY - inches(0.45),
    left: plotX,
    width: inches(4.0),
    fontSize: TYPE.small,
    color: COLORS.grey700,
    fontWeight: "medium",
    fontRef: fonts.mono,
  });
  // HIGH marker (top-left, just outside plot)
  elements.push({
    type: "text",
    children: ["HIGH"],
    top: plotY - inches(0.05),
    left: inches(1.3),
    width: inches(0.85),
    fontSize: TYPE.small,
    color: COLORS.grey600,
    textAlign: "end",
    fontRef: fonts.mono,
  });
  // LOW marker (bottom-left, just outside plot)
  elements.push({
    type: "text",
    children: ["LOW"],
    top: plotY + plotH - inches(0.25),
    left: inches(1.3),
    width: inches(0.85),
    fontSize: TYPE.small,
    color: COLORS.grey600,
    textAlign: "end",
    fontRef: fonts.mono,
  });

  // ---------- X-axis: LOW at left, HIGH at right, "LABEL →" caption centered ----------
  // Three text elements stacked at same Y so the corners and center don't fight
  elements.push({
    type: "text",
    children: ["LOW"],
    top: plotY + plotH + inches(0.15),
    left: plotX,
    width: inches(1.0),
    fontSize: TYPE.small,
    color: COLORS.grey600,
    fontRef: fonts.mono,
  });
  elements.push({
    type: "text",
    children: [`${cleanLine(content.x_axis_label)}  →`],
    top: plotY + plotH + inches(0.15),
    left: plotX,
    width: plotW,
    fontSize: TYPE.small,
    color: COLORS.grey700,
    fontWeight: "medium",
    textAlign: "center",
    fontRef: fonts.mono,
  });
  elements.push({
    type: "text",
    children: ["HIGH"],
    top: plotY + plotH + inches(0.15),
    left: plotX + plotW - inches(1.0),
    width: inches(1.0),
    fontSize: TYPE.small,
    color: COLORS.grey600,
    textAlign: "end",
    fontRef: fonts.mono,
  });

  elements.push(
    ...footerBand(
      {
        source: "PARALLEL ANALYSIS  ·  PUBLIC FILINGS  ·  PRODUCT DOCS",
        pageNumber: "06",
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
